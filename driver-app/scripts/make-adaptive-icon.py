#!/usr/bin/env python3
"""Android adaptive icon + launcher preview from the approved app icon.

    python3 driver-app/scripts/make-adaptive-icon.py [--key-radius PX] [--check]

Reads  driver-app/assets/icon.png   (the approved artwork; iOS uses it as-is
                                     and this script never changes it)
Writes driver-app/assets/adaptive-icon.png            (Android foreground)
       driver-app/assets/adaptive-icon-background.png (Android background,
                                     full-bleed artwork only)
       driver-app/scripts/icon-preview.png (launcher preview sheet, for
                                     review only; not used by the app)

Android adaptive icons are 108dp layers that launchers crop to 72dp and then
mask to a circle, squircle, rounded square or similar. Only the central 66dp
circle is guaranteed to stay visible, so the artwork is scaled until its
important content sits inside that circle (with a 4% extra margin).

Two kinds of artwork:
  - With a flat border colour: every non-background pixel counts as
    important; the layer is filled with that colour (backgroundColor).
  - Full-bleed (no flat border, e.g. a scene that runs to the edges): pass
    --key-radius, the distance in source pixels from the centre to the
    farthest pixel that must stay visible (for the HTS DRIVER artwork, the
    corners of the DRIVER badge). The scaled artwork is feathered into a
    background image: a vertical gradient between the artwork's own top and
    bottom edge colours.

--check only validates the source icon (1024 x 1024, no transparency).
"""
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
SRC = os.path.join(ASSETS, "icon.png")
OUT = os.path.join(ASSETS, "adaptive-icon.png")
OUT_BG = os.path.join(ASSETS, "adaptive-icon-background.png")
PREVIEW = os.path.join(HERE, "icon-preview.png")

SIZE = 1024
# Safe zone: 66dp of the 108dp layer, as a radius, with a 4% extra margin.
SAFE_RADIUS = SIZE * (66 / 108) / 2 * 0.96
# Pixels further than this from the background colour count as artwork.
TOLERANCE = 28


def fail(msg):
    print(f"ERROR: {msg}")
    sys.exit(1)


def arg(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
        fail(f"{name} needs a value")
    return None


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


def border_colour(img):
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


def edge_row_colour(img, rows):
    """Median colour of the given rows (for the gradient background)."""
    px = img.load()
    vals = sorted((px[x, y] for y in rows for x in range(0, SIZE, 4)), key=lambda c: sum(c))
    return vals[len(vals) // 2]


def artwork_radius(img, bg):
    """Farthest non-background pixel from the centre (source pixels)."""
    diff = ImageChops.difference(img, Image.new("RGB", img.size, bg)).convert("L")
    mask = diff.point(lambda v: 255 if v > TOLERANCE else 0)
    bbox = mask.getbbox()
    if not bbox:
        fail("icon.png appears to be a single flat colour")
    c = SIZE / 2
    px = mask.load()
    far = 0.0
    for y in range(bbox[1], bbox[3], 2):
        for x in range(bbox[0], bbox[2], 2):
            if px[x, y]:
                far = max(far, math.hypot(x + 0.5 - c, y + 0.5 - c))
    return far


def scaled(img, key_radius):
    scale = min(1.0, SAFE_RADIUS / key_radius)
    side = round(SIZE * scale)
    return img.resize((side, side), Image.LANCZOS), scale


def flat_layers(img, bg, key_radius):
    art, scale = scaled(img, key_radius)
    fg = Image.new("RGB", (SIZE, SIZE), bg)
    off = (SIZE - art.size[0]) // 2
    fg.paste(art, (off, off))
    return fg.convert("RGBA"), None, scale


def full_bleed_layers(img, key_radius, top, bottom):
    art, scale = scaled(img, key_radius)
    side = art.size[0]
    # Feathered rounded square: the artwork's edges fade into the background.
    feather = round(side * 0.07)
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle((feather, feather, side - feather, side - feather), radius=round(side * 0.2), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather * 0.6))
    fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    off = (SIZE - side) // 2
    fg.paste(art, (off, off), mask)
    bg = Image.new("RGB", (SIZE, SIZE))
    d = ImageDraw.Draw(bg)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        d.line((0, y, SIZE, y), fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return fg, bg, scale


def masked(layer, shape, size):
    """What a launcher shows: centre 72/108 of the layer, masked."""
    crop = round(SIZE * 72 / 108)
    off = (SIZE - crop) // 2
    view = layer.crop((off, off, off + crop, off + crop)).resize((size, size), Image.LANCZOS)
    s = size * 4
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    if shape == "circle":
        d.ellipse((0, 0, s - 1, s - 1), fill=255)
    elif shape == "rounded":
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=round(s * 0.18), fill=255)
    elif shape == "squircle":
        pts = []
        for i in range(720):
            t = 2 * math.pi * i / 720
            ct, st = math.cos(t), math.sin(t)
            pts.append(((math.copysign(abs(ct) ** 0.4, ct) + 1) / 2 * (s - 1), (math.copysign(abs(st) ** 0.4, st) + 1) / 2 * (s - 1)))
        d.polygon(pts, fill=255)
    elif shape == "teardrop":
        d.ellipse((0, 0, s - 1, s - 1), fill=255)
        d.rectangle((s / 2, s / 2, s - 1, s - 1), fill=255)
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


def preview_sheet(img, layer, caption):
    big, small = 180, 64
    labels = [("iOS (approved icon)", None), ("Android circle", "circle"), ("Android squircle", "squircle"), ("Android rounded square", "rounded"), ("Android teardrop", "teardrop")]
    col = 240
    width = col * len(labels) + 40
    sheet = Image.new("RGB", (width, 640), (250, 250, 250))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 15)
        bold = ImageFont.truetype("DejaVuSans-Bold.ttf", 17)
    except OSError:
        font = bold = ImageFont.load_default()
    d.text((20, 14), "HTS DRIVER launcher preview (review only; not used by the app)", fill=(20, 20, 20), font=bold)
    d.text((20, 38), caption, fill=(60, 60, 60), font=font)
    for row, (panel, text) in enumerate([((250, 250, 250), (30, 30, 30)), ((24, 26, 33), (230, 230, 230))]):
        top = 70 + row * 285
        d.rectangle((0, top, width, top + 280), fill=panel)
        for i, (label, shape) in enumerate(labels):
            x = 20 + i * col + (col - big) // 2
            icon = ios_icon(img, big) if shape is None else masked(layer, shape, big)
            sheet.paste(icon, (x, top + 20), icon)
            sm = ios_icon(img, small) if shape is None else masked(layer, shape, small)
            sheet.paste(sm, (x + (big - small) // 2, top + 20 + big + 12), sm)
            d.text((20 + i * col + 10, top + 20 + big + small + 22), label, fill=text, font=font)
    return sheet


def hexc(c):
    return "#%02X%02X%02X" % tuple(c)


def main():
    img = load_source()
    if "--check" in sys.argv:
        print("icon.png OK: 1024 x 1024, opaque")
        return
    bg, uniform = border_colour(img)
    key = arg("--key-radius")
    if uniform >= 0.9 and key is None:
        far = artwork_radius(img, bg)
        fg, bg_img, scale = flat_layers(img, bg, far)
        print(f"flat border {hexc(bg)}; artwork extends {far:.0f}px from centre")
        print(f'app.json android.adaptiveIcon: foregroundImage ./assets/adaptive-icon.png, backgroundColor "{hexc(bg)}" (no backgroundImage)')
        caption = f"Android background {hexc(bg)}; artwork scaled to {scale:.0%} so it all sits inside the 66dp safe circle."
        composite = fg
    else:
        if key is None:
            fail(f"the artwork has no flat border ({uniform:.0%} match); pass --key-radius (source px from centre to the farthest pixel that must stay visible)")
        key_radius = float(key)
        top = edge_row_colour(img, range(0, 6))
        bottom = edge_row_colour(img, range(SIZE - 6, SIZE))
        fg, bg_img, scale = full_bleed_layers(img, key_radius, top, bottom)
        bg_img.save(OUT_BG, optimize=True)
        print(f"full-bleed artwork; key content radius {key_radius:.0f}px; gradient {hexc(top)} -> {hexc(bottom)}")
        print(f'app.json android.adaptiveIcon: foregroundImage ./assets/adaptive-icon.png, backgroundImage ./assets/adaptive-icon-background.png, backgroundColor "{hexc(bottom)}"')
        caption = f"Android: artwork at {scale:.0%}, key content inside the 66dp safe circle; edges fade into a {hexc(top)} to {hexc(bottom)} gradient."
        composite = bg_img.convert("RGBA")
        composite.alpha_composite(fg)
    fg.save(OUT, optimize=True)
    preview_sheet(img, composite, caption).save(PREVIEW, optimize=True)
    print(f"artwork scaled to {scale:.0%} (safe radius {SAFE_RADIUS:.0f}px)")
    print(f"wrote {os.path.relpath(OUT)}{' and ' + os.path.relpath(OUT_BG) if bg_img else ''}; preview {os.path.relpath(PREVIEW)}")


if __name__ == "__main__":
    main()
