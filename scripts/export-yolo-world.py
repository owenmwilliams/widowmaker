#!/usr/bin/env python3
"""
YOLO-World Offline Vocabulary Export Script

This script loads YOLO-World and "bakes" a custom vocabulary of household items
into the model weights, then exports to ONNX for fast browser inference.

Usage:
    python export-yolo-world.py

Output:
    - yolo_world_household.onnx (~50MB)
    - household_items.json (vocabulary used)

Requirements:
    pip install ultralytics torch onnx numpy
"""

import json
import torch
from ultralytics import YOLO

# ─── Comprehensive Household Items Vocabulary (100 items) ────────────────────

HOUSEHOLD_ITEMS = [
    # Unknown/Generic
    "unknown item",
    "box",
    "container",

    # Furniture - Living Room
    "sofa",
    "couch",
    "sectional sofa",
    "loveseat",
    "armchair",
    "recliner",
    "coffee table",
    "ottoman",
    "end table",
    "side table",
    "console table",
    "tv stand",
    "entertainment center",
    "bookshelf",
    "bookcase",

    # Furniture - Bedroom
    "bed",
    "bed frame",
    "mattress",
    "box spring",
    "nightstand",
    "bedside table",
    "dresser",
    "chest of drawers",
    "wardrobe",
    "armoire",
    "vanity",
    "linens",

    # Furniture - Dining
    "dining table",
    "dining chair",
    "bar stool",
    "china cabinet",
    "buffet",
    "sideboard",

    # Furniture - Office
    "desk",
    "office chair",
    "filing cabinet",

    # Storage & Organization
    "moving box",
    "plastic bin",
    "storage container",
    "tote",
    "basket",
    "laundry basket",
    "hamper",
    "chest",

    # Lighting
    "floor lamp",
    "table lamp",
    "desk lamp",
    "chandelier",
    "pendant light",
    "ceiling fan",

    # Electronics
    "television",
    "monitor",
    "computer",
    "laptop",
    "desktop computer",
    "printer",
    "speaker",
    "stereo",
    "gaming console",
    "router",
    "electronic device",

    # Appliances - Kitchen
    "refrigerator",
    "stove",
    "oven",
    "microwave",
    "dishwasher",
    "coffee maker",
    "toaster",
    "blender",
    "food processor",
    "stand mixer",

    # Appliances - Laundry
    "washing machine",
    "dryer",

    # Textiles & Soft Goods
    "rug",
    "carpet",
    "curtains",
    "drapes",
    "blinds",
    "pillow",
    "cushion",

    # Decor & Accessories
    "mirror",
    "artwork",
    "vase",
    "plant",
    "potted plant",
    "clock",
    "sculpture",

    # Outdoor & Miscellaneous
    "bicycle",
    "sports equipment",
    "suitcase",
    "luggage",
    "vacuum cleaner",
    "fan",
    "heater",
    "air conditioner",
    "tool box",
    "ladder",
]

# Verify we have 100 items
assert len(HOUSEHOLD_ITEMS) == 100, f"Expected 100 items, got {len(HOUSEHOLD_ITEMS)}"

print(f"✓ Loaded {len(HOUSEHOLD_ITEMS)} household items")
print(f"  First 5: {HOUSEHOLD_ITEMS[:5]}")
print(f"  Last 5: {HOUSEHOLD_ITEMS[-5:]}")


# ─── Load YOLO-World Model ────────────────────────────────────────────────────

print("\n📦 Loading YOLO-World model...")
model = YOLO("yolov8s-worldv2.pt")  # Small model, good balance
print("✓ Model loaded")


# ─── Set Custom Vocabulary ────────────────────────────────────────────────────

print(f"\n🔧 Setting custom vocabulary ({len(HOUSEHOLD_ITEMS)} items)...")
model.set_classes(HOUSEHOLD_ITEMS)
print("✓ Vocabulary set")


# ─── Export to ONNX ───────────────────────────────────────────────────────────

print("\n💾 Exporting to ONNX...")
success = model.export(
    format="onnx",
    imgsz=640,  # Standard YOLO size
    dynamic=True,  # Support variable input sizes
    simplify=True,  # Optimize for inference
    opset=12,  # ONNX opset version (compatible with onnxruntime-web)
)

if success:
    print("✓ Export successful!")
    print(f"  Output: yolov8s-worldv2.onnx")
else:
    print("✗ Export failed")
    exit(1)


# ─── Save Vocabulary List ─────────────────────────────────────────────────────

vocab_file = "household_items.json"
with open(vocab_file, "w") as f:
    json.dump({
        "items": HOUSEHOLD_ITEMS,
        "count": len(HOUSEHOLD_ITEMS),
        "model": "yolov8s-worldv2",
        "version": "1.0"
    }, f, indent=2)

print(f"\n✓ Vocabulary saved to {vocab_file}")


# ─── Summary ──────────────────────────────────────────────────────────────────

print("\n" + "="*60)
print("✅ YOLO-World Export Complete!")
print("="*60)
print(f"Model file:      yolov8s-worldv2.onnx (~50MB)")
print(f"Vocabulary:      {vocab_file}")
print(f"Items included:  {len(HOUSEHOLD_ITEMS)}")
print(f"\nNext steps:")
print(f"  1. Upload yolov8s-worldv2.onnx to GCS or commit to repo")
print(f"  2. Load in browser with onnxruntime-web")
print(f"  3. Run detection at 30+ FPS!")
print("="*60)
