#!/usr/bin/env python3
"""Splash image + phone/tablet preview from the approved app icon.

    python3 driver-app/scripts/make-splash.py --key-radius 610

Reads  driver-app/assets/icon.png   (approved artwork; never changed)
Writes driver-app/assets/splash.png (1024 x 1024, same size and square
                                     proportions as before; app.json shows
                                     it with resizeMode "contain")
       driver-app/scripts/splash-preview.png (review only)

The artwork keeps its square proportions (never stretched), centred on the
splash background colour, with its edges feathered into it. It is sized so
its important content (--key-radius, source px from the centre; the DRIVER
badge's corners for the HTS DRIVER artwork) stays inside the central circle
Android 12+ keeps when it shows a splash image as an icon (2/3 of the
image), with a 4% margin. iOS and older Android show the whole image.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
SRC = os.path.join(ASSETS, "icon.png")
OUT = os.path.join(ASSETS, "splash.png")
PREVIEW = os.path.join(HERE, "splash-preview.png")
SIZE = 1024
SAFE_RADIUS = SIZE / 3 * 0.96
# The artwork's own bottom-edge navy (also the Android icon background).
BACKGROUND = (0x01, 0x09, 0x37)


def fail(msg):
    print(f"ERROR: {msg}")
    sys.exit(1)


def build(img, key_radius):
    scale = min(1.0, SAFE_RADIUS / key_radius)
    side = round(SIZE * scale)
    art = img.resize((side, side), Image.LANCZOS)
    feather = round(side * 0.05)
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle((feather, feather, side - feather, side - feather), radius=round(side * 0.18), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather * 0.6))
    out = Image.new("RGB", (SIZE, SIZE), BACKGROUND)
    off = (SIZE - side) // 2
    out.paste(art, (off, off), mask)
    return out, scale


def device(splash, w, h, label, android12=False, density=3.0):
    """A screen of w x h px showing the splash as the platform would."""
    screen = Image.new("RGB", (w, h), BACKGROUND)
    if android12:
        # Android 12+ splash: image drawn as a 240dp icon, masked to a
        # 160dp circle, centred.
        icon = round(240 * density)
        img = splash.resize((icon, icon), Image.LANCZOS)
        m = Image.new("L", (icon, icon), 0)
        c = round(160 * density)
        o = (icon - c) // 2
        ImageDraw.Draw(m).ellipse((o, o, o + c, o + c), fill=255)
        screen.paste(img, ((w - icon) // 2, (h - icon) // 2), m)
    else:
        side = min(w, h)
        img = splash.resize((side, side), Image.LANCZOS)
        screen.paste(img, ((w - side) // 2, (h - side) // 2))
    return screen, label


def frame(screen, height):
    scale = height / screen.height
    s = screen.resize((round(screen.width * scale), height), Image.LANCZOS)
    pad = 10
    f = Image.new("RGB", (s.width + 2 * pad, s.height + 2 * pad), (20, 20, 24))
    m = Image.new("L", f.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, f.width - 1, f.height - 1), radius=28, fill=255)
    f.paste(s, (pad, pad))
    out = Image.new("RGBA", f.size, (0, 0, 0, 0))
    out.paste(f, (0, 0), m)
    return out


def main():
    if "--key-radius" not in sys.argv:
        fail("pass --key-radius (source px from centre to the farthest pixel that must stay visible)")
    key_radius = float(sys.argv[sys.argv.index("--key-radius") + 1])
    img = Image.open(SRC).convert("RGB")
    if img.size != (SIZE, SIZE):
        fail("icon.png must be 1024 x 1024")
    splash, scale = build(img, key_radius)
    splash.save(OUT, optimize=True)

    shots = [
        device(splash, 1179, 2556, "iPhone (portrait)"),
        device(splash, 1080, 2400, "Android 12+ phone", android12=True, density=2.625),
        device(splash, 1080, 2400, "Android 11 and older phone"),
        device(splash, 1640, 2360, "iPad (portrait; app is portrait-only)", density=2.0),
    ]
    height = 520
    frames = [(frame(s, height), label) for s, label in shots]
    width = sum(f.width for f, _ in frames) + 40 * (len(frames) + 1)
    sheet = Image.new("RGB", (width, height + 130), (250, 250, 250))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 15)
        bold = ImageFont.truetype("DejaVuSans-Bold.ttf", 17)
    except OSError:
        font = bold = ImageFont.load_default()
    d.text((20, 12), "HTS DRIVER splash preview (review only; not used by the app)", fill=(20, 20, 20), font=bold)
    bg_hex = "#%02X%02X%02X" % BACKGROUND
    d.text((20, 36), f"Artwork at {scale:.0%} of the 1024 px splash, square proportions kept, on {bg_hex}; key content inside Android 12's circle.", fill=(60, 60, 60), font=font)
    x = 40
    for f, label in frames:
        sheet.paste(f, (x, 70), f)
        d.text((x, 70 + f.height + 10), label, fill=(30, 30, 30), font=font)
        x += f.width + 40
    sheet.save(PREVIEW, optimize=True)
    print(f"splash: artwork at {scale:.0%}; background {bg_hex}")
    print(f"wrote {os.path.relpath(OUT)} and {os.path.relpath(PREVIEW)}")


if __name__ == "__main__":
    main()
