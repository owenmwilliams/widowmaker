# Vision Architecture

This codebase separates vision by capture intent and execution context.

## 1) Single Item Capture
- **App**: `movetrack-app/src/components/capture/PhotoCapture.vue`
- **API**: `movetrack-api/routes/vision/index.js` (`/vision/analyze-item`)
- **Service**: `movetrack-api/services/vision/visionService.js`

## 2) Multi Item Capture (single image)
- **App**: `movetrack-app/src/components/capture/PhotoCapture.vue`
- **API**: `movetrack-api/routes/vision/index.js` (`/vision/analyze-multi-item`)
- **Service**: `movetrack-api/services/vision/visionService.js`

## 3) Batch Item Capture (multiple images)
- **App**: `movetrack-app/src/experimental/vision/MobileLiveScan.vue`
- **API**: `movetrack-api/routes/vision/index.js` (`/vision/analyze-batch`)
- **Service**: `movetrack-api/services/vision/visionService.js`

## 4) Video Capture (Gemini)
- **App**:
  - `movetrack-app/src/components/capture/VideoInventoryScan.vue`
  - `movetrack-app/src/features/vision/video/GeminiVideoCapture.vue`
- **API**: `movetrack-api/routes/vision/video-gemini.js` (`/vision/video/*`)
- **Service**: `movetrack-api/services/vision/geminiVideoScanService.js`

## 5) Item Augmentation
- **API**: `movetrack-api/routes/vision/index.js` (`/vision/augment-item`)
- **Service**: `movetrack-api/services/vision/augmentationService.js`
- **Usage**: Called by frontend when enrichment is needed beyond detection.

## 6) Image Services (resize/crop/normalize)
- **Services**: `movetrack-api/services/images/*`
  - `bbox.js`: normalize and clamp bounding boxes
  - `crop.js`: bbox-based crops with EXIF handling
  - `transform.js`: resize/upscale/downscale helpers

## 7) Experimental (Admin Only)
- **App**: `movetrack-app/src/experimental/vision/*`
- **API**: `movetrack-api/routes/experimental/*`
- **Data**: `movetrack-api/data/experimental/visionLab.json`

## Notes
- **Multi-item** = multiple items in a single image.
- **Analyze-batch** = multiple images in one request.
- **Video capture** is user-facing, Gemini-backed, and mounted at `/vision/video/*`.
