# Mobile Web Live Scan

Real-time object detection using TensorFlow.js + COCO-SSD, with Claude API enrichment.

## How It Works

1. **Camera opens** — requests rear-facing camera (mobile) or default webcam (desktop)
2. **AI model loads** — COCO-SSD (~5 MB) downloads and initializes with WebGL acceleration
3. **Start scanning** — runs object detection at 10-15 FPS, overlays bounding boxes in real-time
4. **Tap to lock** — tap any detected item to "lock it in" (turns green)
5. **Background enrichment** — each locked item sends a cropped frame to Claude API for full attribute extraction
6. **Save to inventory** — once enriched, save all items at once

## Tech Stack

- **@tensorflow/tfjs** + **@tensorflow-models/coco-ssd** — 80 household object classes
- **MediaStream API** — camera access
- **Canvas 2D** — bounding box overlay
- **Claude Vision API** — attribute enrichment (material, weight, dimensions, fragility)

## Access

Dev-only route: `http://localhost:5173/mobile-live-scan`

## Performance

- **Desktop:** 15-20 FPS (smooth)
- **Mobile:** 10-15 FPS (acceptable, battery drain moderate)
- **Model size:** ~5 MB initial download
- **Latency:** Instant detection, 1-2s enrichment per item

## UX Flow

```
Open camera
  ↓
[Model loads — 2-3s]
  ↓
Start scanning
  ↓
Real-time bounding boxes appear (cyan)
  ↓
User taps a detection (e.g., "couch")
  ↓
Bbox turns green, item added to "Detected Items" list as "Processing..."
  ↓
[Background: crop frame, send to Claude API]
  ↓
Item updates with enriched name + attributes (e.g., "3-seat fabric sofa, 120 lbs, fragile: false")
  ↓
Repeat for all items in the room
  ↓
Save to Inventory button (saves all enriched items at once)
```

## Limitations

- **80 classes only** — COCO-SSD detects common objects but misses specialty items
- **No bounding box refinement** — boxes are approximate, not pixel-perfect
- **Battery drain** — continuous WebGL + video processing uses ~15-20% CPU
- **Requires WebGL2** — won't work on very old devices

## Next Steps

- Wire up "Save to Inventory" to actual `/items` POST endpoint
- Add room selection (user picks which room they're scanning)
- Add batch mode (scan multiple rooms, then review all items before saving)
- Compare detection quality vs Twelve Labs Pegasus on the same video

## Code Location

- Frontend: [movetrack-app/src/views/MobileLiveScan.vue](movetrack-app/src/views/MobileLiveScan.vue)
- Route: [movetrack-app/src/router/index.ts](movetrack-app/src/router/index.ts) (line 145)
- Dependencies: `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-webgl`, `@tensorflow-models/coco-ssd`
