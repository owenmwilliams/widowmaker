# A/B Testing YOLO-World Models

## Model Comparison

You can now test both YOLO-World versions side-by-side to compare performance:

### V1 - Original (Baseline)
- **Items:** 100 household items
- **Resolution:** 640x640 pixels
- **Expected FPS:** 15-20 on mobile
- **Model Size:** ~49MB
- **Memory:** ~1.2MB per frame
- **URL:** `yolo_world_household.onnx`

### V2 - Optimized ⚡
- **Items:** 20 essential items
- **Resolution:** 320x320 pixels
- **Expected FPS:** 25-30 on mobile
- **Model Size:** ~15MB (with quantization)
- **Memory:** ~300KB per frame (4x reduction)
- **URL:** `yolo_world_household_v2.onnx`

## How to Test

### Step 1: Deploy Current Code
The latest deployment includes both model options. Cloud Build is running now.

### Step 2: Access Model Selector
1. Open Mobile Live Scan on your iPhone
2. Look for the "Model" dropdown button (model_training icon)
3. You'll see three sections:
   - **YOLO-World (GPU Optimized)**
     - V2 - Optimized ⚡ (default)
     - V1 - Original
   - **Fallback Options**
     - COCO-SSD

### Step 3: Test V2 First (Optimized)
1. App loads with V2 by default
2. Start scanning
3. Observe:
   - Loading time (~5-10 seconds)
   - FPS counter (should be 25-30)
   - Detection accuracy (20 items only)
   - Memory usage (check DevTools)
   - Stability (no crashes after 5 min)

### Step 4: Switch to V1 (Original)
1. Stop scanning
2. Click "Model" dropdown
3. Select "V1 - Original"
4. Wait for model to load
5. Start scanning
6. Compare:
   - Loading time (should be longer)
   - FPS counter (should be 15-20)
   - Detection variety (100 items)
   - Any performance degradation

### Step 5: Switch to COCO-SSD (Baseline)
1. Test COCO-SSD as ultimate fallback
2. Should be fastest but least comprehensive

## What to Look For

### V2 Should Be Better At:
- ✅ Faster loading (smaller model)
- ✅ Higher FPS (25-30 vs 15-20)
- ✅ Less memory pressure
- ✅ Smoother UI (no jank)
- ✅ No crashes on continuous use

### V2 Trade-off:
- ⚠️ Only detects 20 items vs 100
- But these are the most common moving items:
  - box, chair, table, sofa, bed, dresser, desk, bookshelf, lamp, mirror
  - television, mattress, nightstand, rug, cabinet, refrigerator, washer, dryer, bicycle

## Current Status

### ⚠️ V2 Model Not Yet Uploaded
The V2 model needs to be re-exported and uploaded before it will work:

```bash
# 1. Re-export model with new settings (20 items, 320x320)
cd /Users/owenwilliams/Projects/widowmaker
python scripts/export-yolo-world.py

# 2. Upload to GCS as V2
gcloud storage cp yolov8s-worldv2.onnx \
  gs://widowmaker-site-images/models/yolo_world_household_v2.onnx \
  --project=widowmaker-477505

# 3. Make public
gcloud storage objects update \
  gs://widowmaker-site-images/models/yolo_world_household_v2.onnx \
  --add-acl-grant=entity=allUsers,role=READER \
  --project=widowmaker-477505
```

Until V2 is uploaded, selecting V2 will fail to load. V1 will continue working with the existing model.

## Performance Expectations

| Metric | V1 (Original) | V2 (Optimized) | Improvement |
|--------|---------------|----------------|-------------|
| Load time | 10-15s | 5-10s | 2x faster |
| Model size | 49MB | ~15MB | 70% smaller (with quantization) |
| FPS | 15-20 | 25-30 | 50% faster |
| Memory/frame | 1.2MB | 300KB | 4x reduction |
| Vocabulary | 100 items | 20 items | Trade-off |
| Crashes | Possible | Unlikely | Much more stable |

## Recommended Testing Sequence

1. **Test V2 first** (default) - Should be fast and stable
2. **Switch to V1** - Compare performance drop
3. **Back to V2** - Confirm preference
4. **Try COCO-SSD** - Verify it's still fastest (but least useful)

## Decision Criteria

Choose V2 if:
- ✅ No crashes after 5+ minutes
- ✅ FPS consistently 25-30
- ✅ 20 items covers your needs
- ✅ Loading is acceptably fast

Stay with V1 if:
- ❌ V2 crashes or lags
- ❌ Need all 100 items
- ❌ Can tolerate lower FPS

## After Testing

Once you confirm V2 works better:
1. Keep V2 as default
2. Consider removing V1 to simplify UI
3. Move forward with Web Workers implementation
4. Add INT8 quantization for even better performance

## Monitoring

Check browser console for:
```
[YOLO-World] Loading model from ...v2.onnx...
[YOLO-World] Model loaded successfully with WebGL (GPU)
[YOLO-World] Using execution provider: webgl
```

If you see errors loading V2, it means the model hasn't been uploaded yet. Use V1 in the meantime.
