import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { pipeline, ZeroShotObjectDetectionPipeline } from '@xenova/transformers';
import * as ort from 'onnxruntime-web';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';

// Configure ONNX Runtime WASM paths globally (must be set before any session creation)
// Use CDN for WASM files (more reliable than local hosting in development)
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';
ort.env.wasm.numThreads = 1; // Use single-threaded for better compatibility
ort.env.wasm.simd = true; // Enable SIMD for better performance

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

// ─── Comprehensive Household Items (100 items) ───────────────────────────────

export const HOUSEHOLD_ITEMS = [
  // Unknown/Generic
  'unknown item',
  'box',
  'container',

  // Furniture - Living Room
  'sofa',
  'couch',
  'sectional sofa',
  'loveseat',
  'armchair',
  'recliner',
  'coffee table',
  'ottoman',
  'end table',
  'side table',
  'console table',
  'tv stand',
  'entertainment center',
  'bookshelf',
  'bookcase',

  // Furniture - Bedroom
  'bed',
  'bed frame',
  'mattress',
  'box spring',
  'nightstand',
  'bedside table',
  'dresser',
  'chest of drawers',
  'wardrobe',
  'armoire',
  'vanity',
  'linens',

  // Furniture - Dining
  'dining table',
  'dining chair',
  'bar stool',
  'china cabinet',
  'buffet',
  'sideboard',

  // Furniture - Office
  'desk',
  'office chair',
  'filing cabinet',

  // Storage & Organization
  'moving box',
  'plastic bin',
  'storage container',
  'tote',
  'basket',
  'laundry basket',
  'hamper',
  'chest',

  // Lighting
  'floor lamp',
  'table lamp',
  'desk lamp',
  'chandelier',
  'pendant light',
  'ceiling fan',

  // Electronics
  'television',
  'monitor',
  'computer',
  'laptop',
  'desktop computer',
  'printer',
  'speaker',
  'stereo',
  'gaming console',
  'router',
  'electronic device',

  // Appliances - Kitchen
  'refrigerator',
  'stove',
  'oven',
  'microwave',
  'dishwasher',
  'coffee maker',
  'toaster',
  'blender',
  'food processor',
  'stand mixer',

  // Appliances - Laundry
  'washing machine',
  'dryer',

  // Textiles & Soft Goods
  'rug',
  'carpet',
  'curtains',
  'drapes',
  'blinds',
  'pillow',
  'cushion',

  // Decor & Accessories
  'mirror',
  'artwork',
  'vase',
  'plant',
  'potted plant',
  'clock',
  'sculpture',

  // Outdoor & Miscellaneous
  'bicycle',
  'sports equipment',
  'suitcase',
  'luggage',
  'vacuum cleaner',
  'fan',
  'heater',
  'air conditioner',
  'tool box',
  'ladder',
] as const;

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

export class YoloWorldDetector implements Detector {
  private session: ort.InferenceSession | null = null;
  private readonly modelUrl: string;
  private readonly inputSize = 640;
  private readonly confidenceThreshold = 0.25;
  private readonly iouThreshold = 0.45;

  constructor(modelUrl?: string) {
    // Default to GCS-hosted model (49MB)
    this.modelUrl = modelUrl || 'https://storage.googleapis.com/widowmaker-site-images/models/yolo_world_household.onnx';
  }

  async load(): Promise<void> {
    console.log(`[YOLO-World] Loading model from ${this.modelUrl}...`);
    console.log(`[YOLO-World] WASM paths configured: ${ort.env.wasm.wasmPaths}`);
    console.log(`[YOLO-World] SIMD enabled: ${ort.env.wasm.simd}, Threads: ${ort.env.wasm.numThreads}`);

    try {
      this.session = await ort.InferenceSession.create(this.modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      console.log('[YOLO-World] Model loaded successfully');
      console.log(`[YOLO-World] Using execution provider: ${this.session.handler._ep}`);
    } catch (error) {
      console.error('[YOLO-World] Failed to load model:', error);
      throw error;
    }
  }

  async detect(video: HTMLVideoElement): Promise<Detection[]> {
    if (!this.session) throw new Error('Model not loaded');

    // Preprocess: extract frame and prepare input tensor
    const input = this.preprocessImage(video);

    // Run inference
    const outputs = await this.session.run({ images: input });
    const output = outputs.output0;

    // Postprocess: parse detections and apply NMS
    const detections = this.postprocess(output, video.videoWidth, video.videoHeight);

    return detections;
  }

  private preprocessImage(video: HTMLVideoElement): ort.Tensor {
    // Create canvas and resize image to 640x640
    const canvas = document.createElement('canvas');
    canvas.width = this.inputSize;
    canvas.height = this.inputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    // Draw video frame with letterboxing (maintain aspect ratio)
    const scale = Math.min(this.inputSize / video.videoWidth, this.inputSize / video.videoHeight);
    const scaledWidth = video.videoWidth * scale;
    const scaledHeight = video.videoHeight * scale;
    const offsetX = (this.inputSize - scaledWidth) / 2;
    const offsetY = (this.inputSize - scaledHeight) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.inputSize, this.inputSize);
    ctx.drawImage(video, offsetX, offsetY, scaledWidth, scaledHeight);

    // Get image data and convert to tensor (CHW format, normalized)
    const imageData = ctx.getImageData(0, 0, this.inputSize, this.inputSize);
    const pixels = imageData.data;

    const tensorData = new Float32Array(3 * this.inputSize * this.inputSize);
    for (let i = 0; i < this.inputSize * this.inputSize; i++) {
      tensorData[i] = pixels[i * 4] / 255.0; // R
      tensorData[i + this.inputSize * this.inputSize] = pixels[i * 4 + 1] / 255.0; // G
      tensorData[i + 2 * this.inputSize * this.inputSize] = pixels[i * 4 + 2] / 255.0; // B
    }

    return new ort.Tensor('float32', tensorData, [1, 3, this.inputSize, this.inputSize]);
  }

  private postprocess(output: ort.Tensor, originalWidth: number, originalHeight: number): Detection[]  {
    const data = output.data as Float32Array;
    const dims = output.dims;

    // YOLO output format: [1, num_classes + 4, num_detections]
    const numClasses = dims[1] - 4;
    const numDetections = dims[2];

    const detections: Detection[] = [];
    const scale = Math.min(this.inputSize / originalWidth, this.inputSize / originalHeight);

    for (let i = 0; i < numDetections; i++) {
      // Extract bbox and class scores
      const x = data[i];
      const y = data[numDetections + i];
      const w = data[2 * numDetections + i];
      const h = data[3 * numDetections + i];

      // Find best class
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

      // Convert from center format to corner format
      const x1 = (x - w / 2) / scale;
      const y1 = (y - h / 2) / scale;
      const width = w / scale;
      const height = h / scale;

      detections.push({
        class: HOUSEHOLD_ITEMS[maxClass],
        score: maxScore,
        bbox: [x1, y1, width, height]
      });
    }

    // Apply NMS
    return this.nonMaxSuppression(detections);
  }

  private nonMaxSuppression(detections: Detection[]): Detection[] {
    // Sort by confidence descending
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

  getName(): string {
    return 'YOLO-World';
  }

  getDescription(): string {
    return `Offline vocabulary (${HOUSEHOLD_ITEMS.length} items) - ~30 FPS`;
  }
}

// ─── Detector Factory ─────────────────────────────────────────────────────────

export type DetectorType = 'coco-ssd' | 'owlvit' | 'yolo-world';

export function createDetector(type: DetectorType, modelUrl?: string): Detector {
  switch (type) {
    case 'coco-ssd':
      return new CocoSsdDetector();
    case 'owlvit':
      return new OwlVitDetector();
    case 'yolo-world':
      return new YoloWorldDetector(modelUrl);
    default:
      throw new Error(`Unknown detector type: ${type}`);
  }
}
