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

# ─── PRUNED VOCABULARY (20 items) ───────────────────────────────────────────
# Reduced from 100 to 20 items for mobile performance
# Each item name adds overhead - keeping only the most common moving items

HOUSEHOLD_ITEMS = [
    # Most common moving items (ordered by frequency)
    "box",                    # #1 most common
    "chair",
    "table",
    "sofa",
    "bed",
    "dresser",
    "desk",
    "bookshelf",
    "lamp",
    "mirror",
    "television",
    "mattress",
    "nightstand",
    "rug",
    "cabinet",
    "refrigerator",
    "washer",
    "dryer",
    "bicycle",
    "unknown item",           # Catch-all
]

# Verify we have 20 items
assert len(HOUSEHOLD_ITEMS) == 20, f"Expected 20 items, got {len(HOUSEHOLD_ITEMS)}"

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

print("\n💾 Exporting to ONNX (optimized for mobile)...")
print("  - Input size: 320x320 (4x memory reduction)")
print("  - FP32 precision (INT8/FP16 quantization requires onnxruntime-tools)")
print("")

success = model.export(
    format="onnx",
    imgsz=320,  # Reduced from 640 (4x less memory)
    dynamic=False,  # Fixed size for better optimization
    simplify=True,  # Optimize for inference
    opset=12,  # ONNX opset version (compatible with onnxruntime-web)
    # Note: For INT8/FP16 quantization, use onnxruntime-tools after export:
    # python -m onnxruntime.quantization.preprocess --input yolov8s-worldv2.onnx --output yolov8s-worldv2-int8.onnx
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
