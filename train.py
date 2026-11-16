import os
import json
import yaml
import shutil
import random
import torch
from ultralytics import YOLO

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
project_dir  = os.path.dirname(os.path.abspath(__file__))
dataset_dir  = os.path.join(project_dir, "dataset")
images_dir   = os.path.join(dataset_dir, "images")
labels_dir   = os.path.join(dataset_dir, "labels")

train_img_dir = os.path.join(dataset_dir, "train", "images")
train_lbl_dir = os.path.join(dataset_dir, "train", "labels")
val_img_dir   = os.path.join(dataset_dir, "val",   "images")
val_lbl_dir   = os.path.join(dataset_dir, "val",   "labels")

# ---------------------------------------------------------------------------
# Class definitions — reflect the live dataset currently on disk.
# The current export is a 9-class Label Studio schema:
#   0 Chicken, 1 Drinker, 2 Feeder, 3 Rooster,
#   4 Saddle_Color_Blue, 5 Saddle_Color_Red,
#   6 Saddle_Color_White, 7 Saddle_Color_Yellow,
#   8 Saddle_Color_YellowGreen
# ---------------------------------------------------------------------------
DEFAULT_CLASS_NAMES = {
    0: "Chicken",
    1: "Drinker",
    2: "Feeder",
    3: "Rooster",
    4: "Saddle_Color_Blue",
    5: "Saddle_Color_Red",
    6: "Saddle_Color_White",
    7: "Saddle_Color_Yellow",
    8: "Saddle_Color_YellowGreen",
}

CLASS_NAMES = dict(DEFAULT_CLASS_NAMES)

# Auto-sync with dataset/classes.txt or dataset/notes.json if present.
# This keeps the training config aligned with the real packaged dataset instead of
# hard-coding legacy 14-class names from an earlier export.
classes_file = os.path.join(dataset_dir, "classes.txt")
notes_file = os.path.join(dataset_dir, "notes.json")
if os.path.isfile(classes_file):
    with open(classes_file, "r", encoding="utf-8") as f:
        loaded = [line.strip() for line in f if line.strip()]
    if loaded:
        CLASS_NAMES = {i: name for i, name in enumerate(loaded)}
elif os.path.isfile(notes_file):
    try:
        with open(notes_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            cats = data.get("categories", [])
            if cats:
                CLASS_NAMES = {int(c["id"]): str(c["name"]) for c in cats}
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Step 1 — Auto train/val split (80/20) if not already done
# ---------------------------------------------------------------------------
def split_dataset(val_ratio=0.20, seed=42):
    """Split flat dataset/images + dataset/labels into train/val folders."""
    # Ensure fresh directory state
    for d in [train_img_dir, train_lbl_dir, val_img_dir, val_lbl_dir]:
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)

    # Collect images that have a matching label file
    all_images = [
        f for f in os.listdir(images_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]
    paired = []
    for img_name in all_images:
        stem = os.path.splitext(img_name)[0]
        lbl_path = os.path.join(labels_dir, stem + ".txt")
        if os.path.isfile(lbl_path):
            paired.append((img_name, stem + ".txt"))
        else:
            print(f"[WARN] No label found for {img_name} — skipping")

    if not paired:
        raise FileNotFoundError(
            f"No paired image+label files found in {images_dir} / {labels_dir}"
        )

    random.seed(seed)
    random.shuffle(paired)

    n_val   = max(1, int(len(paired) * val_ratio))
    val_set = set(p[0] for p in paired[:n_val])

    copied_train = copied_val = 0
    for img_name, lbl_name in paired:
        src_img = os.path.join(images_dir, img_name)
        src_lbl = os.path.join(labels_dir, lbl_name)
        if img_name in val_set:
            shutil.copy(src_img, os.path.join(val_img_dir,   img_name))
            shutil.copy(src_lbl, os.path.join(val_lbl_dir,   lbl_name))
            copied_val += 1
        else:
            shutil.copy(src_img, os.path.join(train_img_dir, img_name))
            shutil.copy(src_lbl, os.path.join(train_lbl_dir, lbl_name))
            copied_train += 1

    print(f"✅ Split complete → train: {copied_train}  val: {copied_val} (Total: {len(paired)})")
    return copied_train, copied_val


def main():
    # Count paired raw images
    raw_images = [
        f for f in os.listdir(images_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]
    total_raw = len(raw_images)
    n_train = len(os.listdir(train_img_dir)) if os.path.isdir(train_img_dir) else 0
    n_val   = len(os.listdir(val_img_dir)) if os.path.isdir(val_img_dir) else 0

    # Split if train/val missing, empty, or out of sync with total raw images
    need_split = (
        not os.path.isdir(train_img_dir)
        or n_train == 0
        or (n_train + n_val) != total_raw
    )

    if need_split:
        print(f"📂 Dataset out of sync or missing ({n_train + n_val}/{total_raw} split). Splitting train/val (80/20)...")
        split_dataset()
    else:
        print(f"📂 Using existing split → train: {n_train}  val: {n_val}")

    # ---------------------------------------------------------------------------
    # Step 2 — Write dataset_config.yaml
    # ---------------------------------------------------------------------------
    data_config = {
        "path":  dataset_dir.replace("\\", "/"),
        "train": "train/images",
        "val":   "val/images",
        "nc":    len(CLASS_NAMES),
        "names": CLASS_NAMES,
    }

    yaml_path = os.path.join(project_dir, "dataset_config.yaml")
    with open(yaml_path, "w") as f:
        yaml.dump(data_config, f, default_flow_style=False, sort_keys=False)
    print(f"✅ dataset_config.yaml written → {yaml_path}")

    # Remove stale cache so Ultralytics re-scans labels
    for cache in ["labels.cache", "train/labels.cache", "val/labels.cache"]:
        cache_path = os.path.join(dataset_dir, cache)
        if os.path.isfile(cache_path):
            os.remove(cache_path)
            print(f"🗑️  Removed stale cache: {cache_path}")

    # ---------------------------------------------------------------------------
    # Step 3 — Load base model
    # ---------------------------------------------------------------------------
    base_model = os.path.join(project_dir, "yolo26n.pt")
    if not os.path.isfile(base_model):
        if os.path.isfile(os.path.join(project_dir, "custom_poultry.pt")):
            base_model = os.path.join(project_dir, "custom_poultry.pt")
        else:
            base_model = "yolo11n.pt"

    # Determine training hardware accelerator
    device = 0 if torch.cuda.is_available() else "cpu"
    device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    print(f"\n🚀 Fine-tuning model: {base_model}")
    print(f"   Target Device: {device} ({device_name})")
    print(f"   Classes ({len(CLASS_NAMES)}): {list(CLASS_NAMES.values())}\n")
    model = YOLO(base_model)

    # ---------------------------------------------------------------------------
    # Step 4 — Train
    # ---------------------------------------------------------------------------
    run_name = "poultry_v6"
    results = model.train(
        data=yaml_path,
        epochs=150,
        imgsz=640,
        batch=4,              # safe for most GPUs; increase if VRAM allows
        device=device,
        close_mosaic=15,      # disable mosaic in last 15 epochs for clean boxes
        name=run_name,
        exist_ok=True,
        project=os.path.join(project_dir, "runs", "detect"),
        # Augmentation — helps with small leg tags and saddle markers
        degrees=10.0,
        fliplr=0.5,
        mosaic=1.0,
        scale=0.9,            # force downscaling of crops for scale invariance
        hsv_h=0.015,
        hsv_s=0.7,
        hsv_v=0.4,
        patience=30,          # early stopping if no improvement for 30 epochs
        save_period=25,       # checkpoint every 25 epochs
        verbose=True,
    )

    # ---------------------------------------------------------------------------
    # Step 5 — Copy best weights to project root
    # ---------------------------------------------------------------------------
    save_dir = getattr(results, "save_dir", os.path.join(project_dir, "runs", "detect", run_name))
    best_weights = os.path.join(save_dir, "weights", "best.pt")
    if not os.path.isfile(best_weights):
        best_weights = os.path.join(project_dir, "runs", "detect", run_name, "weights", "best.pt")

    target_weights = os.path.join(project_dir, "custom_poultry.pt")

    if os.path.isfile(best_weights):
        shutil.copy(best_weights, target_weights)
        print(f"\n🎉 Training complete!")
        print(f"   Best weights → {target_weights}")
    else:
        print("\n❌ Training finished but best.pt not found — check runs/ folder.")


if __name__ == "__main__":
    main()