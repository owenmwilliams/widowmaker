import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { pipeline, ZeroShotObjectDetectionPipeline } from '@xenova/transformers';
import * as ort from 'onnxruntime-web';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';

// Configure ONNX Runtime globally (must be set before any session creation)
// Use CDN for WASM files (more reliable than local hosting in development)
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';
ort.env.wasm.numThreads = 1; // Use single-threaded for better compatibility
ort.env.wasm.simd = true; // Enable SIMD for better performance

// Increase WASM memory limit for large models (default is 2GB, iOS may need more)
ort.env.wasm.proxy = false; // Disable proxy mode for better performance

// Enable WebGL for GPU acceleration (much faster than WASM for inference)
ort.env.webgl.contextId = 'webgl2';
ort.env.webgl.matmulMaxBatchSize = 16;
ort.env.webgl.textureCacheMode = 'full';

// Initialize TensorFlow.js backend (required for COCO-SSD)
// This ensures the WebGL backend is registered before any TF operations
tf.ready();

export type BoundingBox = [number, number, number, number]; // [x, y, width, height]

export interface Detection {
  class: string;
  score: number;
  bbox: BoundingBox;
}

export interface Detector {
  load(): Promise<void>;
  detect(video: HTMLVideoElement): Promise<Detection[]>;
  getName(): string;
  getDescription(): string;
}

// ─── Essential Household Items (20 items - pruned for performance) ───────────

export const HOUSEHOLD_ITEMS = [
  // Most common moving items (ordered by frequency)
  'box',                    // #1 most common
  'chair',
  'table',
  'sofa',
  'bed',
  'dresser',
  'desk',
  'bookshelf',
  'lamp',
  'mirror',
  'television',
  'mattress',
  'nightstand',
  'rug',
  'cabinet',
  'refrigerator',
  'washer',
  'dryer',
  'bicycle',
  'unknown item',           // Catch-all
] as const;

// Full vocabulary available for model re-export if needed (commented out for reference)
// 'couch', 'sectional sofa', 'loveseat', 'armchair', 'recliner', 'coffee table',
// 'ottoman', 'end table', 'side table', 'console table', 'tv stand', 'entertainment center',
// 'bookcase', 'bed frame', 'box spring', 'bedside table', 'chest of drawers', 'wardrobe',
// 'armoire', 'vanity', 'linens', 'dining table', 'dining chair', 'bar stool', 'china cabinet',
// 'buffet', 'sideboard', 'office chair', 'filing cabinet', 'moving box', 'plastic bin',
// 'storage container', 'tote', 'basket', 'laundry basket', 'hamper', 'chest', 'floor lamp',
// 'table lamp', 'desk lamp', 'chandelier', 'pendant light', 'ceiling fan', 'monitor',
// 'computer', 'laptop', 'desktop computer', 'printer', 'speaker', 'stereo', 'gaming console',
// 'router', 'electronic device', 'stove', 'oven', 'microwave', 'dishwasher', 'coffee maker',
// 'toaster', 'blender', 'food processor', 'stand mixer', 'washing machine', 'carpet',
// 'curtains', 'drapes', 'blinds', 'pillow', 'cushion', 'artwork', 'vase', 'plant',
// 'potted plant', 'clock', 'sculpture', 'sports equipment', 'suitcase', 'luggage',
// 'vacuum cleaner', 'fan', 'heater', 'air conditioner', 'tool box', 'ladder'

// ─── COCO-SSD Detector ────────────────────────────────────────────────────────

export class CocoSsdDetector implements Detector {
  private model: cocoSsd.ObjectDetection | null = null;

  async load(): Promise<void> {
    // Ensure TensorFlow.js backend is ready before loading model
    await tf.ready();
    this.model = await cocoSsd.load();
  }

  async detect(video: HTMLVideoElement): Promise<Detection[]> {
    if (!this.model) throw new Error('Model not loaded');

    const predictions = await this.model.detect(video);

    return predictions.map(pred => ({
      class: pred.class,
      score: pred.score,
      bbox: pred.bbox as BoundingBox
    }));
  }

  getName(): string {
    return 'COCO-SSD';
  }

  getDescription(): string {
    return 'Fast detection (80 common objects) - ~30 FPS';
  }
}

// ─── OwlViT Zero-Shot Detector ────────────────────────────────────────────────

export class OwlVitDetector implements Detector {
  private model: ZeroShotObjectDetectionPipeline | null = null;
  private candidateLabels: string[] = HOUSEHOLD_ITEMS;

  async load(): Promise<void> {
    // Ensure TensorFlow.js backend is ready (transformers uses it internally)
    await tf.ready();
    this.model = await pipeline(
      'zero-shot-object-detection',
      'Xenova/owlvit-base-patch32'
    ) as ZeroShotObjectDetectionPipeline;
  }

  async detect(video: HTMLVideoElement): Promise<Detection[]> {
    if (!this.model) throw new Error('Model not loaded');

    // Create canvas to get image data
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Run detection with household item prompts
    const results = await this.model(imageData, this.candidateLabels, {
      threshold: 0.1, // Lower threshold for initial detection
      topk: 50 // Return top 50 detections
    });

    return results.map(result => ({
      class: result.label,
      score: result.score,
      bbox: [
        result.box.xmin,
        result.box.ymin,
        result.box.xmax - result.box.xmin,
        result.box.ymax - result.box.ymin
      ] as BoundingBox
    }));
  }

  getName(): string {
    return 'OwlViT';
  }

  getDescription(): string {
    return 'Zero-shot detection (any household item) - ~5-10 FPS';
  }
}

// ─── YOLO-World Detector (Offline Vocabulary) ────────────────────────────────

export type YoloWorldVersion = 'v1' | 'v2';

export class YoloWorldDetector implements Detector {
  private worker: Worker | null = null;
  private session: ort.InferenceSession | null = null; // Fallback for iOS
  private readonly modelUrl: string;
  private readonly inputSize: number;
  private readonly version: YoloWorldVersion;
  private loadPromise: Promise<void> | null = null;
  private useWorker = true; // Will be set to false if Worker fails
  private preprocessCanvas: HTMLCanvasElement | null = null;
  private preprocessCtx: CanvasRenderingContext2D | null = null;
  private readonly confidenceThreshold = 0.25;
  private readonly iouThreshold = 0.45;

  constructor(version: YoloWorldVersion = 'v1', customModelUrl?: string) {
    this.version = version;

    if (customModelUrl) {
      this.modelUrl = customModelUrl;
      this.inputSize = 320; // Assume custom model is optimized
    } else if (version === 'v2') {
      // V2: 20 items, 320x320 (optimized for mobile, INT8 quantized)
      this.modelUrl = 'https://storage.googleapis.com/widowmaker-site-images/models/yolo_world_household_v2_int8.onnx';
      this.inputSize = 320;
    } else {
      // V1: 100 items, 640x640 (original)
      this.modelUrl = 'https://storage.googleapis.com/widowmaker-site-images/models/yolo_world_household.onnx';
      this.inputSize = 640;
    }
  }

  async load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise(async (resolve, reject) => {
      console.log(`[YOLO-World] Loading ${this.version}...`);

      // Try Web Worker first (better performance on supported browsers)
      try {
        console.log(`[YOLO-World] Attempting Web Worker...`);
        this.worker = new Worker(
          new URL('./workers/yolo-world.worker.ts', import.meta.url),
          { type: 'module' }
        );

        // Set up error handler
        this.worker.onerror = (error) => {
          console.warn('[YOLO-World] Worker failed, falling back to main thread:', error);
          this.worker = null;
          this.useWorker = false;
          // Fall through to main thread loading below
          this.loadMainThread().then(resolve).catch(reject);
        };

        // Set up message handler for load response
        const loadHandler = (e: MessageEvent) => {
          if (e.data.type === 'loaded') {
            this.worker!.removeEventListener('message', loadHandler);

            if (e.data.success) {
              console.log(`[YOLO-World] Worker loaded successfully with ${e.data.backend} backend`);
              this.useWorker = true;
              resolve();
            } else {
              // Worker failed (likely iOS - no OffscreenCanvas support)
              console.warn('[YOLO-World] Worker load failed, falling back to main thread:', e.data.error);
              this.worker?.terminate();
              this.worker = null;
              this.useWorker = false;
              this.loadMainThread().then(resolve).catch(reject);
            }
          }
        };

        this.worker.addEventListener('message', loadHandler);

        // Send load command to worker
        this.worker.postMessage({
          type: 'load',
          payload: {
            modelUrl: this.modelUrl,
            inputSize: this.inputSize
          }
        });
      } catch (error) {
        // Worker creation failed, use main thread
        console.warn('[YOLO-World] Worker not available, using main thread:', error);
        this.useWorker = false;
        try {
          await this.loadMainThread();
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    });

    return this.loadPromise;
  }

  // Main thread fallback for iOS
  private async loadMainThread(): Promise<void> {
    console.log(`[YOLO-World] Loading on main thread (iOS fallback)...`);

    try {
      // Try WebGL first (GPU), fallback to WASM
      try {
        this.session = await ort.InferenceSession.create(this.modelUrl, {
          executionProviders: ['webgl'],
          graphOptimizationLevel: 'all',
          executionMode: 'parallel',
          enableMemPattern: true,
          enableCpuMemArena: true
        });
        console.log('[YOLO-World] Main thread loaded with WebGL (GPU)');
      } catch (webglError) {
        console.warn('[YOLO-World] WebGL failed, trying WASM:', webglError);
        this.session = await ort.InferenceSession.create(this.modelUrl, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
          enableMemPattern: true,
          enableCpuMemArena: true
        });
        console.log('[YOLO-World] Main thread loaded with WASM (CPU)');
      }
    } catch (error) {
      console.error('[YOLO-World] Main thread load failed:', error);
      throw error;
    }
  }

  async detect(video: HTMLVideoElement): Promise<Detection[]> {
    if (this.useWorker && this.worker) {
      return this.detectWorker(video);
    } else if (this.session) {
      return this.detectMainThread(video);
    } else {
      throw new Error('Model not loaded');
    }
  }

  // Worker-based detection
  private detectWorker(video: HTMLVideoElement): Promise<Detection[]> {
    return new Promise((resolve, reject) => {
      // Extract frame as ImageData
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Set up response handler
      const detectHandler = (e: MessageEvent) => {
        if (e.data.type === 'detection') {
          this.worker!.removeEventListener('message', detectHandler);

          if (e.data.error) {
            reject(new Error(e.data.error));
          } else {
            // Convert worker detections to our Detection format
            const detections: Detection[] = e.data.detections.map((d: any) => ({
              class: d.label,
              score: d.confidence,
              bbox: [d.box.x, d.box.y, d.box.width, d.box.height] as BoundingBox
            }));
            resolve(detections);
          }
        }
      };

      this.worker!.addEventListener('message', detectHandler);

      // Send frame to worker (use transferable for zero-copy)
      this.worker!.postMessage({
        type: 'detect',
        payload: {
          imageData: imageData.data,
          width: canvas.width,
          height: canvas.height
        }
      }, [imageData.data.buffer]);
    });
  }

  // Main thread fallback detection (iOS)
  private async detectMainThread(video: HTMLVideoElement): Promise<Detection[]> {
    if (!this.session) throw new Error('Session not loaded');

    let input: ort.Tensor | null = null;
    try {
      input = this.preprocessImage(video);
      const outputs = await this.session.run({ images: input });
      const detections = this.postprocess(outputs.output0, video.videoWidth, video.videoHeight);
      return detections;
    } finally {
      if (input) {
        try {
          // @ts-ignore
          input.dispose?.();
        } catch (e) {
          // Ignore
        }
      }
    }
  }

  // Preprocessing for main thread
  private preprocessImage(video: HTMLVideoElement): ort.Tensor {
    if (!this.preprocessCanvas) {
      this.preprocessCanvas = document.createElement('canvas');
      this.preprocessCanvas.width = this.inputSize;
      this.preprocessCanvas.height = this.inputSize;
      this.preprocessCtx = this.preprocessCanvas.getContext('2d', {
        willReadFrequently: true,
        alpha: false
      });
    }

    const canvas = this.preprocessCanvas;
    const ctx = this.preprocessCtx;
    if (!ctx) throw new Error('Failed to get canvas context');

    // Draw video frame with letterboxing
    const scale = Math.min(this.inputSize / video.videoWidth, this.inputSize / video.videoHeight);
    const scaledWidth = video.videoWidth * scale;
    const scaledHeight = video.videoHeight * scale;
    const offsetX = (this.inputSize - scaledWidth) / 2;
    const offsetY = (this.inputSize - scaledHeight) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.inputSize, this.inputSize);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(video, offsetX, offsetY, scaledWidth, scaledHeight);

    const imageData = ctx.getImageData(0, 0, this.inputSize, this.inputSize);
    const pixels = imageData.data;

    const tensorData = new Float32Array(3 * this.inputSize * this.inputSize);
    const pixelCount = this.inputSize * this.inputSize;

    for (let i = 0; i < pixelCount; i++) {
      const pixelIndex = i * 4;
      tensorData[i] = pixels[pixelIndex] / 255.0;
      tensorData[i + pixelCount] = pixels[pixelIndex + 1] / 255.0;
      tensorData[i + 2 * pixelCount] = pixels[pixelIndex + 2] / 255.0;
    }

    return new ort.Tensor('float32', tensorData, [1, 3, this.inputSize, this.inputSize]);
  }

  // Postprocessing for main thread
  private postprocess(output: ort.Tensor, originalWidth: number, originalHeight: number): Detection[] {
    const data = output.data as Float32Array;
    const dims = output.dims;
    const numClasses = dims[1] - 4;
    const numDetections = dims[2];

    const detections: Detection[] = [];
    const scale = Math.min(this.inputSize / originalWidth, this.inputSize / originalHeight);
    const scaledWidth = originalWidth * scale;
    const scaledHeight = originalHeight * scale;
    const offsetX = (this.inputSize - scaledWidth) / 2;
    const offsetY = (this.inputSize - scaledHeight) / 2;

    for (let i = 0; i < numDetections; i++) {
      const x = data[i];
      const y = data[numDetections + i];
      const w = data[2 * numDetections + i];
      const h = data[3 * numDetections + i];

      let maxScore = 0;
      let maxClass = 0;
      for (let c = 0; c < numClasses; c++) {
        const score = data[(4 + c) * numDetections + i];
        if (score > maxScore) {
          maxScore = score;
          maxClass = c;
        }
      }

      if (maxScore < this.confidenceThreshold) continue;

      // Undo letterboxing offsets before scaling back to original image space
      const x1 = (x - w / 2 - offsetX) / scale;
      const y1 = (y - h / 2 - offsetY) / scale;
      const width = w / scale;
      const height = h / scale;

      detections.push({
        class: HOUSEHOLD_ITEMS[maxClass] || 'unknown item',
        score: maxScore,
        bbox: [x1, y1, width, height]
      });
    }

    return this.nonMaxSuppression(detections);
  }

  private nonMaxSuppression(detections: Detection[]): Detection[] {
    detections.sort((a, b) => b.score - a.score);
    const keep: Detection[] = [];

    while (detections.length > 0) {
      const best = detections.shift()!;
      keep.push(best);
      detections = detections.filter(det => {
        const iou = this.calculateIoU(best.bbox, det.bbox);
        return iou < this.iouThreshold;
      });
    }

    return keep;
  }

  private calculateIoU(box1: BoundingBox, box2: BoundingBox): number {
    const [x1, y1, w1, h1] = box1;
    const [x2, y2, w2, h2] = box2;

    const left = Math.max(x1, x2);
    const top = Math.max(y1, y2);
    const right = Math.min(x1 + w1, x2 + w2);
    const bottom = Math.min(y1 + h1, y2 + h2);

    if (right < left || bottom < top) return 0;

    const intersectionArea = (right - left) * (bottom - top);
    const box1Area = w1 * h1;
    const box2Area = w2 * h2;
    const unionArea = box1Area + box2Area - intersectionArea;

    return intersectionArea / unionArea;
  }

  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    if (this.session) {
      try {
        // @ts-ignore
        this.session.release?.();
      } catch (e) {
        // Ignore
      }
      this.session = null;
    }
    this.preprocessCanvas = null;
    this.preprocessCtx = null;
    this.loadPromise = null;
  }

  getName(): string {
    return this.version === 'v2' ? 'YOLO-World V2' : 'YOLO-World V1';
  }

  getDescription(): string {
    const mode = this.useWorker ? 'Worker' : 'iOS fallback';
    if (this.version === 'v2') {
      return `Optimized (20 items, 320px) - ${mode}`;
    } else {
      return `Original (100 items, 640px) - ${mode}`;
    }
  }
}

// ─── Detector Factory ─────────────────────────────────────────────────────────

export type DetectorType = 'coco-ssd' | 'owlvit' | 'yolo-world-v1' | 'yolo-world-v2';

export function createDetector(type: DetectorType, modelUrl?: string): Detector {
  switch (type) {
    case 'coco-ssd':
      return new CocoSsdDetector();
    case 'owlvit':
      return new OwlVitDetector();
    case 'yolo-world-v1':
      return new YoloWorldDetector('v1', modelUrl);
    case 'yolo-world-v2':
      return new YoloWorldDetector('v2', modelUrl);
    default:
      throw new Error(`Unknown detector type: ${type}`);
  }
}
