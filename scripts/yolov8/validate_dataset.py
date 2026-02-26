#!/usr/bin/env python3
"""Sanity checks for the remapped dataset using train/val lists."""

import argparse
import random
from collections import defaultdict
from pathlib import Path

from PIL import Image

CLASS_NAMES = [
    "large_furniture",
    "appliance",
    "fragile_high_value",
    "special_handling",
    "boxable_items",
    "storage_container",
]


def image_to_label_path(dataset_dir, image_rel_path):
    image_path = Path(dataset_dir) / image_rel_path
    label_path = Path(str(image_path).replace("/images/", "/labels/"))
    return label_path.with_suffix(".txt")


def load_list(path):
    return [line.strip() for line in path.read_text().splitlines() if line.strip()]


def validate_split(dataset_dir, list_path):
    images = load_list(list_path)

    missing_images = 0
    missing_labels = 0
    bad_labels = 0
    class_counts = defaultdict(int)

    for rel_path in images:
        img_path = Path(dataset_dir) / rel_path
        if not img_path.exists():
            missing_images += 1
            continue

        label_path = image_to_label_path(dataset_dir, rel_path)
        if not label_path.exists():
            missing_labels += 1
            continue

        for line_num, line in enumerate(label_path.read_text().splitlines(), 1):
            parts = line.strip().split()
            if len(parts) != 5:
                bad_labels += 1
                continue
            try:
                class_id = int(parts[0])
            except ValueError:
                bad_labels += 1
                continue
            if class_id < 0 or class_id >= len(CLASS_NAMES):
                bad_labels += 1
                continue
            class_counts[class_id] += 1

    print(f"Images listed: {len(images)}")
    print(f"Missing images: {missing_images}")
    print(f"Missing labels: {missing_labels}")
    print(f"Malformed label lines: {bad_labels}")

    total = sum(class_counts.values())
    if total:
        print("Class distribution:")
        for cid, name in enumerate(CLASS_NAMES):
            count = class_counts.get(cid, 0)
            pct = (count / total * 100) if total > 0 else 0
            bar = "#" * int(pct / 2)
            print(f"  {cid} {name:20s}: {count:6d} ({pct:5.1f}%) {bar}")

    # Spot check a few images
    sample = random.sample(images, min(10, len(images)))
    for rel_path in sample:
        img_path = Path(dataset_dir) / rel_path
        try:
            with Image.open(img_path) as img:
                img.verify()
        except Exception as exc:
            print(f"Corrupt image: {img_path} -> {exc}")


def main():
    parser = argparse.ArgumentParser(description="Validate YOLO dataset lists")
    parser.add_argument(
        "--dataset-dir",
        default="~/yolo-household/datasets/household_combined",
        help="Dataset root directory",
    )
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir).expanduser().resolve()

    for split in ["train", "val"]:
        list_path = dataset_dir / "lists" / f"{split}.txt"
        if not list_path.exists():
            print(f"Missing list file: {list_path}")
            continue

        print("=" * 40)
        print(f"{split.upper()} SPLIT")
        print("=" * 40)
        validate_split(dataset_dir, list_path)


if __name__ == "__main__":
    main()
