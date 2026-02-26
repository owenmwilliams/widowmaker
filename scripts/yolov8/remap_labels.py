#!/usr/bin/env python3
"""Remap COCO and Open Images labels to coarse household categories in YOLO format."""

import argparse
import json
import os
from collections import defaultdict
from pathlib import Path

from tqdm import tqdm

# Maps source dataset labels (lowercase) to coarse category
LABEL_MAP = {
    # large_furniture (0)
    "couch": "large_furniture",
    "sofa": "large_furniture",
    "bed": "large_furniture",
    "dining table": "large_furniture",
    "table": "large_furniture",
    "chair": "large_furniture",
    "desk": "large_furniture",
    "bench": "large_furniture",
    "wardrobe": "large_furniture",
    "bookcase": "large_furniture",
    "bookshelf": "large_furniture",
    "shelf": "large_furniture",
    "cabinet": "large_furniture",
    "cupboard": "large_furniture",
    "cabinetry": "large_furniture",
    "chest of drawers": "large_furniture",
    "dresser": "large_furniture",
    "coffee table": "large_furniture",
    "filing cabinet": "large_furniture",
    "stool": "large_furniture",
    "rug": "large_furniture",

    # appliance (1)
    "refrigerator": "appliance",
    "oven": "appliance",
    "microwave": "appliance",
    "microwave oven": "appliance",
    "toaster": "appliance",
    "blender": "appliance",
    "coffeemaker": "appliance",
    "washing machine": "appliance",
    "dishwasher": "appliance",
    "tv": "appliance",
    "television": "appliance",
    "computer monitor": "appliance",
    "monitor": "appliance",
    "laptop": "appliance",
    "cell phone": "appliance",

    # fragile_high_value (2)
    "vase": "fragile_high_value",
    "wine glass": "fragile_high_value",
    "mirror": "fragile_high_value",
    "picture frame": "fragile_high_value",
    "clock": "fragile_high_value",
    "lamp": "fragile_high_value",
    "table lamp": "fragile_high_value",
    "floor lamp": "fragile_high_value",
    "candle": "fragile_high_value",
    "sculpture": "fragile_high_value",
    "painting": "fragile_high_value",
    "ceramic": "fragile_high_value",
    "glassware": "fragile_high_value",
    "whiteboard": "fragile_high_value",

    # special_handling (3)
    "bicycle": "special_handling",
    "potted plant": "special_handling",
    "houseplant": "special_handling",
    "surfboard": "special_handling",
    "skis": "special_handling",
    "ski": "special_handling",
    "snowboard": "special_handling",
    "guitar": "special_handling",
    "musical instrument": "special_handling",
    "drum": "special_handling",
    "piano": "special_handling",
    "ceiling fan": "special_handling",
    "chandelier": "special_handling",
    "light fixture": "special_handling",
    "ceiling light": "special_handling",
    "aquarium": "special_handling",
    "fish tank": "special_handling",

    # boxable_items (4)
    "book": "boxable_items",
    "bottle": "boxable_items",
    "cup": "boxable_items",
    "mug": "boxable_items",
    "bowl": "boxable_items",
    "plate": "boxable_items",
    "fork": "boxable_items",
    "knife": "boxable_items",
    "kitchen knife": "boxable_items",
    "spoon": "boxable_items",
    "cutting board": "boxable_items",
    "frying pan": "boxable_items",
    "kettle": "boxable_items",
    "scissors": "boxable_items",
    "teddy bear": "boxable_items",
    "toy": "boxable_items",
    "doll": "boxable_items",
    "remote": "boxable_items",
    "keyboard": "boxable_items",
    "mouse": "boxable_items",
    "shoe": "boxable_items",
    "boot": "boxable_items",
    "pillow": "boxable_items",
    "towel": "boxable_items",
    "hair drier": "boxable_items",
    "toothbrush": "boxable_items",
    "curtain": "boxable_items",

    # storage_container (5)
    "suitcase": "storage_container",
    "backpack": "storage_container",
    "handbag": "storage_container",
    "briefcase": "storage_container",
    "box": "storage_container",
    "luggage and bags": "storage_container",
}

CLASS_IDS = {
    "large_furniture": 0,
    "appliance": 1,
    "fragile_high_value": 2,
    "special_handling": 3,
    "boxable_items": 4,
    "storage_container": 5,
}

DEFAULT_OPEN_IMAGES_DATASET = "open-images-v7-household-train"


def remap_coco(coco_dir, output_dir, split="train"):
    ann_file = os.path.join(coco_dir, "annotations", f"instances_{split}2017.json")
    img_dir = os.path.join(coco_dir, f"{split}2017")

    print(f"Loading COCO {split} annotations from {ann_file}...")
    with open(ann_file, "r") as f:
        coco = json.load(f)

    cat_id_to_name = {cat["id"]: cat["name"].lower() for cat in coco["categories"]}
    img_id_to_info = {img["id"]: img for img in coco["images"]}

    img_annotations = defaultdict(list)
    skipped = 0
    remapped = 0

    for ann in coco["annotations"]:
        cat_name = cat_id_to_name.get(ann["category_id"], "")
        coarse_label = LABEL_MAP.get(cat_name)

        if coarse_label is None:
            skipped += 1
            continue

        remapped += 1
        img_annotations[ann["image_id"]].append(
            {
                "bbox": ann["bbox"],
                "class_id": CLASS_IDS[coarse_label],
            }
        )

    print(f"  Remapped {remapped} annotations, skipped {skipped} (no mapping)")

    out_img_dir = Path(output_dir) / "coco" / "images" / split
    out_lbl_dir = Path(output_dir) / "coco" / "labels" / split
    out_img_dir.mkdir(parents=True, exist_ok=True)
    out_lbl_dir.mkdir(parents=True, exist_ok=True)

    images_written = 0
    for img_id, anns in tqdm(img_annotations.items(), desc=f"Writing COCO {split}"):
        img_info = img_id_to_info[img_id]
        img_w = img_info["width"]
        img_h = img_info["height"]
        filename = img_info["file_name"]
        stem = Path(filename).stem

        yolo_lines = []
        for ann in anns:
            bx, by, bw, bh = ann["bbox"]
            x_center = (bx + bw / 2) / img_w
            y_center = (by + bh / 2) / img_h
            w_norm = bw / img_w
            h_norm = bh / img_h

            x_center = max(0, min(1, x_center))
            y_center = max(0, min(1, y_center))
            w_norm = max(0, min(1, w_norm))
            h_norm = max(0, min(1, h_norm))

            yolo_lines.append(
                f"{ann['class_id']} {x_center:.6f} {y_center:.6f} {w_norm:.6f} {h_norm:.6f}"
            )

        label_path = out_lbl_dir / f"{stem}.txt"
        label_path.write_text("\n".join(yolo_lines))

        src_img = Path(img_dir) / filename
        dst_img = out_img_dir / filename
        if src_img.exists() and not dst_img.exists():
            dst_img.symlink_to(src_img.resolve())

        images_written += 1

    print(f"  Wrote {images_written} images to {out_img_dir}")
    return images_written


def remap_open_images_fiftyone(output_dir, dataset_name=DEFAULT_OPEN_IMAGES_DATASET):
    import fiftyone as fo

    if dataset_name not in fo.list_datasets():
        print(
            f"  Dataset '{dataset_name}' not found in FiftyOne. Run download_open_images.py first."
        )
        return 0

    dataset = fo.load_dataset(dataset_name)

    out_img_dir = Path(output_dir) / "open_images" / "images" / "train"
    out_lbl_dir = Path(output_dir) / "open_images" / "labels" / "train"
    out_img_dir.mkdir(parents=True, exist_ok=True)
    out_lbl_dir.mkdir(parents=True, exist_ok=True)

    images_written = 0
    skipped = 0
    remapped = 0

    for sample in tqdm(dataset, desc="Remapping Open Images train"):
        if sample.ground_truth is None:
            continue

        yolo_lines = []
        for det in sample.ground_truth.detections:
            label = det.label.lower()
            coarse_label = LABEL_MAP.get(label)

            if coarse_label is None:
                skipped += 1
                continue

            remapped += 1

            bx, by, bw, bh = det.bounding_box
            x_center = bx + bw / 2
            y_center = by + bh / 2

            yolo_lines.append(
                f"{CLASS_IDS[coarse_label]} {x_center:.6f} {y_center:.6f} {bw:.6f} {bh:.6f}"
            )

        if not yolo_lines:
            continue

        stem = Path(sample.filepath).stem
        label_path = out_lbl_dir / f"{stem}.txt"
        label_path.write_text("\n".join(yolo_lines))

        dst_img = out_img_dir / Path(sample.filepath).name
        if not dst_img.exists():
            dst_img.symlink_to(Path(sample.filepath).resolve())

        images_written += 1

    print(f"  Remapped {remapped} annotations, skipped {skipped}")
    print(f"  Wrote {images_written} images to {out_img_dir}")
    return images_written


def main():
    parser = argparse.ArgumentParser(description="Remap COCO and Open Images labels")
    parser.add_argument(
        "--coco-dir",
        default=os.path.expanduser("~/yolo-household/datasets/coco"),
        help="Path to COCO root directory",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.expanduser("~/yolo-household/datasets/household_combined"),
        help="Output directory",
    )
    parser.add_argument(
        "--skip-open-images",
        action="store_true",
        help="Skip Open Images remap",
    )
    parser.add_argument(
        "--open-images-dataset",
        default=DEFAULT_OPEN_IMAGES_DATASET,
        help="FiftyOne dataset name for Open Images",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("STEP 1: Remap COCO train split")
    print("=" * 60)
    remap_coco(args.coco_dir, output_dir, split="train")

    print("\n" + "=" * 60)
    print("STEP 2: Remap COCO val split")
    print("=" * 60)
    remap_coco(args.coco_dir, output_dir, split="val")

    if not args.skip_open_images:
        print("\n" + "=" * 60)
        print("STEP 3: Remap Open Images train")
        print("=" * 60)
        remap_open_images_fiftyone(output_dir, dataset_name=args.open_images_dataset)


if __name__ == "__main__":
    main()
