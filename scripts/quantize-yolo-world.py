#!/usr/bin/env python3
"""
Quantize YOLO-World V2 model to INT8 for 70% size reduction and 2x faster inference.

This script uses ONNX Runtime's dynamic quantization to convert the FP32 model
to INT8, significantly reducing model size and improving inference speed on
CPU and mobile devices.
"""

import os
import sys
from pathlib import Path

print("=" * 60)
print("YOLO-World V2 Model Quantization")
print("=" * 60)

# Check if model exists
model_path = Path("yolov8s-worldv2.onnx")
if not model_path.exists():
    print(f"❌ Error: Model not found at {model_path}")
    print("   Run: python scripts/export-yolo-world.py first")
    sys.exit(1)

# Get model size
model_size_mb = model_path.stat().st_size / (1024 * 1024)
print(f"📦 Input model: {model_path}")
print(f"   Size: {model_size_mb:.1f} MB (FP32)")

# Import quantization tools
try:
    from onnxruntime.quantization import quantize_dynamic, QuantType
    print("✓ ONNX Runtime quantization tools loaded")
except ImportError as e:
    print(f"❌ Error: Failed to import onnxruntime.quantization")
    print(f"   {e}")
    print("   Install: pip install onnxruntime")
    sys.exit(1)

# Output path
output_path = Path("yolov8s-worldv2-int8.onnx")

print("\n🔧 Quantizing to INT8...")
print("   This will:")
print("   - Convert FP32 weights to INT8 (8-bit integers)")
print("   - Reduce model size by ~70%")
print("   - Speed up inference by ~2x on CPU/mobile")
print("   - Minimal accuracy loss (<1% mAP)")

try:
    quantize_dynamic(
        model_input=str(model_path),
        model_output=str(output_path),
        weight_type=QuantType.QUInt8,  # Unsigned 8-bit integers
        per_channel=False,  # Per-tensor quantization (better compatibility)
        reduce_range=False,  # Don't reduce range (better accuracy)
        extra_options={
            'ActivationSymmetric': False,  # Asymmetric quantization for better accuracy
            'WeightSymmetric': True,  # Symmetric for weights
        }
    )
    print("✓ Quantization complete!")
except Exception as e:
    print(f"❌ Error during quantization:")
    print(f"   {e}")
    sys.exit(1)

# Get quantized model size
quantized_size_mb = output_path.stat().st_size / (1024 * 1024)
reduction_pct = (1 - quantized_size_mb / model_size_mb) * 100

print(f"\n📊 Results:")
print(f"   Original: {model_size_mb:.1f} MB (FP32)")
print(f"   Quantized: {quantized_size_mb:.1f} MB (INT8)")
print(f"   Reduction: {reduction_pct:.1f}%")
print(f"   Output: {output_path}")

print("\n✅ Quantization successful!")
print("\n" + "=" * 60)
print("Next steps:")
print("=" * 60)
print("1. Upload to GCS:")
print(f"   gcloud storage cp {output_path} \\")
print(f"     gs://widowmaker-site-images/models/yolo_world_household_v2_int8.onnx \\")
print(f"     --project=widowmaker-477505")
print()
print("2. Make public:")
print(f"   gcloud storage objects update \\")
print(f"     gs://widowmaker-site-images/models/yolo_world_household_v2_int8.onnx \\")
print(f"     --add-acl-grant=entity=allUsers,role=READER \\")
print(f"     --project=widowmaker-477505")
print()
print("3. Update detector to use quantized model")
print("=" * 60)
