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
  private readonly modelUrl: string;
  private readonly inputSize: number;
  private readonly version: YoloWorldVersion;
  private loadPromise: Promise<void> | null = null;

  constructor(version: YoloWorldVersion = 'v1', customModelUrl?: string) {
    this.version = version;

    if (customModelUrl) {
      this.modelUrl = customModelUrl;
      this.inputSize = 320; // Assume custom model is optimized
    } else if (version === 'v2') {
      // V2: 20 items, 320x320 (optimized for mobile)
      this.modelUrl = 'https://storage.googleapis.com/widowmaker-site-images/models/yolo_world_household_v2.onnx';
      this.inputSize = 320;
    } else {
      // V1: 100 items, 640x640 (original)
      this.modelUrl = 'https://storage.googleapis.com/widowmaker-site-images/models/yolo_world_household.onnx';
      this.inputSize = 640;
    }
  }

  async load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise((resolve, reject) => {
      console.log(`[YOLO-World] Creating Web Worker for ${this.version}...`);

      try {
        // Create worker (Vite will handle bundling)
        this.worker = new Worker(
          new URL('../workers/yolo-world.worker.ts', import.meta.url),
          { type: 'module' }
        );

        // Set up message handler for load response
        const loadHandler = (e: MessageEvent) => {
          if (e.data.type === 'loaded') {
            this.worker!.removeEventListener('message', loadHandler);

            if (e.data.success) {
              console.log(`[YOLO-World] Worker loaded model with ${e.data.backend} backend`);
              resolve();
            } else {
              reject(new Error(e.data.error));
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
        console.error('[YOLO-World] Failed to create worker:', error);
        reject(error);
      }
    });

    return this.loadPromise;
  }

  async detect(video: HTMLVideoElement): Promise<Detection[]> {
    if (!this.worker) throw new Error('Worker not initialized');

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

      this.worker.addEventListener('message', detectHandler);

      // Send frame to worker (use transferable for zero-copy)
      // Note: After transfer, imageData.data will be unusable in main thread
      this.worker.postMessage({
        type: 'detect',
        payload: {
          imageData: imageData.data,
          width: canvas.width,
          height: canvas.height
        }
      }, [imageData.data.buffer]); // Transfer ArrayBuffer ownership to worker
    });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.loadPromise = null;
  }

  getName(): string {
    return this.version === 'v2' ? 'YOLO-World V2' : 'YOLO-World V1';
  }

  getDescription(): string {
    if (this.version === 'v2') {
      return `Optimized (20 items, 320px) - ~25-30 FPS with Web Worker`;
    } else {
      return `Original (100 items, 640px) - ~15-20 FPS with Web Worker`;
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
