"""Generates test GIFs that exercise the tricky parts of the pipeline."""
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
random.seed(7)


def save(name, frames, **kw):
    frames[0].save(os.path.join(out, name), save_all=True, append_images=frames[1:],
                   duration=kw.pop("duration", 60), loop=0, **kw)


# 1. bouncing soft ball on black, Pillow writes partial (cropped) frames
fr = []
for i in range(30):
    im = Image.new("L", (240, 180), 0)
    d = ImageDraw.Draw(im)
    x = 40 + 150 * abs(math.sin(i / 6))
    y = 60 + 40 * math.cos(i / 4)
    d.ellipse((x, y, x + 50, y + 50), fill=230)
    d.rectangle((20, 150, 220, 160), fill=140 + i * 3)
    fr.append(im.filter(ImageFilter.GaussianBlur(1.5)).convert("RGB"))
save("ball.gif", fr)

# 2. tiny source (upscale path) with noise
fr = []
for i in range(12):
    im = Image.new("RGB", (60, 40), (0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((4 + i, 12), "hi!", fill=(255, 255, 255))
    for _ in range(40):
        im.putpixel((random.randrange(60), random.randrange(40)), (200, 200, 200))
    fr.append(im)
save("tiny.gif", fr, duration=100)

# 3. tall source: Pillow runs the vertical pass first
fr = []
for i in range(10):
    im = Image.new("RGB", (150, 400), (10, 10, 30))
    d = ImageDraw.Draw(im)
    d.ellipse((30, 20 + i * 30, 120, 110 + i * 30), fill=(250, 220, 90))
    d.line((0, 399 - i * 20, 149, i * 20), fill=(180, 255, 180), width=4)
    fr.append(im)
save("tall.gif", fr)

# 4. light background, dark subject (use --invert)
fr = []
for i in range(16):
    im = Image.new("RGB", (320, 200), (245, 240, 230))
    d = ImageDraw.Draw(im)
    d.ellipse((100 + i * 4, 60, 180 + i * 4, 140), fill=(30, 30, 40))
    d.ellipse((200 - i * 3, 70, 240 - i * 3, 110), fill=(90, 60, 50))
    fr.append(im)
save("light.gif", fr)

# 5. long clip with a gradient (subsampling, many distinct frames)
fr = []
for i in range(90):
    im = Image.new("L", (256, 128))
    px = im.load()
    for y in range(128):
        for x in range(256):
            px[x, y] = int(127 + 127 * math.sin((x + i * 5) / 17 + y / 23))
    fr.append(im.convert("RGB"))
save("waves.gif", fr, duration=40)
print("ok")
