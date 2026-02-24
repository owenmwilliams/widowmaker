# COCO-SSD Limitations & Alternative Models

## What COCO-SSD Detects (80 Classes)

The model currently used in Mobile Live Scan is pre-trained on the COCO dataset with these categories:

### Household Items It DOES Detect:
- **Furniture**: chair, couch, bed, dining table
- **Electronics**: tv, laptop, keyboard, mouse, remote, cell phone
- **Kitchen**: microwave, oven, toaster, sink, refrigerator, bottle, wine glass, cup, fork, knife, spoon, bowl
- **Misc**: potted plant, clock, vase, book, toilet

### Complete COCO Class List:
person, bicycle, car, motorcycle, airplane, bus, train, truck, boat, traffic light, fire hydrant, stop sign, parking meter, bench, bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe, backpack, umbrella, handbag, tie, suitcase, frisbee, skis, snowboard, sports ball, kite, baseball bat, baseball glove, skateboard, surfboard, tennis racket, bottle, wine glass, cup, fork, knife, spoon, bowl, banana, apple, sandwich, orange, broccoli, carrot, hot dog, pizza, donut, cake, chair, couch, potted plant, bed, dining table, toilet, tv, laptop, mouse, remote, keyboard, cell phone, microwave, oven, toaster, sink, refrigerator, book, clock, vase, scissors, teddy bear, hair drier, toothbrush

---

## Critical Missing Items for Moving Inventory

### Furniture
- ❌ Dresser / chest of drawers
- ❌ Nightstand / bedside table
- ❌ Bookshelf / bookcase
- ❌ Cabinet / armoire
- ❌ Entertainment center / TV stand
- ❌ Desk / writing table
- ❌ Filing cabinet
- ❌ Coffee table / side table
- ❌ Wardrobe / closet
- ❌ Shelving units

### Lighting
- ❌ Table lamp
- ❌ Floor lamp
- ❌ Chandelier
- ❌ Light fixtures
- ❌ Desk lamp

### Textiles & Soft Goods
- ❌ Rugs / carpets
- ❌ Curtains / drapes
- ❌ Blinds / shades
- ❌ Pillows / cushions
- ❌ Bedding / linens
- ❌ Towels
- ❌ Blankets / throws

### Storage & Organization
- ❌ Cardboard boxes
- ❌ Plastic bins / totes
- ❌ Baskets
- ❌ Storage containers
- ❌ Shelving systems
- ❌ Organizers

### Kitchen & Appliances
- ❌ Dishwasher
- ❌ Washing machine
- ❌ Dryer
- ❌ Stove / range
- ❌ Coffee maker
- ❌ Blender
- ❌ Food processor
- ❌ Stand mixer
- ❌ Dishes / plates
- ❌ Pots & pans
- ❌ Utensils (beyond basic fork/knife/spoon)
- ❌ Small appliances

### Office & Electronics
- ❌ Printer
- ❌ Monitor / display
- ❌ Office chair (specific)
- ❌ Filing cabinet
- ❌ Desk accessories
- ❌ Routers / networking equipment
- ❌ Speakers / audio equipment
- ❌ Gaming consoles

### Decor & Accessories
- ❌ Mirrors
- ❌ Picture frames
- ❌ Artwork / paintings
- ❌ Wall decor
- ❌ Sculptures / figurines
- ❌ Candles / holders
- ❌ Plants (beyond "potted plant")

### Tools & Hardware
- ❌ Power tools
- ❌ Hand tools
- ❌ Tool boxes
- ❌ Hardware / fasteners
- ❌ Ladders
- ❌ Extension cords

---

## Alternative Models for Better Household Detection

### 🥇 Recommended: OwlViT (Google)
**Best for moving inventory - zero-shot detection**

**Advantages:**
- Detects ANY object you describe in natural language
- Can search for "dresser", "cardboard box", "floor lamp", etc.
- Available via Transformers.js (runs in browser)
- No pre-defined class limitations

**Implementation:**
```typescript
import { pipeline } from '@xenova/transformers';

const detector = await pipeline('zero-shot-object-detection',
  'Xenova/owlvit-base-patch32');

const results = await detector(image, {
  candidate_labels: [
    'dresser', 'nightstand', 'bookshelf', 'cardboard box',
    'floor lamp', 'mirror', 'rug', 'curtains', 'pillow'
  ]
});
```

**Tradeoffs:**
- Slower than COCO-SSD (~2-3x)
- Requires defining text prompts
- Larger model size (~200MB vs 13MB)

---

### 🥈 Alternative: YOLOv8
**Faster and more accurate, trainable on custom datasets**

**Advantages:**
- State-of-the-art accuracy
- Very fast inference
- Can train on custom household dataset
- Available via ONNX Runtime Web

**Implementation:**
```typescript
import * as ort from 'onnxruntime-web';

const session = await ort.InferenceSession.create('yolov8n.onnx');
const results = await session.run(inputTensor);
```

**Tradeoffs:**
- Still limited to training dataset
- Requires custom training for full household coverage
- ONNX setup more complex than TF.js

---

### 🥉 Alternative: Florence-2 (Microsoft)
**Vision-language model with detection + description**

**Advantages:**
- Can detect AND describe objects
- Better understanding of context
- Available via Transformers.js

**Tradeoffs:**
- Much larger model (~500MB)
- Slower inference
- Overkill for simple detection

---

## Recommendation

For your moving inventory use case, **OwlViT is the best choice** because:

1. ✅ No class limitations - can detect ANY household item
2. ✅ Runs in browser (no server costs)
3. ✅ Natural language queries ("cardboard moving box", "wooden dresser")
4. ✅ Good enough performance on modern phones

You could create a curated list of ~50 common moving inventory items as prompts:
- Furniture (dresser, nightstand, bookshelf, desk, etc.)
- Storage (boxes, bins, totes, etc.)
- Appliances (washer, dryer, dishwasher, etc.)
- Decor (mirrors, lamps, rugs, curtains, etc.)

The model would search for all of them in each frame and return only what it finds.

---

## Implementation Plan

1. **Phase 1**: Add OwlViT alongside COCO-SSD
   - Let users toggle between models
   - Define household-specific prompt list
   - Test performance on mobile

2. **Phase 2**: Optimize prompt list
   - Based on actual user inventory data
   - Group by room type
   - Add user-customizable prompts

3. **Phase 3**: Hybrid approach
   - Use COCO-SSD for fast initial scan
   - Use OwlViT for missed items / refinement
   - Best of both worlds: speed + coverage
