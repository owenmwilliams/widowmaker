# Web Worker Implementation for YOLO-World

## Problem
YOLO-World model loading and inference runs on the main JavaScript thread, blocking the UI and causing crashes on mobile devices. This is the #1 cause of slowness and instability.

## Solution: Offload to Web Worker
Move ONNX Runtime and all inference to a background thread (Web Worker). Main thread only sends video frames and receives bounding boxes.

## Architecture

```
Main Thread                      Web Worker
┌──────────────┐                ┌──────────────┐
│ MobileLiveScan│                │ YOLO-World   │
│              │  postMessage   │ Inference    │
│ 1. Capture   │ ────────────>  │              │
│    video     │  (ImageData)   │ 2. Run model │
│    frame     │                │              │
│              │  postMessage   │              │
│ 4. Draw bbox │ <────────────  │ 3. Return    │
│              │  (detections)  │    results   │
└──────────────┘                └──────────────┘
```

## Implementation Steps

### Step 1: Create Worker File
**File:** `movetrack-app/src/workers/yolo-world.worker.ts`

```typescript
import * as ort from 'onnxruntime-web';

// Configure ONNX Runtime in worker
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

let session: ort.InferenceSession | null = null;

// Handle messages from main thread
self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'load':
      try {
        session = await ort.InferenceSession.create(payload.modelUrl, {
          executionProviders: ['webgl', 'wasm'],
          graphOptimizationLevel: 'all'
        });
        self.postMessage({ type: 'loaded', success: true });
      } catch (error) {
        self.postMessage({ type: 'loaded', success: false, error: error.message });
      }
      break;

    case 'detect':
      if (!session) {
        self.postMessage({ type: 'detection', error: 'Model not loaded' });
        return;
      }

      try {
        // Convert ImageData to tensor
        const { imageData, width, height } = payload;
        const tensor = preprocessImageData(imageData, width, height);

        // Run inference
        const outputs = await session.run({ images: tensor });
        const detections = postprocess(outputs.output0, width, height);

        self.postMessage({ type: 'detection', detections });
      } catch (error) {
        self.postMessage({ type: 'detection', error: error.message });
      }
      break;

    case 'dispose':
      session = null;
      self.postMessage({ type: 'disposed' });
      break;
  }
};

function preprocessImageData(imageData: ImageData, width: number, height: number): ort.Tensor {
  // Convert ImageData to CHW format tensor (same as current implementation)
  // ...
}

function postprocess(output: ort.Tensor, width: number, height: number): Detection[] {
  // Same postprocessing logic as current implementation
  // ...
}
```

### Step 2: Update YoloWorldDetector
**File:** `movetrack-app/src/utils/detectors.ts`

```typescript
export class YoloWorldDetector implements Detector {
  private worker: Worker | null = null;
  private loadPromise: Promise<void> | null = null;

  async load(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(
        new URL('../workers/yolo-world.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (e) => {
        if (e.data.type === 'loaded') {
          if (e.data.success) {
            resolve();
          } else {
            reject(new Error(e.data.error));
          }
        }
      };

      this.worker.postMessage({
        type: 'load',
        payload: { modelUrl: this.modelUrl }
      });
    });
  }

  async detect(video: HTMLVideoElement): Promise<Detection[]> {
    if (!this.worker) throw new Error('Worker not initialized');

    return new Promise((resolve, reject) => {
      // Extract frame as ImageData
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Set up response handler
      const handleMessage = (e: MessageEvent) => {
        if (e.data.type === 'detection') {
          this.worker.removeEventListener('message', handleMessage);
          if (e.data.error) {
            reject(new Error(e.data.error));
          } else {
            resolve(e.data.detections);
          }
        }
      };

      this.worker.addEventListener('message', handleMessage);

      // Send to worker (use transferable objects for zero-copy)
      this.worker.postMessage({
        type: 'detect',
        payload: {
          imageData: imageData.data,
          width: canvas.width,
          height: canvas.height
        }
      }, [imageData.data.buffer]); // Transfer ArrayBuffer ownership
    });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
  }
}
```

### Step 3: Update Vite Config
**File:** `movetrack-app/vite.config.ts`

Add web worker support:

```typescript
export default defineConfig({
  // ... existing config
  worker: {
    format: 'es',
    plugins: () => [],
  },
});
```

## Benefits

1. **Main thread stays responsive** - UI never freezes during model loading or inference
2. **Browser won't kill tab** - Heavy computation in background doesn't trigger watchdog
3. **Better memory management** - Worker has separate memory space
4. **Crash isolation** - If worker crashes, main thread continues running

## Performance Impact

- **Model loading**: Main thread stays responsive during 10-second model download
- **Inference**: ~2-3ms overhead for postMessage communication (negligible compared to 30-50ms inference time)
- **Memory**: +50MB for worker heap (acceptable tradeoff)

## Testing Checklist

- [ ] Model loads without blocking UI
- [ ] Detection works at 15 FPS
- [ ] No console errors
- [ ] Works on iOS Safari
- [ ] Works on Chrome Android
- [ ] Graceful degradation if Worker fails

## Alternative: SharedArrayBuffer

For even better performance, use SharedArrayBuffer to avoid copying pixel data between threads. Requires CORS headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

This is an advanced optimization - implement basic Worker first, then consider SharedArrayBuffer if needed.
