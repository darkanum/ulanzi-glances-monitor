import sys
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(sys.argv[1])
BG, TRACK = (30, 31, 34, 255), (47, 49, 54, 255)
BARS = [((63, 185, 80, 255), 0.45), ((210, 153, 34, 255), 0.75), ((248, 81, 73, 255), 0.95)]

def icon(size, background=True):
    img = Image.new("RGBA", (size, size), BG if background else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad, gap = size * 0.18, size * 0.08
    width = (size - 2 * pad - 2 * gap) / 3
    base = size - pad
    for i, (color, level) in enumerate(BARS):
        x0 = pad + i * (width + gap)
        d.rectangle([x0, pad, x0 + width, base], fill=TRACK)
        d.rectangle([x0, base - (base - pad) * level, x0 + width, base], fill=color)
    return img

icon(196).save(out / "icon.png")
icon(196).save(out / "actionIcon.png")
icon(56, background=False).save(out / "categoryIcon.png")
