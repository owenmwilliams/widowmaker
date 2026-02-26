#!/usr/bin/env python3
"""Create stratified Open Images val split and oversampled train list."""

import argparse
import random
from collections import Counter, defaultdict
from pathlib import Path

try:
    from sklearn.model_selection import StratifiedShuffleSplit
except ImportError as exc:
    raise SystemExit("scikit-learn is required. Run: pip install scikit-learn") from exc

CLASS_NAMES = {
    0: "large_furniture",
    1: "appliance",
    2: "fragile_high_value",
    3: "special_handling",
    4: "boxable_items",
    5: "storage_container",
}

OVERSAMPLE_MULTIPLIERS = {
    3: 3,  # special_handling
    2: 2,  # fragile_high_value
    5: 2,  # storage_container
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def list_images(images_dir):
    return sorted(
        [p for p in images_dir.glob("**/*") if p.suffix.lower() in IMAGE_EXTS]
    )


def compute_primary_class(label_path):
    counts = defaultdict(int)
    for line in label_path.read_text().splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        try:
            class_id = int(parts[0])
        except ValueError:
            continue
        counts[class_id] += 1

    if not counts:
        return None

    # Primary class = most annotations; tie-breaker is lowest class id.
    return max(counts.items(), key=lambda kv: (kv[1], -kv[0]))[0]


def load_open_images_records(dataset_dir):
    images_dir = Path(dataset_dir) / "open_images" / "images" / "train"
    labels_dir = Path(dataset_dir) / "open_images" / "labels" / "train"

    image_by_stem = {p.stem: p for p in list_images(images_dir)}

    records = []
    missing_images = 0
    missing_labels = 0

    for label_path in sorted(labels_dir.glob("*.txt")):
        stem = label_path.stem
        img_path = image_by_stem.get(stem)
        if not img_path:
            missing_images += 1
            continue

        primary_class = compute_primary_class(label_path)
        if primary_class is None:
            missing_labels += 1
            continue

        rel_path = img_path.relative_to(dataset_dir).as_posix()
        records.append((rel_path, primary_class))

    return records, missing_images, missing_labels


def stratified_split(records, val_fraction, seed):
    paths = [r[0] for r in records]
    labels = [r[1] for r in records]

    if not paths:
        return [], []

    counts = Counter(labels)
    rare_indices = [i for i, cls in enumerate(labels) if counts[cls] < 2]
    kept_indices = [i for i, cls in enumerate(labels) if counts[cls] >= 2]

    train_indices = set(rare_indices)
    val_indices = set()

    if kept_indices:
        kept_paths = [paths[i] for i in kept_indices]
        kept_labels = [labels[i] for i in kept_indices]

        splitter = StratifiedShuffleSplit(
            n_splits=1, test_size=val_fraction, random_state=seed
        )
        split = splitter.split(kept_paths, kept_labels)
        train_idx, val_idx = next(split)

        for i in train_idx:
            train_indices.add(kept_indices[i])
        for i in val_idx:
            val_indices.add(kept_indices[i])

    train = [(paths[i], labels[i]) for i in sorted(train_indices)]
    val = [(paths[i], labels[i]) for i in sorted(val_indices)]
    return train, val


def oversample(records):
    oversampled = []
    for path, cls in records:
        multiplier = OVERSAMPLE_MULTIPLIERS.get(cls, 1)
        oversampled.extend([path] * multiplier)
    return oversampled


def write_list(path, items):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(items))


def main():
    parser = argparse.ArgumentParser(description="Build train/val lists with oversampling")
    parser.add_argument(
        "--dataset-dir",
        default="~/yolo-household/datasets/household_combined",
        help="Dataset root directory",
    )
    parser.add_argument(
        "--val-fraction",
        type=float,
        default=0.15,
        help="Open Images validation fraction",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument(
        "--shuffle",
        action="store_true",
        help="Shuffle output lists",
    )
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir).expanduser().resolve()

    coco_train = [
        p.relative_to(dataset_dir).as_posix()
        for p in list_images(dataset_dir / "coco" / "images" / "train")
    ]
    coco_val = [
        p.relative_to(dataset_dir).as_posix()
        for p in list_images(dataset_dir / "coco" / "images" / "val")
    ]

    oi_records, missing_images, missing_labels = load_open_images_records(dataset_dir)
    oi_train, oi_val = stratified_split(oi_records, args.val_fraction, args.seed)

    oi_train_paths = [p for p, _ in oi_train]
    oi_val_paths = [p for p, _ in oi_val]

    train_paths = coco_train + oversample(oi_train)
    val_paths = coco_val + oi_val_paths

    if args.shuffle:
        rng = random.Random(args.seed)
        rng.shuffle(train_paths)
        rng.shuffle(val_paths)

    lists_dir = dataset_dir / "lists"
    write_list(lists_dir / "coco_train.txt", coco_train)
    write_list(lists_dir / "coco_val.txt", coco_val)
    write_list(lists_dir / "open_images_train.txt", oi_train_paths)
    write_list(lists_dir / "open_images_val.txt", oi_val_paths)
    write_list(lists_dir / "train.txt", train_paths)
    write_list(lists_dir / "val.txt", val_paths)

    print("Open Images records:", len(oi_records))
    print("Open Images train:", len(oi_train_paths))
    print("Open Images val:", len(oi_val_paths))
    print("COCO train:", len(coco_train))
    print("COCO val:", len(coco_val))
    print("Train list (with oversampling):", len(train_paths))
    print("Val list:", len(val_paths))

    if missing_images or missing_labels:
        print(f"Missing images: {missing_images}")
        print(f"Missing labels: {missing_labels}")

    train_class_counts = Counter([cls for _, cls in oi_train])
    val_class_counts = Counter([cls for _, cls in oi_val])

    if train_class_counts:
        print("Open Images train class distribution:")
        for cls_id in sorted(train_class_counts):
            print(f"  {cls_id} {CLASS_NAMES.get(cls_id, 'unknown')}: {train_class_counts[cls_id]}")

    if val_class_counts:
        print("Open Images val class distribution:")
        for cls_id in sorted(val_class_counts):
            print(f"  {cls_id} {CLASS_NAMES.get(cls_id, 'unknown')}: {val_class_counts[cls_id]}")


if __name__ == "__main__":
    main()
