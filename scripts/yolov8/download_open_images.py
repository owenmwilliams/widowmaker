#!/usr/bin/env python3
"""Download a household-relevant Open Images V7 subset using FiftyOne."""

import argparse
import json
from pathlib import Path

import fiftyone.zoo as foz

DEFAULT_CLASSES_PATH = Path(__file__).with_name("open_images_classes_verified.json")
DEFAULT_DATASET_NAME = "open-images-v7-household-train"


def main():
    parser = argparse.ArgumentParser(description="Download Open Images V7 subset")
    parser.add_argument(
        "--classes",
        type=Path,
        default=DEFAULT_CLASSES_PATH,
        help="Path to verified classes JSON",
    )
    parser.add_argument(
        "--max-samples",
        type=int,
        default=20000,
        help="Max samples to download (set 0 for all)",
    )
    parser.add_argument(
        "--dataset-name",
        default=DEFAULT_DATASET_NAME,
        help="FiftyOne dataset name",
    )
    args = parser.parse_args()

    if not args.classes.exists():
        raise SystemExit(
            f"Missing {args.classes}. Run verify_open_images_classes.py --write first."
        )

    classes = json.loads(args.classes.read_text())
    if not classes:
        raise SystemExit("Verified class list is empty. Check the verify script output.")

    max_samples = None if args.max_samples == 0 else args.max_samples

    dataset = foz.load_zoo_dataset(
        "open-images-v7",
        split="train",
        label_types=["detections"],
        classes=classes,
        max_samples=max_samples,
        dataset_name=args.dataset_name,
        persistent=True,
    )

    print(f"Downloaded {len(dataset)} samples")
    print("Classes found:")
    for name in sorted(dataset.distinct("ground_truth.detections.label")):
        print(f"  {name}")


if __name__ == "__main__":
    main()
