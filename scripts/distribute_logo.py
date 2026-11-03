"""
Script to generate and distribute the enhanced rounded ChickenSee logo/icon across the entire system.
Features:
- Smooth modern squircle border-radius (22.5% corner radius)
- Anti-aliased alpha transparency around corners for seamless rendering on any wallpaper/taskbar
- Soft subtle ambient shadow for modern elevated app card appearance
- Ultra-crisp subtle border stroke (slate/warm rim)
- Multi-resolution Windows ICO (16, 24, 32, 48, 64, 128, 256) with full 32-bit alpha channel
- Web icons (Next.js app/icon.png, public/favicon.png, apple-touch-icon, PWA 192/512)
- Desktop app header and taskbar assets (startup/favicon_logo256, favicon_logo128, favicon_badge)
- Immediate Windows desktop shortcut & icon cache refresh
"""

import os
import sys
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MASTER_LOGO = (
    PROJECT_ROOT / "logo_master_raw.png"
    if (PROJECT_ROOT / "logo_master_raw.png").is_file()
    else PROJECT_ROOT / "logo.png"
)


def create_enhanced_squircle_icon(master_img: Image.Image, target_size: int = 1024) -> Image.Image:
    """
    Renders an enhanced, modern squircle app icon from the master image:
    - Smooth rounded corners (22.5% radius)
    - Anti-aliased transparent padding
    - Ambient elevation shadow
    - Crisp subtle border stroke
    - Perfectly centered rooster graphic
    """
    rgb_img = master_img.convert("RGB")
    w, h = master_img.size

    # Detect bounding box of the non-white rooster graphic
    non_white = []
    for y in range(h):
        for x in range(w):
            r, g, b = rgb_img.getpixel((x, y))
            if r < 248 or g < 248 or b < 248:
                non_white.append((x, y))

    if not non_white:
        min_x, max_x, min_y, max_y = 0, w - 1, 0, h - 1
    else:
        min_x = min(p[0] for p in non_white)
        max_x = max(p[0] for p in non_white)
        min_y = min(p[1] for p in non_white)
        max_y = max(p[1] for p in non_white)

    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0
    gw = max_x - min_x + 1
    gh = max_y - min_y + 1
    gmax = max(gw, gh)

    # Work at 2x super-sampling for silky-smooth anti-aliasing
    scale = 2
    canvas_size = target_size * scale
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

    # Outer margin gives room for the subtle ambient shadow
    margin = int(canvas_size * 0.04)
    card_box = [margin, margin, canvas_size - margin, canvas_size - margin]
    radius = int((canvas_size - 2 * margin) * 0.22)  # Modern 22% squircle radius

    # 1. Soft Ambient Elevation Shadow
    shadow_offset = int(canvas_size * 0.015)
    shadow_box = [
        margin,
        margin + shadow_offset,
        canvas_size - margin,
        canvas_size - margin + shadow_offset,
    ]
    shadow_mask = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_mask)
    shadow_draw.rounded_rectangle(shadow_box, radius=radius, fill=(15, 23, 42, 60))
    shadow_blurred = shadow_mask.filter(ImageFilter.GaussianBlur(int(canvas_size * 0.02)))
    canvas.alpha_composite(shadow_blurred)

    # 2. Rounded Card Surface
    card_surface = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    card_draw = ImageDraw.Draw(card_surface)
    card_draw.rounded_rectangle(card_box, radius=radius, fill=(255, 255, 255, 255))

    # 3. Center and Paste the Rooster Graphic
    card_inner_size = card_box[2] - card_box[0]
    target_graphic_size = int(card_inner_size * 0.74)
    half_crop = (gmax / 2.0) * 1.04
    crop_x1 = max(0, int(cx - half_crop))
    crop_y1 = max(0, int(cy - half_crop))
    crop_x2 = min(w, int(cx + half_crop))
    crop_y2 = min(h, int(cy + half_crop))

    cropped_graphic = master_img.crop((crop_x1, crop_y1, crop_x2, crop_y2))
    resized_graphic = cropped_graphic.resize((target_graphic_size, target_graphic_size), Image.Resampling.LANCZOS)

    gx = card_box[0] + (card_inner_size - target_graphic_size) // 2
    gy = card_box[1] + (card_inner_size - target_graphic_size) // 2
    card_surface.paste(resized_graphic, (gx, gy))

    # 4. Mask the entire card to the rounded squircle
    card_mask = Image.new("L", (canvas_size, canvas_size), 0)
    ImageDraw.Draw(card_mask).rounded_rectangle(card_box, radius=radius, fill=255)

    # 5. Crisp subtle border stroke
    border_width = max(2, int(canvas_size * 0.003))
    ImageDraw.Draw(card_surface).rounded_rectangle(
        card_box,
        radius=radius,
        outline=(226, 232, 240, 240),
        width=border_width,
    )

    # Composite card with mask
    clean_card = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    clean_card.paste(card_surface, (0, 0), card_mask)
    canvas.alpha_composite(clean_card)

    # Downsample to target size with Lanczos filter for crisp edge definition
    return canvas.resize((target_size, target_size), Image.Resampling.LANCZOS)


def main():
    if not MASTER_LOGO.is_file():
        raise FileNotFoundError(f"Master logo not found at {MASTER_LOGO}")

    print(f"[LOGO] Loading master logo: {MASTER_LOGO}")
    raw_img = Image.open(MASTER_LOGO)
    print(f"[LOGO] Original format: {raw_img.format}, size: {raw_img.size}, mode: {raw_img.mode}")

    print("[LOGO] Generating enhanced squircle logo (1024x1024) with anti-aliased rounded borders...")
    enhanced_1024 = create_enhanced_squircle_icon(raw_img, 1024)

    # 1. Distribute Web public icons
    public_dir = PROJECT_ROOT / "public"
    public_dir.mkdir(parents=True, exist_ok=True)

    enhanced_1024.save(public_dir / "favicon.png", format="PNG")
    print(f"[OK] Saved: {public_dir / 'favicon.png'}")

    apple_180 = enhanced_1024.resize((180, 180), Image.Resampling.LANCZOS)
    apple_180.save(public_dir / "apple-touch-icon.png", format="PNG")
    print(f"[OK] Saved: {public_dir / 'apple-touch-icon.png'}")

    pwa_192 = enhanced_1024.resize((192, 192), Image.Resampling.LANCZOS)
    pwa_192.save(public_dir / "icon-192.png", format="PNG")
    print(f"[OK] Saved: {public_dir / 'icon-192.png'}")

    pwa_512 = enhanced_1024.resize((512, 512), Image.Resampling.LANCZOS)
    pwa_512.save(public_dir / "icon-512.png", format="PNG")
    print(f"[OK] Saved: {public_dir / 'icon-512.png'}")

    # 2. Next.js app directory icons
    app_dir = PROJECT_ROOT / "app"
    enhanced_1024.save(app_dir / "icon.png", format="PNG")
    print(f"[OK] Saved: {app_dir / 'icon.png'}")

    apple_180.save(app_dir / "apple-icon.png", format="PNG")
    print(f"[OK] Saved: {app_dir / 'apple-icon.png'}")

    # 3. Root icons
    enhanced_1024.save(PROJECT_ROOT / "favicon.png", format="PNG")
    print(f"[OK] Saved: {PROJECT_ROOT / 'favicon.png'}")

    enhanced_1024.save(PROJECT_ROOT / "logo.png", format="PNG")
    print(f"[OK] Saved: {PROJECT_ROOT / 'logo.png'}")
    enhanced_1024.save(public_dir / "logo.png", format="PNG")
    print(f"[OK] Saved: {public_dir / 'logo.png'}")

    # Multi-size ICO files (16, 24, 32, 48, 64, 128, 256) with 32-bit RGBA alpha channel
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_targets = [
        PROJECT_ROOT / "favicon.ico",
        app_dir / "favicon.ico",
        public_dir / "favicon.ico",
        PROJECT_ROOT / "startup" / "favicon.ico",
        PROJECT_ROOT / "startup" / "favicon_clean.ico",
    ]

    for ico_path in ico_targets:
        enhanced_1024.save(ico_path, format="ICO", sizes=ico_sizes)
        print(f"[OK] Saved multi-resolution ICO: {ico_path}")

    # 4. Startup / Desktop application assets
    startup_dir = PROJECT_ROOT / "startup"
    if startup_dir.is_dir():
        enhanced_1024.save(startup_dir / "favicon.png", format="PNG")
        print(f"[OK] Saved: {startup_dir / 'favicon.png'}")

        logo_256 = enhanced_1024.resize((256, 256), Image.Resampling.LANCZOS)
        logo_256.save(startup_dir / "favicon_logo256.png", format="PNG")
        print(f"[OK] Saved: {startup_dir / 'favicon_logo256.png'}")

        logo_128 = enhanced_1024.resize((128, 128), Image.Resampling.LANCZOS)
        logo_128.save(startup_dir / "favicon_logo128.png", format="PNG")
        print(f"[OK] Saved: {startup_dir / 'favicon_logo128.png'}")

        badge_96 = enhanced_1024.resize((96, 96), Image.Resampling.LANCZOS)
        badge_96.save(startup_dir / "favicon_badge.png", format="PNG")
        print(f"[OK] Saved: {startup_dir / 'favicon_badge.png'}")

    # 5. Refresh Windows Desktop Shortcut & Icon Cache
    desktop_shortcut = Path.home() / "Desktop" / "ChickenSee Control Center.lnk"
    if desktop_shortcut.is_file():
        try:
            ps_script = f"""
            $sh = New-Object -ComObject WScript.Shell
            $sc = $sh.CreateShortcut('{desktop_shortcut}')
            $sc.IconLocation = '{PROJECT_ROOT / "favicon.ico"},0'
            $sc.Save()
            """
            subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], check=True)
            print(f"[OK] Updated Desktop shortcut icon location: {desktop_shortcut}")
        except Exception as e:
            print(f"[WARN] Could not update shortcut: {e}")

    # Notify Windows Explorer to refresh icon cache
    try:
        subprocess.run(["ie4uinit.exe", "-show"], timeout=2)
    except Exception:
        pass

    print("\n[SUCCESS] Enhanced rounded logo & icon distributed across the entire system!")


if __name__ == "__main__":
    main()
