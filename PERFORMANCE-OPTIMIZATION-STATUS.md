# YOLO-World Performance Optimization Status

## Senior Dev Recommendations Analysis

### ✅ Implemented (Quick Wins)

1. **Reduced Input Resolution** ✅
   - Changed from 640x640 → **320x320 pixels**
   - **4x memory reduction** (from ~1.2MB to ~300KB per frame)
   - Location: `detectors.ts:142` (`inputSize = 320`)

2. **Pruned Vocabulary** ✅
   - Reduced from 100 → **20 essential items**
   - Kept only most common moving items
   - Location: `detectors.ts:42-62`

3. **Debounce Inference** ✅
   - Already throttled to 15 FPS
   - Location: `MobileLiveScan.vue:126`

4. **WebGL Execution Provider** ✅
   - Using WebGL (GPU) with WASM fallback
   - Location: `detectors.ts:159-174`

### 🚧 Partially Implemented

1. **WebGPU Priority** ⚠️
   - Currently using WebGL (older standard)
   - **TODO**: Try WebGPU first, then fallback to WebGL
   - WebGPU is newer and more memory-efficient (2026 standard)

### ❌ Not Implemented (Critical)

1. **Web Workers** ❌ **MOST CRITICAL**
   - Model loading and inference still blocks main thread
   - This is the #1 cause of crashes on mobile
   - Implementation plan: See `WEB-WORKER-IMPLEMENTATION.md`
   - Estimated effort: 4-6 hours

2. **Model Quantization** ❌ **HIGH PRIORITY**
   - Still using FP32 (full precision)
   - Need INT8 or FP16 for 70% size reduction
   - Current model: ~49MB FP32
   - Target: ~15MB INT8 or ~25MB FP16

## Required Next Steps

### Step 1: Re-export Model (REQUIRED BEFORE DEPLOYMENT)
The current model was exported with:
- 100 items vocabulary
- 640x640 input size

**Must re-export with:**
- 20 items vocabulary
- 320x320 input size

```bash
cd /Users/owenwilliams/Projects/widowmaker
python scripts/export-yolo-world.py

# Upload new model
gcloud storage cp yolov8s-worldv2.onnx \
  gs://widowmaker-site-images/models/yolo_world_household_v2.onnx \
  --project=widowmaker-477505

# Make public
gcloud storage objects update \
  gs://widowmaker-site-images/models/yolo_world_household_v2.onnx \
  --add-acl-grant=entity=allUsers,role=READER \
  --project=widowmaker-477505

# Update model URL in detectors.ts
```

### Step 2: Implement Web Workers (CRITICAL)
See `WEB-WORKER-IMPLEMENTATION.md` for complete implementation guide.

**Benefits:**
- Main thread stays responsive during loading
- Browser won't kill tab for "unresponsive script"
- Better crash isolation

**Files to create/modify:**
- `movetrack-app/src/workers/yolo-world.worker.ts` (new)
- `movetrack-app/src/utils/detectors.ts` (modify YoloWorldDetector)
- `movetrack-app/vite.config.ts` (add worker config)

### Step 3: Quantize Model (Optional but Recommended)
Using ONNX Runtime quantization tools:

```bash
pip install onnxruntime-tools

# Quantize to INT8
python -m onnxruntime.quantization.preprocess \
  --input yolov8s-worldv2.onnx \
  --output yolov8s-worldv2-int8.onnx

# Or quantize to FP16
python -m onnxruntime.tools.convert_onnx_models_to_ort \
  --model_path yolov8s-worldv2.onnx \
  --output_dir . \
  --optimization_level 2 \
  --precision fp16
```

**Expected results:**
- INT8: ~15MB (70% smaller), 2x faster inference
- FP16: ~25MB (50% smaller), 1.5x faster inference

### Step 4: Try WebGPU First
Modify `detectors.ts:159` to try execution providers in this order:
```typescript
executionProviders: ['webgpu', 'webgl', 'wasm']
```

WebGPU is the 2026 standard and is more memory-efficient than WebGL on modern devices.

## Expected Performance After All Optimizations

| Metric | Before | After Quick Wins | After All Steps |
|--------|--------|------------------|-----------------|
| Model size | 49MB | 49MB | 15MB (INT8) |
| Input resolution | 640x640 | 320x320 | 320x320 |
| Vocabulary | 100 items | 20 items | 20 items |
| Main thread blocking | Yes | Yes | No (Worker) |
| Inference time | 50-80ms | 25-40ms | 15-25ms |
| Memory per frame | 1.2MB | 300KB | 300KB |
| FPS on iPhone | 8-12 | 15-20 | 25-30 |

## Priority Order

1. **Re-export model** (30 minutes) - Must do before deployment!
2. **Web Workers** (4-6 hours) - Critical for stability
3. **Quantize model** (1 hour) - High impact on performance
4. **WebGPU** (30 minutes) - Nice to have

## Testing Checklist

After each optimization:
- [ ] Test on iPhone (iOS Safari)
- [ ] Test on Android Chrome
- [ ] Verify no console errors
- [ ] Check FPS counter (should be 15-30)
- [ ] Test for 5 minutes continuous use (crash test)
- [ ] Check memory usage in DevTools

## References

- [ONNX Runtime Web Docs](https://onnxruntime.ai/docs/tutorials/web/)
- [Web Workers MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [ONNX Quantization Guide](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
- [WebGPU Support](https://caniuse.com/webgpu)
