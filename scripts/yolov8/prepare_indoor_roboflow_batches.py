#!/usr/bin/env python3
"""
Create Roboflow-style batch folders from indoor-only keep list.
"""

from __future__ import annotations

import argparse
import random
import shutil
from pathlib import Path


CLASS_NAMES = [
    "large_furniture",
    "appliance",
    "fragile_high_value",
    "special_handling",
    "boxable_items",
    "storage_container",
]


def safe_name(path: Path) -> str:
    return str(path).replace("/", "__")


def label_path_for(image_path: Path) -> Path:
    if "coco/images" in str(image_path):
        return Path(str(image_path).replace("coco/images", "coco/labels")).with_suffix(
            ".txt"
        )
    if "open_images/images" in str(image_path):
        return Path(
            str(image_path).replace("open_images/images", "open_images/labels")
        ).with_suffix(".txt")
    raise ValueError(f"Unrecognized image path: {image_path}")


def write_data_yaml(out_dir: Path) -> None:
    data_yaml = out_dir / "data.yaml"
    names_block = "\n".join([f"  {i}: {name}" for i, name in enumerate(CLASS_NAMES)])
    data_yaml.write_text(
        "\n".join(
            [
                f"path: {out_dir}",
                "train: images/train",
                "val: images/valid",
                "test: images/test",
                "",
                "names:",
                names_block,
                "",
            ]
        )
    )


def copy_pair(image_path: Path, label_path: Path, out_img: Path, out_lbl: Path) -> None:
    out_img.parent.mkdir(parents=True, exist_ok=True)
    out_lbl.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(image_path, out_img)
    shutil.copy2(label_path, out_lbl)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare Roboflow batch folders from indoor keep list."
    )
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=Path("~/yolo-household/datasets/household_combined").expanduser(),
    )
    parser.add_argument(
        "--keep-list",
        type=Path,
        default=Path(
            "~/yolo-household/datasets/household_combined/lists/indoor_keep.txt"
        ).expanduser(),
    )
    parser.add_argument(
        "--out-root",
        type=Path,
        default=Path("~/yolo-household/roboflow_indoor_batches").expanduser(),
    )
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=13)
    parser.add_argument("--train-ratio", type=float, default=0.7)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    args = parser.parse_args()

    dataset_root = args.dataset_root
    keep_list = args.keep_list
    if not keep_list.exists():
        print(f"Keep list not found: {keep_list}")
        return 1

    rel_paths = [Path(line.strip()) for line in keep_list.read_text().splitlines() if line.strip()]
    if not rel_paths:
        print("Keep list is empty.")
        return 1

    random.seed(args.seed)
    random.shuffle(rel_paths)

    batch_size = max(1, args.batch_size)
    out_root = args.out_root
    out_root.mkdir(parents=True, exist_ok=True)

    total_batches = (len(rel_paths) + batch_size - 1) // batch_size
    for batch_index in range(total_batches):
        start = batch_index * batch_size
        batch = rel_paths[start : start + batch_size]
        if not batch:
            continue

        n = len(batch)
        train_count = int(n * args.train_ratio)
        val_count = int(n * args.val_ratio)
        test_count = n - train_count - val_count

        train_paths = batch[:train_count]
        val_paths = batch[train_count : train_count + val_count]
        test_paths = batch[train_count + val_count :]

        batch_dir = out_root / f"roboflow_indoor_batch_{batch_index + 1:04d}"
        batch_dir.mkdir(parents=True, exist_ok=True)
        write_data_yaml(batch_dir)

        def handle_split(split: str, split_paths: list[Path]) -> None:
            for rel in split_paths:
                image_path = dataset_root / rel
                label_path = label_path_for(image_path)
                if not label_path.exists():
                    raise FileNotFoundError(f"Missing label: {label_path}")
                image_name = safe_name(rel)
                label_name = f"{Path(image_name).stem}.txt"
                out_img = batch_dir / "images" / split / Path(image_name).name
                out_lbl = batch_dir / "labels" / split / label_name
                copy_pair(image_path, label_path, out_img, out_lbl)

        handle_split("train", train_paths)
        handle_split("valid", val_paths)
        handle_split("test", test_paths)

        print(
            f"{batch_dir}: train={len(train_paths)} valid={len(val_paths)} test={len(test_paths)}"
        )

    print(f"Done. Output: {out_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
