# YOLOv8 Dataset Preparation (Household Coarse Classes)

This guide builds a custom YOLOv8-nano detector for six coarse household categories. The on-device model is coarse only and optimized for real-time UX feedback. Fine-grained identification is handled by the Stage 2 VLM using the raw crops, so do not add fine labels to this model.

## Target Categories

| Class ID | Label | Description | Example source labels |
|----------|-------|-------------|------------------------|
| 0 | large_furniture | Big items that will not be boxed | couch, bed, dining table, chair, desk, wardrobe, bookshelf, rug |
| 1 | appliance | Kitchen, laundry, electronics | refrigerator, oven, microwave, TV, monitor, washing machine |
| 2 | fragile_high_value | Items needing special packing materials | vase, wine glass, mirror, picture frame, clock, lamp |
| 3 | special_handling | Oddly shaped or needs specialty movers | potted plant, bicycle, surfboard, skis, guitar, piano |
| 4 | boxable_items | General smaller items | books, bottles, cups, toys, shoes, bags, kitchenware |
| 5 | storage_container | Existing boxes, bins, luggage | suitcase, backpack, handbag, box, basket, bin |

### Ambiguity Rules (Use Handling, Not Object Type)

- Table lamp -> fragile_high_value.
- Small cabinet -> large_furniture if it is freestanding and not boxed.
- Electronics split: monitors/laptops stay in appliance; remotes/keyboards/mice are boxable_items.
- When in doubt, classify by how a mover would handle the item.

## Prerequisites

```bash
python3 -m venv venv
source venv/bin/activate
pip install fiftyone ultralytics opencv-python-headless Pillow tqdm scikit-learn
```

## Dataset Root

```bash
mkdir -p ~/yolo-household/datasets
```

## Step 1: Download COCO 2017

COCO must be in the standard layout below so the remap script can read the JSON annotations.

```bash
# Images
wget http://images.cocodataset.org/zips/train2017.zip
wget http://images.cocodataset.org/zips/val2017.zip

# Annotations
wget http://images.cocodataset.org/annotations/annotations_trainval2017.zip

# Unzip
unzip train2017.zip -d ~/yolo-household/datasets/coco/
unzip val2017.zip -d ~/yolo-household/datasets/coco/
unzip annotations_trainval2017.zip -d ~/yolo-household/datasets/coco/
```

Expected structure:

```
~/yolo-household/datasets/coco/
  train2017/
  val2017/
  annotations/
```

## Step 2: Verify Open Images Class Names

Before hardcoding Open Images labels, verify against the actual OI V7 class list and only use the exact cased names that exist.

```bash
python tooling/yolov8/verify_open_images_classes.py --write
```

This writes `tooling/yolov8/open_images_classes_verified.json`. If any desired class is missing, update the script's candidate list or fallbacks.

## Step 3: Download Open Images Subset

```bash
python tooling/yolov8/download_open_images.py --max-samples 20000
```

Notes:
- Increase `--max-samples` if you have disk space. Do not cap COCO.
- Prioritize collecting more `special_handling` and `fragile_high_value` images (real estate photos help most).

## Step 4: Remap Labels to Coarse Classes

```bash
python tooling/yolov8/remap_labels.py \
  --coco-dir ~/yolo-household/datasets/coco \
  --output-dir ~/yolo-household/datasets/household_combined
```

This produces:

```
~/yolo-household/datasets/household_combined/
  coco/images/train
  coco/images/val
  coco/labels/train
  coco/labels/val
  open_images/images/train
  open_images/labels/train
```

## Step 5: Stratified Open Images Val Split + Oversampled Train List

We hold out 15% of Open Images for validation, stratified by each image's primary class (the class with the most annotations in that image). Then we create a `train.txt` list where minority-class Open Images images are repeated to oversample.

```bash
python tooling/yolov8/build_train_val_lists.py \
  --dataset-dir ~/yolo-household/datasets/household_combined \
  --val-fraction 0.15
```

Outputs:

```
~/yolo-household/datasets/household_combined/lists/
  train.txt
  val.txt
  coco_train.txt
  coco_val.txt
  open_images_train.txt
  open_images_val.txt
```

Oversampling defaults:
- special_handling: 3x
- fragile_high_value: 2x
- storage_container: 2x

Adjust in `tooling/yolov8/build_train_val_lists.py` if needed.

## Step 6: Validate Dataset

```bash
python tooling/yolov8/validate_dataset.py \
  --dataset-dir ~/yolo-household/datasets/household_combined
```

## Step 7: Create YOLOv8 Dataset Config

```yaml
# household_dataset.yaml
path: ~/yolo-household/datasets/household_combined
train: lists/train.txt
val: lists/val.txt

names:
  0: large_furniture
  1: appliance
  2: fragile_high_value
  3: special_handling
  4: boxable_items
  5: storage_container
```

## Step 8: Train YOLOv8-nano

```python
from ultralytics import YOLO

model = YOLO("yolov8n.pt")

results = model.train(
    data="household_dataset.yaml",
    epochs=100,
    imgsz=640,
    batch=16,
    patience=15,
    device=0,
    project="runs",
    name="household_v1",
    hsv_h=0.015,
    hsv_s=0.5,
    hsv_v=0.3,
    degrees=5.0,
    translate=0.1,
    scale=0.3,
    fliplr=0.5,
    mosaic=1.0,
)

metrics = model.val()
print(f"mAP50: {metrics.box.map50:.4f}")
print(f"mAP50-95: {metrics.box.map:.4f}")

# Export for mobile
model.export(format="coreml", int8=True)
model.export(format="coreml", half=True)
model.export(format="tflite", int8=True)
model.export(format="tflite", half=True)
```

## Metrics Targets

- Overall mAP50 > 0.70
- Per-class mAP50 minimums:
  - large_furniture, appliance, boxable_items: > 0.75
  - fragile_high_value, storage_container: > 0.60
  - special_handling: > 0.50

If special_handling stays below 0.50, consider merging into large_furniture for v1 and let the VLM handle special handling in Stage 2.

## Execution Checklist

```
[ ] 1. Download COCO 2017 (train/val + annotations)
[ ] 2. Verify Open Images class list and generate verified JSON
[ ] 3. Download Open Images subset
[ ] 4. Remap COCO + Open Images to coarse classes
[ ] 5. Build stratified val split and oversampled train list
[ ] 6. Validate dataset
[ ] 7. Create household_dataset.yaml
[ ] 8. Train and evaluate
[ ] 9. Export INT8 + FP16
```
