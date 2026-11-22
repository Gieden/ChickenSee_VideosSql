import os
import json
import math
import yaml
import shutil
import random
from collections import Counter
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
# Class definitions — reflect the live 10-class Label Studio dataset on disk:
#   0 Chicken, 1 Drinker, 2 Feeder, 3 Head, 4 Rooster,
#   5 Saddle_Color_Blue, 6 Saddle_Color_Red,
#   7 Saddle_Color_White, 8 Saddle_Color_Yellow,
#   9 Saddle_Color_YellowGreen
# ---------------------------------------------------------------------------
DEFAULT_CLASS_NAMES = {
    0: "Chicken",
    1: "Drinker",
    2: "Feeder",
    3: "Head",
    4: "Rooster",
    5: "Saddle_Color_Blue",
    6: "Saddle_Color_Red",
    7: "Saddle_Color_White",
    8: "Saddle_Color_Yellow",
    9: "Saddle_Color_YellowGreen",
}

CLASS_NAMES = dict(DEFAULT_CLASS_NAMES)
# Oversample underrepresented / lower-AP classes:
# Head currently has 580 boxes in 171/3000 images, and Blue/White/Yellow saddles had lower AP.
SADDLE_CLASSES_WITH_LOW_AP = {
    "Head",
    "Saddle_Color_Blue",
    "Saddle_Color_White",
    "Saddle_Color_Yellow",
}
SADDLE_OVERSAMPLE_PREFIX = "__saddle_boost__"

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
    """Stratified 80/20 split of flat dataset/images + dataset/labels into train/val folders."""
    # Ensure fresh directory state
    for d in [train_img_dir, train_lbl_dir, val_img_dir, val_lbl_dir]:
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)

    # Collect images that have a matching label file
    all_images = sorted(
        f for f in os.listdir(images_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    )
    paired = []
    class_freq = Counter()
    image_classes = {}
    for img_name in all_images:
        stem = os.path.splitext(img_name)[0]
        lbl_path = os.path.join(labels_dir, stem + ".txt")
        if os.path.isfile(lbl_path):
            paired.append((img_name, stem + ".txt"))
            present = set()
            with open(lbl_path, "r", encoding="utf-8", errors="ignore") as lf:
                for line in lf:
                    parts = line.split()
                    if parts:
                        try:
                            cid = int(float(parts[0]))
                            present.add(cid)
                        except ValueError:
                            pass
            image_classes[img_name] = present
            for cid in present:
                class_freq[cid] += 1
        else:
            print(f"[WARN] No label found for {img_name} — skipping")

    if not paired:
        raise FileNotFoundError(
            f"No paired image+label files found in {images_dir} / {labels_dir}"
        )

    # Group each image by its rarest class so minority saddle classes get an exact ~80/20 split
    buckets = {}
    for item in paired:
        img_name = item[0]
        present = image_classes[img_name]
        rarest = min(present, key=lambda c: class_freq[c]) if present else -1
        buckets.setdefault(rarest, []).append(item)

    rng = random.Random(seed)
    val_set = set()
    for bucket_key in sorted(buckets.keys()):
        items = buckets[bucket_key]
        rng.shuffle(items)
        n_bucket_val = max(1, round(len(items) * val_ratio)) if len(items) > 1 else 0
        for img_name, _ in items[:n_bucket_val]:
            val_set.add(img_name)

    copied_train = copied_val = 0
    for img_name, lbl_name in paired:
        src_img = os.path.join(images_dir, img_name)
        src_lbl = os.path.join(labels_dir, lbl_name)
        if img_name in val_set:
            shutil.copy2(src_img, os.path.join(val_img_dir,   img_name))
            shutil.copy2(src_lbl, os.path.join(val_lbl_dir,   lbl_name))
            copied_val += 1
        else:
            shutil.copy2(src_img, os.path.join(train_img_dir, img_name))
            shutil.copy2(src_lbl, os.path.join(train_lbl_dir, lbl_name))
            copied_train += 1

    print(f"✅ Stratified split complete → train: {copied_train}  val: {copied_val} (Total: {len(paired)})")
    return copied_train, copied_val


def oversample_weak_saddle_images(image_dir, label_dir, class_names):
    """Duplicate only training images containing the currently weak saddle classes."""
    for image_name in os.listdir(image_dir):
        if image_name.startswith(SADDLE_OVERSAMPLE_PREFIX):
            os.remove(os.path.join(image_dir, image_name))
            label_name = os.path.splitext(image_name)[0] + ".txt"
            label_path = os.path.join(label_dir, label_name)
            if os.path.isfile(label_path):
                os.remove(label_path)

    weak_class_ids = {
        int(class_id)
        for class_id, class_name in class_names.items()
        if class_name in SADDLE_CLASSES_WITH_LOW_AP
    }
    saddle_class_ids = {
        int(class_id)
        for class_id, class_name in class_names.items()
        if class_name.startswith("Saddle_Color_") or class_name == "Head"
    }
    image_classes = {}
    class_counts = Counter()

    for image_name in os.listdir(image_dir):
        if not image_name.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        label_path = os.path.join(label_dir, os.path.splitext(image_name)[0] + ".txt")
        if not os.path.isfile(label_path):
            continue

        weak_classes = set()
        with open(label_path, "r", encoding="utf-8") as label_file:
            for line in label_file:
                parts = line.split()
                if not parts:
                    continue
                try:
                    class_id = int(parts[0])
                except ValueError:
                    continue
                if class_id in saddle_class_ids:
                    class_counts[class_id] += 1
                    if class_id in weak_class_ids:
                        weak_classes.add(class_id)
        if weak_classes:
            image_classes[image_name] = weak_classes

    if not class_counts:
        return 0

    max_saddle_count = max(class_counts.values())
    extra_copies_by_class = {}
    for class_id in weak_class_ids:
        class_count = class_counts.get(class_id, 0)
        if class_count:
            factor = min(3.0, max(2.0, math.sqrt(max_saddle_count / class_count)))
            extra_copies_by_class[class_id] = max(1, int(factor) - 1)

    copied_images = 0
    for image_name, class_ids in image_classes.items():
        extra_copies = max(extra_copies_by_class[class_id] for class_id in class_ids)
        source_image = os.path.join(image_dir, image_name)
        source_label = os.path.join(label_dir, os.path.splitext(image_name)[0] + ".txt")
        for copy_index in range(1, extra_copies + 1):
            duplicate_name = f"{SADDLE_OVERSAMPLE_PREFIX}{copy_index}__{image_name}"
            duplicate_label = os.path.splitext(duplicate_name)[0] + ".txt"
            shutil.copy2(source_image, os.path.join(image_dir, duplicate_name))
            shutil.copy2(source_label, os.path.join(label_dir, duplicate_label))
            copied_images += 1

    print(f"✅ Oversampled low-AP saddle classes with {copied_images} extra training images.")
    return copied_images


def main():
    # Count paired raw images
    raw_images = [
        f for f in os.listdir(images_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]
    total_raw = len(raw_images)
    n_train = sum(
        1 for name in os.listdir(train_img_dir)
        if os.path.isfile(os.path.join(train_img_dir, name))
        and not name.startswith(SADDLE_OVERSAMPLE_PREFIX)
    ) if os.path.isdir(train_img_dir) else 0
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

    oversample_weak_saddle_images(train_img_dir, train_lbl_dir, CLASS_NAMES)

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
    base_model = None
    custom_weight = os.path.join(project_dir, "custom_poultry.pt")
    yolo26_weight = os.path.join(project_dir, "yolo26n.pt")

    if os.path.isfile(custom_weight):
        base_model = custom_weight
    elif os.path.isfile(yolo26_weight):
        base_model = yolo26_weight
    else:
        raise FileNotFoundError(
            "No model weights found. Place either custom_poultry.pt or yolo26n.pt in the project root before training."
        )

    # Determine training hardware accelerator
    device = 0 if torch.cuda.is_available() else "cpu"
    device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    print(f"\n🚀 Fine-tuning model: {base_model}")
    print(f"   Target Device: {device} ({device_name})")
    print(f"   Classes ({len(CLASS_NAMES)}): {list(CLASS_NAMES.values())}\n")
    model = YOLO(base_model)

    # ---------------------------------------------------------------------------
    # Step 4 — Train (tuned for 3,000-image top-down pen dataset on 4 GB GTX 1650)
    # ---------------------------------------------------------------------------
    run_name = "poultry_v8"
    batch_size = 8 if device != "cpu" else 4
    # If the dataset class count changed (e.g. 9 -> 10 with new 'Head' class), Ultralytics
    # re-initializes the classification head, so use lr0=0.005 for clean head convergence;
    # otherwise use gentle lr0=0.002 for same-schema fine-tuning.
    base_nc = len(getattr(model, "names", {}) or {})
    is_same_schema_finetune = (
        os.path.abspath(base_model) == os.path.abspath(custom_weight)
        and base_nc == len(CLASS_NAMES)
    )
    lr0 = 0.002 if is_same_schema_finetune else (0.005 if os.path.abspath(base_model) == os.path.abspath(custom_weight) else 0.01)
    results = model.train(
        data=yaml_path,
        epochs=150,
        imgsz=640,
        batch=batch_size,     # 8 fits comfortably in 4 GB VRAM for nano weights & stabilizes BN
        workers=4,            # safe for Windows multiprocessing on mixed HD/640p images
        device=device,
        lr0=lr0,
        cos_lr=True,          # smooth cosine LR decay across 150 epochs
        close_mosaic=15,      # disable mosaic in last 15 epochs for crisp final boxes
        name=run_name,
        exist_ok=True,
        project=os.path.join(project_dir, "runs", "detect"),
        # Overhead top-down pen augmentation — preserves saddle color signal
        degrees=10.0,
        fliplr=0.5,
        flipud=0.5,           # valid for top-down camera view; doubles geometric variety
        mosaic=1.0,
        scale=0.5,            # 0.5x–1.5x keeps small saddle markers readable (0.9 shrank to 10%)
        hsv_h=0.005,          # mild hue jitter so Yellow vs YellowGreen saddles stay distinct
        hsv_s=0.2,
        hsv_v=0.15,
        patience=30,          # early stopping if no improvement for 30 epochs
        save_period=25,       # checkpoint every 25 epochs
        verbose=True,
    )

    # ---------------------------------------------------------------------------
    # Step 5 — Backup previous weights & copy best weights to project root
    # ---------------------------------------------------------------------------
    save_dir = getattr(results, "save_dir", os.path.join(project_dir, "runs", "detect", run_name))
    best_weights = os.path.join(save_dir, "weights", "best.pt")
    if not os.path.isfile(best_weights):
        best_weights = os.path.join(project_dir, "runs", "detect", run_name, "weights", "best.pt")

    target_weights = os.path.join(project_dir, "custom_poultry.pt")
    backup_weights = os.path.join(project_dir, "custom_poultry_prev.pt")

    if os.path.isfile(best_weights):
        if os.path.isfile(target_weights):
            shutil.copy2(target_weights, backup_weights)
            print(f"💾 Backed up previous weights → {backup_weights}")
        shutil.copy2(best_weights, target_weights)
        print(f"\n🎉 Training complete!")
        print(f"   Best weights → {target_weights}")
    else:
        print("\n❌ Training finished but best.pt not found — check runs/ folder.")


if __name__ == "__main__":
    main()