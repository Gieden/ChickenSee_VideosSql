"""
train_head.py
Trains a dedicated 1-class YOLO26n Head detector (head_detector.pt) exclusively
on dataset images that have Head (class 3) annotated.

Why a dedicated Head model?
When only a subset of the main 3,000-image dataset has Head labeled, training
Head inside the unified 10-class model treats the ~2,800 unlabeled images as
negative background for Head, suppressing Head recall (~22%) and adding noise
to Chicken/Saddle detection. Training exclusively on Head-annotated images
eliminates the false-negative penalty and lifts Head precision & recall sharply.
"""

import os
import random
import shutil
from pathlib import Path
from ultralytics import YOLO

PROJECT_ROOT = Path(__file__).resolve().parent
SRC_IMAGES = PROJECT_ROOT / "dataset" / "images"
SRC_LABELS = PROJECT_ROOT / "dataset" / "labels"
HEAD_DATASET_DIR = PROJECT_ROOT / "dataset_head"
HEAD_CLASS_ID = "3"


def build_head_dataset(val_ratio: float = 0.15, seed: int = 42):
    """Extracts only images containing Head (class 3) and remaps class 3 -> 0."""
    if HEAD_DATASET_DIR.exists():
        shutil.rmtree(HEAD_DATASET_DIR)

    for split in ("train", "val"):
        (HEAD_DATASET_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (HEAD_DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    pairs = []
    for lbl_path in sorted(SRC_LABELS.glob("*.txt")):
        lines = [l.strip() for l in lbl_path.read_text(encoding="utf-8").splitlines() if l.strip()]
        head_lines = []
        for line in lines:
            parts = line.split()
            if parts and parts[0] == HEAD_CLASS_ID and len(parts) >= 5:
                head_lines.append("0 " + " ".join(parts[1:5]))
        if not head_lines:
            continue
        stem = lbl_path.stem
        img_candidates = list(SRC_IMAGES.glob(stem + ".*"))
        if not img_candidates:
            continue
        pairs.append((img_candidates[0], head_lines))

    random.Random(seed).shuffle(pairs)
    val_count = max(1, int(len(pairs) * val_ratio))
    val_pairs = pairs[:val_count]
    train_pairs = pairs[val_count:]

    total_boxes = 0
    for split, split_pairs in (("train", train_pairs), ("val", val_pairs)):
        for img_path, head_lines in split_pairs:
            dst_img = HEAD_DATASET_DIR / "images" / split / img_path.name
            dst_lbl = HEAD_DATASET_DIR / "labels" / split / f"{img_path.stem}.txt"
            shutil.copy2(img_path, dst_img)
            dst_lbl.write_text("\n".join(head_lines) + "\n", encoding="utf-8")
            total_boxes += len(head_lines)

    yaml_path = HEAD_DATASET_DIR / "head_config.yaml"
    yaml_path.write_text(
        f"path: {HEAD_DATASET_DIR.as_posix()}\n"
        f"train: images/train\n"
        f"val: images/val\n"
        f"names:\n"
        f"  0: Head\n",
        encoding="utf-8",
    )
    print(
        f"[HEAD DATASET] Built {len(train_pairs)} train + {len(val_pairs)} val images "
        f"({total_boxes} Head boxes total) -> {yaml_path}"
    )
    return yaml_path


def train_head_model():
    yaml_path = build_head_dataset()
    base_weights = PROJECT_ROOT / "yolo26n.pt"
    if not base_weights.exists():
        base_weights = Path("yolo26n.pt")

    print(f"[HEAD TRAIN] Starting 1-class YOLO26n Head training from {base_weights}...")
    model = YOLO(str(base_weights))
    results = model.train(
        data=str(yaml_path),
        epochs=100,
        patience=25,
        imgsz=640,
        batch=8,
        device=0,
        workers=0,
        lr0=0.005,
        lrf=0.01,
        optimizer="AdamW",
        cos_lr=True,
        fliplr=0.5,
        flipud=0.5,
        degrees=15.0,
        mosaic=0.8,
        close_mosaic=15,
        project=str(PROJECT_ROOT / "runs" / "detect"),
        name="head_v1",
        exist_ok=True,
        verbose=False,
    )

    best_pt = PROJECT_ROOT / "runs" / "detect" / "head_v1" / "weights" / "best.pt"
    out_pt = PROJECT_ROOT / "head_detector.pt"
    if best_pt.exists():
        shutil.copy2(best_pt, out_pt)
        print(f"[HEAD TRAIN] Saved best weights -> {out_pt}")

    val_model = YOLO(str(out_pt))
    metrics = val_model.val(data=str(yaml_path), imgsz=640, device=0, workers=0, verbose=False)
    print(
        f"[HEAD VAL] P={metrics.box.mp:.3f} | R={metrics.box.mr:.3f} | "
        f"mAP50={metrics.box.map50:.3f} | mAP50-95={metrics.box.map:.3f}"
    )


if __name__ == "__main__":
    train_head_model()
