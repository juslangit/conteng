"""Draws Conteng's icons: a paper square with a scribble. Run: python3 tools/make_icons.py"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

def scribble(n=120):
    # A loose loop-de-loop, the same curve in every icon.
    pts = []
    for i in range(n + 1):
        t = i / n
        x = 0.18 + 0.64 * t + 0.07 * math.sin(t * math.pi * 6)
        y = 0.55 + 0.16 * math.sin(t * math.pi * 2.2) - 0.09 * math.cos(t * math.pi * 6)
        pts.append((x, y))
    return pts

def app_icon(size=1024):
    s = 4  # supersample
    W = size * s
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = int(W * 0.09)
    d.rounded_rectangle([m, m, W - m, W - m], radius=int(W * 0.2), fill=(251, 250, 247, 255), outline=(220, 214, 204, 255), width=int(W * 0.008))
    step = W // 16
    pad = int(W * 0.16)  # keep the dot grid clear of the rounded corners
    for gx in range(pad, W - pad + 1, step):
        for gy in range(pad, W - pad + 1, step):
            r = W * 0.004
            d.ellipse([gx - r, gy - r, gx + r, gy + r], fill=(228, 223, 214, 255))
    # Stamp round dabs along a dense path: a smooth, seamless pen stroke.
    pts = [(m + x * (W - 2 * m), m + y * (W - 2 * m)) for x, y in scribble(1500)]
    r = W * 0.0225
    for p in pts:
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(0, 144, 255, 255))
    dot = (m + 0.74 * (W - 2 * m), m + 0.28 * (W - 2 * m)); r = W * 0.04
    d.ellipse([dot[0] - r, dot[1] - r, dot[0] + r, dot[1] + r], fill=(229, 72, 77, 255))
    return img.resize((size, size), Image.LANCZOS)

def tray_icon(px, color):
    s = 8; W = px * s
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lw = max(1, int(W * 0.09))
    d.rounded_rectangle([lw, lw, W - lw, W - lw], radius=int(W * 0.24), outline=color, width=lw)
    r = lw / 2
    for x, y in scribble(800):
        p = (x * W, (y - 0.05) * W)
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)
    return img.resize((px, px), Image.LANCZOS)

(ROOT / "build").mkdir(exist_ok=True)
app_icon().save(ROOT / "build" / "icon.png")
a = ROOT / "renderer" / "assets"; a.mkdir(parents=True, exist_ok=True)
tray_icon(16, (0, 0, 0, 255)).save(a / "trayTemplate.png")
tray_icon(32, (0, 0, 0, 255)).save(a / "trayTemplate@2x.png")
tray_icon(32, (40, 40, 40, 255)).save(a / "tray.png")
print("icons written")
