"""
Script to distribute the master logo.png across the entire ChickenSee system.
Generates all required icon sizes and formats for Web (Next.js), Desktop, and Windows shortcuts.
"""

from pathlib import Path
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MASTER_LOGO = PROJECT_ROOT / "logo.png"

def main():
    if not MASTER_LOGO.is_file():
        raise FileNotFoundError(f"Master logo not found at {MASTER_LOGO}")

    print(f"Loading master logo: {MASTER_LOGO}")
    img = Image.open(MASTER_LOGO)
    print(f"Original format: {img.format}, size: {img.size}, mode: {img.mode}")

    # Find the bounding box of non-white pixels
    rgb_img = img.convert("RGB")
    w, h = img.size
    
    # Check pixels that are not pure white (threshold < 250)
    non_white = []
    for y in range(h):
        for x in range(w):
            r, g, b = rgb_img.getpixel((x, y))
            if r < 248 or g < 248 or b < 248:
                non_white.append((x, y))
    
    if not non_white:
        print("Warning: No non-white pixels found; using full image.")
        bbox = (0, 0, w, h)
    else:
        min_x = min(p[0] for p in non_white)
        max_x = max(p[0] for p in non_white)
        min_y = min(p[1] for p in non_white)
        max_y = max(p[1] for p in non_white)
        bbox = (min_x, min_y, max_x, max_y)
        print(f"Detected graphic bounding box: {bbox} (width: {max_x - min_x + 1}, height: {max_y - min_y + 1})")

    # Center of the graphic
    cx = (bbox[0] + bbox[2]) / 2.0
    cy = (bbox[1] + bbox[3]) / 2.0
    gw = bbox[2] - bbox[0] + 1
    gh = bbox[3] - bbox[1] + 1
    max_dim = max(gw, gh)

    # Frame with balanced ~8% padding for icons (so icon fills ~84% of canvas)
    frame_size = int(max_dim / 0.84)
    half_frame = frame_size / 2.0

    crop_x1 = max(0, int(cx - half_frame))
    crop_y1 = max(0, int(cy - half_frame))
    crop_x2 = min(w, int(cx + half_frame))
    crop_y2 = min(h, int(cy + half_frame))

    # Create high-res square framed logo with white background
    framed_white = Image.new("RGBA", (frame_size, frame_size), (255, 255, 255, 255))
    paste_x = int(half_frame - (cx - crop_x1))
    paste_y = int(half_frame - (cy - crop_y1))
    cropped = img.crop((crop_x1, crop_y1, crop_x2, crop_y2))
    framed_white.paste(cropped, (paste_x, paste_y))

    # Resize framed logo to high-res standard 1024x1024
    framed_1024 = framed_white.resize((1024, 1024), Image.Resampling.LANCZOS)

    # 1. Distribute web public icons
    public_dir = PROJECT_ROOT / "public"
    public_dir.mkdir(parents=True, exist_ok=True)

    # public/logo.png: Keep original master logo or framed?
    # Save original to public/logo.png and framed to public/favicon.png & app/icon.png
    img.save(public_dir / "logo.png", format="PNG")
    print(f"Saved: {public_dir / 'logo.png'}")

    framed_1024.convert("RGB").save(public_dir / "favicon.png", format="PNG")
    print(f"Saved: {public_dir / 'favicon.png'}")

    # Apple touch icon (180x180 RGB)
    apple_180 = framed_white.resize((180, 180), Image.Resampling.LANCZOS).convert("RGB")
    apple_180.save(public_dir / "apple-touch-icon.png", format="PNG")
    print(f"Saved: {public_dir / 'apple-touch-icon.png'}")

    # PWA icons
    pwa_192 = framed_white.resize((192, 192), Image.Resampling.LANCZOS).convert("RGB")
    pwa_192.save(public_dir / "icon-192.png", format="PNG")
    print(f"Saved: {public_dir / 'icon-192.png'}")

    pwa_512 = framed_white.resize((512, 512), Image.Resampling.LANCZOS).convert("RGB")
    pwa_512.save(public_dir / "icon-512.png", format="PNG")
    print(f"Saved: {public_dir / 'icon-512.png'}")

    # 2. Next.js app directory icons
    app_dir = PROJECT_ROOT / "app"
    framed_1024.convert("RGB").save(app_dir / "icon.png", format="PNG")
    print(f"Saved: {app_dir / 'icon.png'}")

    apple_180.save(app_dir / "apple-icon.png", format="PNG")
    print(f"Saved: {app_dir / 'apple-icon.png'}")

    # 3. Root icons
    framed_1024.convert("RGB").save(PROJECT_ROOT / "favicon.png", format="PNG")
    print(f"Saved: {PROJECT_ROOT / 'favicon.png'}")

    # Multi-size ICO files (16, 24, 32, 48, 64, 128, 256)
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    
    for ico_path in [
        PROJECT_ROOT / "favicon.ico",
        app_dir / "favicon.ico",
        public_dir / "favicon.ico",
        PROJECT_ROOT / "startup" / "favicon.ico",
        PROJECT_ROOT / "startup" / "favicon_clean.ico",
    ]:
        framed_white.save(ico_path, format="ICO", sizes=ico_sizes)
        print(f"Saved: {ico_path}")

    # 4. Startup / Desktop application assets
    startup_dir = PROJECT_ROOT / "startup"
    if startup_dir.is_dir():
        framed_1024.convert("RGB").save(startup_dir / "favicon.png", format="PNG")
        print(f"Saved: {startup_dir / 'favicon.png'}")

        # favicon_logo256.png (256x256)
        logo_256 = framed_white.resize((256, 256), Image.Resampling.LANCZOS)
        logo_256.save(startup_dir / "favicon_logo256.png", format="PNG")
        print(f"Saved: {startup_dir / 'favicon_logo256.png'}")

        # favicon_logo128.png (128x128)
        logo_128 = framed_white.resize((128, 128), Image.Resampling.LANCZOS)
        logo_128.save(startup_dir / "favicon_logo128.png", format="PNG")
        print(f"Saved: {startup_dir / 'favicon_logo128.png'}")

        # favicon_badge.png (96x96 rounded dark badge for desktop header)
        badge_96 = framed_white.resize((96, 96), Image.Resampling.LANCZOS)
        badge_96.save(startup_dir / "favicon_badge.png", format="PNG")
        print(f"Saved: {startup_dir / 'favicon_badge.png'}")

    print("\nAll icons and logos distributed successfully!")

if __name__ == "__main__":
    main()

