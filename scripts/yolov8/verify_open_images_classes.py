#!/usr/bin/env python3
"""Verify Open Images V7 class names and emit a vetted list for download."""

import argparse
import json
from pathlib import Path

import urllib.request

CANDIDATE_CLASSES = [
    # Furniture
    "Couch",
    "Chair",
    "Table",
    "Desk",
    "Bed",
    "Chest of drawers",
    "Shelf",
    "Bookcase",
    "Wardrobe",
    "Cabinet",
    "Bench",
    "Coffee table",
    "Filing cabinet",
    "Stool",
    "Rug",

    # Appliances
    "Refrigerator",
    "Oven",
    "Microwave oven",
    "Washing machine",
    "Dishwasher",
    "Television",
    "Computer monitor",
    "Laptop",
    "Blender",
    "Toaster",
    "Coffeemaker",

    # Fragile / High Value
    "Vase",
    "Lamp",
    "Mirror",
    "Picture frame",
    "Clock",
    "Wine glass",
    "Candle",
    "Sculpture",
    "Painting",
    "Ceramic",
    "Glassware",
    "Whiteboard",
    "Table lamp",
    "Floor lamp",

    # Special Handling
    "Bicycle",
    "Houseplant",
    "Musical instrument",
    "Guitar",
    "Drum",
    "Piano",
    "Surfboard",
    "Ski",
    "Ceiling fan",
    "Chandelier",
    "Aquarium",
    "Fish tank",

    # Boxable Items
    "Book",
    "Bottle",
    "Bowl",
    "Mug",
    "Cup",
    "Plate",
    "Toy",
    "Teddy bear",
    "Doll",
    "Shoe",
    "Boot",
    "Pillow",
    "Towel",
    "Cutting board",
    "Frying pan",
    "Kettle",
    "Kitchen knife",
    "Spoon",
    "Fork",
    "Knife",
    "Curtain",

    # Storage Containers
    "Suitcase",
    "Backpack",
    "Handbag",
    "Box",
    "Briefcase",
    "Luggage and bags",
]

# Optional fallbacks. These are only used if present in Open Images.
FALLBACKS = {
    "Cabinet": ["Cupboard", "Cabinetry"],
    "Ceiling fan": ["Light fixture", "Ceiling light"],
    "Chandelier": ["Light fixture", "Ceiling light"],
    "Fish tank": ["Aquarium"],
    "Rug": ["Carpet"],
    "Curtain": ["Window blind", "Window shade"],
    "Table lamp": ["Desk lamp", "Lamp"],
    "Floor lamp": ["Lamp"],
    "Whiteboard": ["Blackboard", "Bulletin board"],
}

DEFAULT_OUTPUT = Path(__file__).with_name("open_images_classes_verified.json")
DEFAULT_METADATA_DIR = Path.home() / "fiftyone" / "open-images-v7" / "train" / "metadata"
DEFAULT_CLASS_LIST = DEFAULT_METADATA_DIR / "classes.csv"
DEFAULT_POINT_LIST = DEFAULT_METADATA_DIR / "point_classes.csv"
CLASS_LIST_URL = "https://storage.googleapis.com/openimages/v5/class-descriptions-boxable.csv"
POINT_LIST_URL = "https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions.csv"


def parse_class_list(path):
    classes = set()
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(",", 1)
        if len(parts) != 2:
            continue
        classes.add(parts[1])
    return classes


def load_available_classes():
    if DEFAULT_CLASS_LIST.exists():
        return parse_class_list(DEFAULT_CLASS_LIST), DEFAULT_CLASS_LIST
    if DEFAULT_POINT_LIST.exists():
        return parse_class_list(DEFAULT_POINT_LIST), DEFAULT_POINT_LIST

    DEFAULT_METADATA_DIR.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(CLASS_LIST_URL, DEFAULT_CLASS_LIST)
    return parse_class_list(DEFAULT_CLASS_LIST), DEFAULT_CLASS_LIST


def resolve_classes(available):
    verified = []
    used_fallbacks = {}
    missing = []
    seen = set()

    for candidate in CANDIDATE_CLASSES:
        if candidate in available:
            if candidate not in seen:
                verified.append(candidate)
                seen.add(candidate)
            continue

        fallback = None
        for fb in FALLBACKS.get(candidate, []):
            if fb in available:
                fallback = fb
                break

        if fallback:
            if fallback not in seen:
                verified.append(fallback)
                seen.add(fallback)
            used_fallbacks[candidate] = fallback
        else:
            missing.append(candidate)

    return verified, missing, used_fallbacks


def main():
    parser = argparse.ArgumentParser(description="Verify Open Images class names")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Path to write verified class list JSON",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write verified class list to --output",
    )
    parser.add_argument(
        "--print-all",
        action="store_true",
        help="Print all Open Images classes",
    )
    args = parser.parse_args()

    available, source_path = load_available_classes()

    if args.print_all:
        for name in sorted(available):
            print(name)

    verified, missing, used_fallbacks = resolve_classes(available)

    print(f"Available classes: {len(available)}")
    print(f"Class list source: {source_path}")
    print(f"Verified classes: {len(verified)}")

    if used_fallbacks:
        print("Fallbacks used:")
        for src, fb in sorted(used_fallbacks.items()):
            print(f"  {src} -> {fb}")

    if missing:
        print("Missing classes:")
        for name in missing:
            print(f"  {name}")

    if args.write:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w") as f:
            json.dump(verified, f, indent=2)
        print(f"Wrote {len(verified)} classes to {args.output}")


if __name__ == "__main__":
    main()
