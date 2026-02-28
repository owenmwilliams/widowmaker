#!/usr/bin/env python3
"""
Filter indoor images with CLIP and prepare a Roboflow upload folder.

Defaults are tuned for the household dataset layout created by remap_labels.py.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import zipfile
from pathlib import Path
from typing import Iterable, List, Tuple

from PIL import Image
import torch
import open_clip


INDOOR_PROMPTS = [
    "an indoor room",
    "an indoor scene",
    "a room interior",
    "inside a home",
    "an indoor living room",
]

OUTDOOR_PROMPTS = [
    "an outdoor scene",
    "outside",
    "an outdoor landscape",
    "a street scene",
    "outdoor nature",
]

CLASS_NAMES = [
    "large_furniture",
    "appliance",
    "fragile_high_value",
    "special_handling",
    "boxable_items",
    "storage_container",
]


def load_image_paths(dataset_root: Path, list_paths: Iterable[Path]) -> List[Path]:
    images = []
    for list_path in list_paths:
        if not list_path.exists():
            raise FileNotFoundError(f"List not found: {list_path}")
        for line in list_path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            images.append(dataset_root / line)
    return images


def build_text_features(
    model: torch.nn.Module, tokenizer, device: torch.device
) -> Tuple[torch.Tensor, int]:
    prompts = INDOOR_PROMPTS + OUTDOOR_PROMPTS
    with torch.no_grad():
        text = tokenizer(prompts).to(device)
        text_features = model.encode_text(text)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)
    return text_features, len(INDOOR_PROMPTS)


def score_batch(
    model: torch.nn.Module,
    images: List[Image.Image],
    preprocess,
    text_features: torch.Tensor,
    indoor_count: int,
    device: torch.device,
) -> torch.Tensor:
    batch = torch.stack([preprocess(img) for img in images]).to(device)
    with torch.no_grad():
        image_features = model.encode_image(batch)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        logit_scale = model.logit_scale.exp()
        sims = logit_scale * image_features @ text_features.T
        indoor_scores = sims[:, :indoor_count].mean(dim=1)
        outdoor_scores = sims[:, indoor_count:].mean(dim=1)
        probs = torch.softmax(torch.stack([indoor_scores, outdoor_scores], dim=1), dim=1)
    return probs[:, 0]  # indoor probability


def safe_name(path: Path) -> str:
    return str(path).replace("/", "__")


def copy_pair(
    image_path: Path,
    label_path: Path,
    relative_path: Path,
    out_images_dir: Path,
    out_labels_dir: Path,
) -> Tuple[Path, Path]:
    image_name = safe_name(relative_path)
    label_name = f"{Path(image_name).stem}.txt"
    out_image = out_images_dir / Path(image_name).name
    out_label = out_labels_dir / label_name
    out_images_dir.mkdir(parents=True, exist_ok=True)
    out_labels_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(image_path, out_image)
    shutil.copy2(label_path, out_label)
    return out_image, out_label


def write_data_yaml(out_dir: Path) -> None:
    data_yaml = out_dir / "data.yaml"
    names_block = "\n".join([f"  {i}: {name}" for i, name in enumerate(CLASS_NAMES)])
    data_yaml.write_text(
        "\n".join(
            [
                f"path: {out_dir}",
                "train: images/train",
                "val: images/valid",
                "",
                "names:",
                names_block,
                "",
            ]
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Filter indoor images with CLIP.")
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=Path("~/yolo-household/datasets/household_combined").expanduser(),
    )
    parser.add_argument(
        "--lists",
        nargs="+",
        default=[
            "lists/coco_train.txt",
            "lists/coco_val.txt",
            "lists/open_images_train.txt",
            "lists/open_images_val.txt",
        ],
    )
    parser.add_argument("--min-indoor", type=float, default=0.7)
    parser.add_argument("--min-margin", type=float, default=0.25)
    parser.add_argument("--sample-size", type=int, default=300)
    parser.add_argument("--seed", type=int, default=13)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument(
        "--keep-list",
        type=Path,
        default=Path(
            "~/yolo-household/datasets/household_combined/lists/indoor_keep.txt"
        ).expanduser(),
    )
    parser.add_argument(
        "--zip-batches",
        action="store_true",
        help="Write indoor images into zip batches.",
    )
    parser.add_argument(
        "--zip-dir",
        type=Path,
        default=Path("~/yolo-household/indoor_batches").expanduser(),
    )
    parser.add_argument("--zip-batch-size", type=int, default=1000)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("~/yolo-household/roboflow_upload_indoor_sample").expanduser(),
    )
    parser.add_argument(
        "--prepare-roboflow",
        action="store_true",
        default=True,
        help="Prepare a Roboflow upload folder (images + labels).",
    )
    parser.add_argument(
        "--no-roboflow",
        dest="prepare_roboflow",
        action="store_false",
        help="Skip Roboflow folder creation.",
    )
    parser.add_argument(
        "--log-jsonl",
        type=Path,
        default=Path(
            "~/yolo-household/datasets/household_combined/lists/indoor_scores.jsonl"
        ).expanduser(),
    )
    args = parser.parse_args()

    dataset_root = args.dataset_root
    list_paths = [dataset_root / Path(p) for p in args.lists]
    images = load_image_paths(dataset_root, list_paths)
    if not images:
        print("No images found from provided lists.")
        return 1

    random.seed(args.seed)
    random.shuffle(images)

    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="openai"
    )
    model = model.to(device)
    model.eval()
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    text_features, indoor_count = build_text_features(model, tokenizer, device)

    accepted: List[Path] = []
    log_rows = []
    limit = args.sample_size if args.sample_size > 0 else None

    batch_images = []
    batch_paths = []
    for image_path in images:
        try:
            img = Image.open(image_path).convert("RGB")
        except Exception:
            continue
        batch_images.append(img)
        batch_paths.append(image_path)

        if len(batch_images) < args.batch_size:
            continue

        indoor_probs = score_batch(
            model, batch_images, preprocess, text_features, indoor_count, device
        )
        for path_item, indoor_prob in zip(batch_paths, indoor_probs.tolist()):
            outdoor_prob = 1.0 - indoor_prob
            keep = (indoor_prob > args.min_indoor) and (
                (indoor_prob - outdoor_prob) >= args.min_margin
            )
            log_rows.append(
                {
                    "path": str(path_item),
                    "indoor_prob": round(float(indoor_prob), 6),
                    "outdoor_prob": round(float(outdoor_prob), 6),
                    "keep": keep,
                }
            )
            if keep:
                accepted.append(path_item)
                if limit is not None and len(accepted) >= limit:
                    break

        batch_images = []
        batch_paths = []
        if limit is not None and len(accepted) >= limit:
            break

    if (limit is None or len(accepted) < limit) and batch_images:
        indoor_probs = score_batch(
            model, batch_images, preprocess, text_features, indoor_count, device
        )
        for path_item, indoor_prob in zip(batch_paths, indoor_probs.tolist()):
            outdoor_prob = 1.0 - indoor_prob
            keep = (indoor_prob > args.min_indoor) and (
                (indoor_prob - outdoor_prob) >= args.min_margin
            )
            log_rows.append(
                {
                    "path": str(path_item),
                    "indoor_prob": round(float(indoor_prob), 6),
                    "outdoor_prob": round(float(outdoor_prob), 6),
                    "keep": keep,
                }
            )
            if keep:
                accepted.append(path_item)
                if limit is not None and len(accepted) >= limit:
                    break

    args.log_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with args.log_jsonl.open("w") as f:
        for row in log_rows:
            f.write(json.dumps(row) + "\n")

    if not accepted:
        print("No images met the indoor thresholds.")
        return 1

    args.keep_list.parent.mkdir(parents=True, exist_ok=True)
    args.keep_list.write_text(
        "\n".join([str(p.relative_to(dataset_root)) for p in accepted]) + "\n"
    )

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

    if args.prepare_roboflow and limit is not None:
        train_count = int(len(accepted) * 0.8)
        train_paths = accepted[:train_count]
        val_paths = accepted[train_count:]

        out_dir = args.out_dir
        train_img_dir = out_dir / "images" / "train"
        train_lbl_dir = out_dir / "labels" / "train"
        val_img_dir = out_dir / "images" / "valid"
        val_lbl_dir = out_dir / "labels" / "valid"

        for image_path in train_paths:
            label_path = label_path_for(image_path)
            if label_path.exists():
                copy_pair(
                    image_path,
                    label_path,
                    image_path.relative_to(dataset_root),
                    train_img_dir,
                    train_lbl_dir,
                )

        for image_path in val_paths:
            label_path = label_path_for(image_path)
            if label_path.exists():
                copy_pair(
                    image_path,
                    label_path,
                    image_path.relative_to(dataset_root),
                    val_img_dir,
                    val_lbl_dir,
                )

        write_data_yaml(out_dir)

    if args.zip_batches:
        zip_dir = args.zip_dir
        zip_dir.mkdir(parents=True, exist_ok=True)
        batch_size = max(1, args.zip_batch_size)
        total = len(accepted)
        batch_index = 1
        for start in range(0, total, batch_size):
            batch = accepted[start : start + batch_size]
            zip_path = zip_dir / f"indoor_batch_{batch_index:04d}.zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for image_path in batch:
                    rel = image_path.relative_to(dataset_root)
                    zf.write(image_path, arcname=safe_name(rel))
            batch_index += 1

    print(f"Accepted {len(accepted)} images")
    print(f"Score log: {args.log_jsonl}")
    print(f"Keep list: {args.keep_list}")
    if args.prepare_roboflow and limit is not None:
        print(f"Roboflow upload folder: {args.out_dir}")
    if args.zip_batches:
        print(f"Zip batches: {args.zip_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
