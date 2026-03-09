import * as ort from 'onnxruntime-web';

// Configure ONNX Runtime in worker
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

let session: ort.InferenceSession | null = null;
let inputSize = 320; // Will be set during load

interface Detection {
  label: string;
  confidence: number;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface LoadMessage {
  type: 'load';
  payload: {
    modelUrl: string;
    inputSize: number;
  };
}

interface DetectMessage {
  type: 'detect';
  payload: {
    imageData: Uint8ClampedArray;
    width: number;
    height: number;
  };
}

interface DisposeMessage {
  type: 'dispose';
}

type WorkerMessage = LoadMessage | DetectMessage | DisposeMessage;

// Handle messages from main thread
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'load':
      try {
        console.log('[YOLO-Worker] Loading model:', payload.modelUrl);
        inputSize = payload.inputSize;

        // Check for OffscreenCanvas support (required for preprocessing)
        if (typeof OffscreenCanvas === 'undefined') {
          throw new Error('OffscreenCanvas not supported in Web Worker. iOS Safari has limited support. Try using COCO-SSD instead or use desktop browser.');
        }

        // Try WebGL first (GPU), fallback to WASM
        try {
          session = await ort.InferenceSession.create(payload.modelUrl, {
            executionProviders: ['webgl'],
            graphOptimizationLevel: 'all',
            executionMode: 'parallel',
            enableMemPattern: true,
            enableCpuMemArena: true
          });
          console.log('[YOLO-Worker] Model loaded with WebGL (GPU)');
          self.postMessage({ type: 'loaded', success: true, backend: 'webgl' });
        } catch (webglError) {
          console.warn('[YOLO-Worker] WebGL failed, trying WASM:', webglError);
          session = await ort.InferenceSession.create(payload.modelUrl, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
            enableMemPattern: true,
            enableCpuMemArena: true
          });
          console.log('[YOLO-Worker] Model loaded with WASM (CPU)');
          self.postMessage({ type: 'loaded', success: true, backend: 'wasm' });
        }
      } catch (error: any) {
        console.error('[YOLO-Worker] Failed to load model:', error);
        self.postMessage({ type: 'loaded', success: false, error: error.message });
      }
      break;

    case 'detect':
      if (!session) {
        self.postMessage({ type: 'detection', error: 'Model not loaded' });
        return;
      }

      try {
        const { imageData, width, height } = payload;

        // Check if OffscreenCanvas is supported
        if (typeof OffscreenCanvas === 'undefined') {
          self.postMessage({
            type: 'detection',
            error: 'OffscreenCanvas not supported in this browser. Web Workers require OffscreenCanvas support.'
          });
          return;
        }

        // Convert ImageData to tensor
        const tensor = preprocessImageData(imageData, width, height, inputSize);

        // Run inference
        const outputs = await session.run({ images: tensor });

        // Postprocess
        const detections = postprocess(outputs.output0, width, height);

        // Clean up tensor
        try {
          // @ts-ignore - dispose exists but not in types
          tensor.dispose?.();
        } catch (e) {
          // Ignore disposal errors
        }

        self.postMessage({ type: 'detection', detections });
      } catch (error: any) {
        console.error('[YOLO-Worker] Detection error:', error);
        self.postMessage({ type: 'detection', error: error.message });
      }
      break;

    case 'dispose':
      if (session) {
        try {
          // @ts-ignore
          session.release?.();
        } catch (e) {
          // Ignore disposal errors
        }
        session = null;
      }
      self.postMessage({ type: 'disposed' });
      break;
  }
};

function preprocessImageData(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  targetSize: number
): ort.Tensor {
  // Create an OffscreenCanvas to resize the image
  const canvas = new OffscreenCanvas(targetSize, targetSize);
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
    alpha: false
  });

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Create ImageData from the Uint8ClampedArray
  const srcImageData = new ImageData(imageData, width, height);

  // Draw and resize to target size
  const tempCanvas = new OffscreenCanvas(width, height);
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) {
    throw new Error('Failed to get temp canvas context');
  }
  tempCtx.putImageData(srcImageData, 0, 0);

  // Draw resized image
  ctx.drawImage(tempCanvas, 0, 0, targetSize, targetSize);

  // Get resized pixel data
  const resizedImageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const pixels = resizedImageData.data;

  // Convert RGBA to RGB float32 tensor in CHW format
  const float32Data = new Float32Array(3 * targetSize * targetSize);

  for (let i = 0; i < targetSize * targetSize; i++) {
    // Normalize to [0, 1] and convert to CHW format
    float32Data[i] = pixels[i * 4] / 255.0; // R
    float32Data[targetSize * targetSize + i] = pixels[i * 4 + 1] / 255.0; // G
    float32Data[targetSize * targetSize * 2 + i] = pixels[i * 4 + 2] / 255.0; // B
  }

  return new ort.Tensor('float32', float32Data, [1, 3, targetSize, targetSize]);
}

function postprocess(output: ort.Tensor, originalWidth: number, originalHeight: number): Detection[] {
  const HOUSEHOLD_ITEMS = [
    'box', 'chair', 'table', 'sofa', 'bed', 'dresser', 'desk',
    'bookshelf', 'lamp', 'mirror', 'television', 'mattress',
    'nightstand', 'rug', 'cabinet', 'refrigerator', 'washer',
    'dryer', 'bicycle', 'unknown item'
  ];

  const CONFIDENCE_THRESHOLD = 0.25;
  const IOU_THRESHOLD = 0.45;

  const data = output.data as Float32Array;
  const [batchSize, numClasses, numBoxes] = output.dims as [number, number, number];

  const detections: Detection[] = [];

  // Process each box
  for (let i = 0; i < numBoxes; i++) {
    // Get max confidence and class
    let maxConf = 0;
    let maxClass = 0;

    for (let c = 4; c < numClasses; c++) {
      const conf = data[c * numBoxes + i];
      if (conf > maxConf) {
        maxConf = conf;
        maxClass = c - 4; // Subtract 4 for box coordinates
      }
    }

    // Filter by confidence
    if (maxConf < CONFIDENCE_THRESHOLD) continue;

    // Get box coordinates (in inputSize scale)
    const cx = data[0 * numBoxes + i];
    const cy = data[1 * numBoxes + i];
    const w = data[2 * numBoxes + i];
    const h = data[3 * numBoxes + i];

    // Convert to original image scale
    const x = (cx - w / 2) * originalWidth / inputSize;
    const y = (cy - h / 2) * originalHeight / inputSize;
    const width = w * originalWidth / inputSize;
    const height = h * originalHeight / inputSize;

    // Ensure class index is valid
    const label = maxClass < HOUSEHOLD_ITEMS.length
      ? HOUSEHOLD_ITEMS[maxClass]
      : 'unknown item';

    detections.push({
      label,
      confidence: maxConf,
      box: { x, y, width, height }
    });
  }

  // Apply NMS (Non-Maximum Suppression)
  return applyNMS(detections, IOU_THRESHOLD);
}

function applyNMS(detections: Detection[], iouThreshold: number): Detection[] {
  // Sort by confidence (descending)
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const keep: Detection[] = [];

  while (sorted.length > 0) {
    const current = sorted.shift()!;
    keep.push(current);

    // Remove overlapping boxes
    for (let i = sorted.length - 1; i >= 0; i--) {
      const iou = calculateIOU(current.box, sorted[i].box);
      if (iou > iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }

  return keep;
}

function calculateIOU(
  box1: { x: number; y: number; width: number; height: number },
  box2: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const union = area1 + area2 - intersection;

  return union === 0 ? 0 : intersection / union;
}

console.log('[YOLO-Worker] Worker initialized');
