#!/usr/bin/env python3
"""Android adaptive icon + launcher preview from the approved app icon.

    python3 driver-app/scripts/make-adaptive-icon.py [--check]

Reads  driver-app/assets/icon.png        (the approved artwork; iOS uses it
                                           as-is and this script never
                                           changes it)
Writes driver-app/assets/adaptive-icon.png (Android foreground layer)
       driver-app/scripts/icon-preview.png (launcher preview sheet, for
                                           review only; not used by the app)
and prints the background colour to set as
android.adaptiveIcon.backgroundColor in driver-app/app.json.

Android adaptive icons are 108dp layers that launchers crop to 72dp and then
mask to a circle, squircle, rounded square or similar. Only the central 66dp
circle is guaranteed to stay visible. The artwork is scaled so every
non-background pixel sits inside that circle (with a small extra margin),
centred on a canvas of the artwork's own background colour, so whichever
mask a phone uses, nothing in the design is cut off.

--check only validates the source icon (1024 x 1024, no transparency).
"""
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
SRC = os.path.join(ASSETS, "icon.png")
OUT = os.path.join(ASSETS, "adaptive-icon.png")
PREVIEW = os.path.join(HERE, "icon-preview.png")

SIZE = 1024
# Safe zone: 66dp of the 108dp layer, as a radius, with a 4% extra margin.
SAFE_RADIUS = SIZE * (66 / 108) / 2 * 0.96
# Pixels further than this from the background colour count as artwork.
TOLERANCE = 28


def fail(msg):
    print(f"ERROR: {msg}")
    sys.exit(1)


def load_source():
    if not os.path.exists(SRC):
        fail(f"{SRC} not found")
    img = Image.open(SRC)
    if img.size != (SIZE, SIZE):
        fail(f"icon.png is {img.size[0]} x {img.size[1]}; it must be {SIZE} x {SIZE}")
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        alpha = img.convert("RGBA").getchannel("A")
        if alpha.getextrema()[0] < 255:
            fail("icon.png has transparent pixels; the App Store requires an opaque icon")
    return img.convert("RGB")


def background_colour(img):
    """The most common colour on the outer border, and how uniform it is."""
    w, h = img.size
    px = img.load()
    border = [px[x, y] for x in range(w) for y in (0, 1, h - 2, h - 1)] + [px[x, y] for y in range(h) for x in (0, 1, w - 2, w - 1)]
    counts = {}
    for c in border:
        counts[c] = counts.get(c, 0) + 1
    bg = max(counts, key=counts.get)
    near = sum(1 for c in border if max(abs(c[i] - bg[i]) for i in range(3)) <= TOLERANCE)
    return bg, near / len(border)


def artwork_radius(img, bg):
    """Farthest artwork pixel from the centre (in source pixels)."""
    diff = ImageChops.difference(img, Image.new("RGB", img.size, bg)).convert("L")
    mask = diff.point(lambda v: 255 if v > TOLERANCE else 0)
    bbox = mask.getbbox()
    if not bbox:
        fail("icon.png appears to be a single flat colour")
    c = SIZE / 2
    px = mask.load()
    far = 0.0
    # Sampled every 2 px: plenty for a 1024 px icon.
    for y in range(bbox[1], bbox[3], 2):
        for x in range(bbox[0], bbox[2], 2):
            if px[x, y]:
                d = math.hypot(x + 0.5 - c, y + 0.5 - c)
                if d > far:
                    far = d
    return far, bbox


def build_foreground(img, bg, far):
    scale = min(1.0, SAFE_RADIUS / far)
    side = round(SIZE * scale)
    art = img.resize((side, side), Image.LANCZOS)
    canvas = Image.new("RGB", (SIZE, SIZE), bg)
    off = (SIZE - side) // 2
    canvas.paste(art, (off, off))
    return canvas, scale


def masked(layer, shape, size):
    """What a launcher shows: centre 72/108 of the layer, masked."""
    crop = round(SIZE * 72 / 108)
    off = (SIZE - crop) // 2
    view = layer.crop((off, off, off + crop, off + crop)).resize((size, size), Image.LANCZOS)
    m = Image.new("L", (size * 4, size * 4), 0)
    d = ImageDraw.Draw(m)
    s = size * 4
    if shape == "circle":
        d.ellipse((0, 0, s - 1, s - 1), fill=255)
    elif shape == "rounded":
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=round(s * 0.18), fill=255)
    elif shape == "squircle":
        pts = []
        for i in range(720):
            t = 2 * math.pi * i / 720
            ct, st = math.cos(t), math.sin(t)
            x = math.copysign(abs(ct) ** (2 / 5), ct)
            y = math.copysign(abs(st) ** (2 / 5), st)
            pts.append(((x + 1) / 2 * (s - 1), (y + 1) / 2 * (s - 1)))
        d.polygon(pts, fill=255)
    elif shape == "teardrop":
        r = s / 2
        d.ellipse((0, 0, s - 1, s - 1), fill=255)
        d.rectangle((r, r, s - 1, s - 1), fill=255)
    m = m.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(view, (0, 0), m)
    return out


def ios_icon(img, size):
    view = img.resize((size, size), Image.LANCZOS)
    m = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=round(size * 4 * 0.2237), fill=255)
    m = m.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(view, (0, 0), m)
    return out


def preview_sheet(img, fg, bg_hex, scale):
    big, small = 180, 64
    labels = [("iOS (approved icon)", None), ("Android circle", "circle"), ("Android squircle", "squircle"), ("Android rounded square", "rounded"), ("Android teardrop", "teardrop")]
    col = 240
    width = col * len(labels) + 40
    height = 640
    sheet = Image.new("RGB", (width, height), (250, 250, 250))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 15)
        bold = ImageFont.truetype("DejaVuSans-Bold.ttf", 17)
    except OSError:
        font = bold = ImageFont.load_default()
    d.text((20, 14), "HTS DRIVER launcher preview (review only; not used by the app)", fill=(20, 20, 20), font=bold)
    d.text((20, 38), f"Android background {bg_hex}; artwork scaled to {scale:.0%} so it all sits inside the 66dp safe circle.", fill=(60, 60, 60), font=font)
    # Light and dark home screens.
    for row, (panel, text) in enumerate([((250, 250, 250), (30, 30, 30)), ((24, 26, 33), (230, 230, 230))]):
        top = 70 + row * 285
        d.rectangle((0, top, width, top + 280), fill=panel)
        for i, (label, shape) in enumerate(labels):
            x = 20 + i * col + (col - big) // 2
            icon = ios_icon(img, big) if shape is None else masked(fg, shape, big)
            sheet.paste(icon, (x, top + 20), icon)
            sm = ios_icon(img, small) if shape is None else masked(fg, shape, small)
            sheet.paste(sm, (x + (big - small) // 2, top + 20 + big + 12), sm)
            d.text((20 + i * col + 10, top + 20 + big + small + 22), label, fill=text, font=font)
    return sheet


def main():
    img = load_source()
    if "--check" in sys.argv:
        print("icon.png OK: 1024 x 1024, opaque")
        return
    bg, uniform = background_colour(img)
    bg_hex = "#%02X%02X%02X" % bg
    if uniform < 0.9:
        print(f"WARNING: the artwork's edge is not one flat colour ({uniform:.0%} match {bg_hex}). "
              "The Android layer will show the artwork as an inset square; review the preview.")
    far, bbox = artwork_radius(img, bg)
    fg, scale = build_foreground(img, bg, far)
    fg.save(OUT, optimize=True)
    preview_sheet(img, fg, bg_hex, scale).save(PREVIEW, optimize=True)
    print(f"background {bg_hex} (edge uniformity {uniform:.0%})")
    print(f"artwork extends {far:.0f}px from centre; scaled to {scale:.0%} (safe radius {SAFE_RADIUS:.0f}px)")
    print(f"wrote {os.path.relpath(OUT)} and {os.path.relpath(PREVIEW)}")
    print(f'set android.adaptiveIcon.backgroundColor to "{bg_hex}" in driver-app/app.json')


if __name__ == "__main__":
    main()
