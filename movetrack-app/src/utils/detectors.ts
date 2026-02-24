import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { pipeline, ZeroShotObjectDetectionPipeline } from '@xenova/transformers';

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

// ─── Household Items for Open-Vocabulary Detection ───────────────────────────

export const HOUSEHOLD_ITEMS = [
  // Furniture
  'dresser', 'chest of drawers', 'nightstand', 'bedside table',
  'bookshelf', 'bookcase', 'cabinet', 'armoire', 'desk',
  'coffee table', 'side table', 'end table', 'entertainment center',
  'filing cabinet', 'wardrobe',

  // Seating (supplement COCO)
  'chair', 'couch', 'sofa', 'bed', 'dining table',

  // Storage & Organization
  'cardboard box', 'moving box', 'storage box',
  'plastic bin', 'storage container', 'tote', 'basket',

  // Lighting
  'floor lamp', 'table lamp', 'desk lamp', 'chandelier',

  // Textiles & Soft Goods
  'rug', 'area rug', 'carpet', 'curtains', 'drapes',
  'mirror', 'picture frame', 'artwork', 'painting',

  // Appliances (supplement COCO)
  'washing machine', 'dryer', 'dishwasher', 'refrigerator',
  'microwave', 'oven', 'stove',

  // Electronics
  'television', 'tv', 'monitor', 'computer', 'laptop',
  'printer', 'speaker',

  // Common COCO items
  'potted plant', 'vase', 'clock', 'book'
];

// ─── COCO-SSD Detector ────────────────────────────────────────────────────────

export class CocoSsdDetector implements Detector {
  private model: cocoSsd.ObjectDetection | null = null;

  async load(): Promise<void> {
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

// ─── Detector Factory ─────────────────────────────────────────────────────────

export type DetectorType = 'coco-ssd' | 'owlvit';

export function createDetector(type: DetectorType): Detector {
  switch (type) {
    case 'coco-ssd':
      return new CocoSsdDetector();
    case 'owlvit':
      return new OwlVitDetector();
    default:
      throw new Error(`Unknown detector type: ${type}`);
  }
}
