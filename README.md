# GIF 2 CPP

<img width="256" height="128" alt="preview" src="https://github.com/user-attachments/assets/249ffae1-ae07-4488-94f3-85b41f887f4d" />

A React app that converts GIFs into compressed C++ animation headers for 128×64
SSD1306 OLED displays. It is a browser port of `reference/gif2cpp.py`. With
Fit to screen set to Show all, its output is byte-for-byte identical to that script's.

Fit to screen:
- Fill screen (default): a 2:1 crop inside the picture, so there are never black bars
- Stretch: the whole subject, squeezed to 2:1
- Show all: the script's padded crop, which leaves black bars on wide or tall clips

```
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/, host it anywhere
npm run parity    # compares output with the Python script (needs Python + Pillow)
npm run colors    # checks red, blue, purple and dark green shapes show up (needs Python + Pillow)
npm run detail    # checks a faint nose, mouth and thin dial arc survive shrinking, and that
                  # small digits are not distorted (needs Python + Pillow)
```

## What it does

- Drop GIFs (or animated PNG/WebP, or a numbered sequence of stills) anywhere on the page.
- Tune threshold, invert, crop-to-subject, noise removal and frame limit, and watch the
  result on a simulated OLED, with the source frame and crop box underneath.
- Frame it by hand: drag the frame under the display (corners and the scroll wheel zoom),
  or drag and scroll on the display itself. Arrow buttons and keys nudge it; Fit width,
  Fit height and Center help with 16:9 or square clips; Back to automatic undoes it.
- Download `anim_<name>.h`, `animations.h`, an example `MochiPlayer.ino`, or everything as a ZIP.
- Open the `.h` files from an existing sketch to keep its animations and order. A GIF
  with the same C name replaces the old one in place, like the script's "updated" behaviour.

## Colour, cleanup and styles

The script turns colour into brightness (0.30 R + 0.59 G + 0.11 B), so on a
black background pure red becomes 76 and pure blue 29, both below its
threshold of 110: red and blue parts vanish. The app's default, All colours,
detects the background colour from the frame borders and lights up every
pixel that differs from it by enough, whatever its hue.

- The colour measure averages the largest channel difference with the brightness
  difference, so saturated colours count fully and light colours keep their shading.
- Fine detail finds thin lines (a nose, a mouth, eyelids) at full resolution, before
  shrinking to 128×64 would average them away, and draws them on the display. A line
  must be darker (or brighter) than both sides of it and about 1.5 display pixels long;
  dithering and grain cancel out. Lines are thinned to their centre and a line is only
  restored if the normal conversion really lost it: it must sit in a plain area (a
  mouth on skin, an arc on a black dial), be at least 3 display pixels long, and be
  less than 40% visible already. Strokes of small text are left as they are.
- Remove specks only fills pinholes inside broad lit areas and only removes lone
  pixels on broad dark areas, so the holes in small digits stay open.
- Reduce flicker only holds pixels whose brightness barely changed, so moving things
  (a needle) leave no trail.
- Fix blur never cuts a structure up to 3 pixels wide or fills a gap that narrow, so
  thin text and ticks keep their shape while blurry blobs and regions still sharpen.
- Automatic threshold (Otsu's method) picks the cut per clip.
- Fix blur cuts each pixel at the midpoint of its neighbourhood (Bernsen), so
  blurry shapes keep their true size whether they are bright or dim.
- Noise removal: Gentle (default) removes specks but keeps thin lines and text;
  Median is the script's 3×3 filter; Strong is 5×5.
- Auto contrast, Remove specks and Reduce flicker (hysteresis between frames).
- Styles: Solid, Dither (ordered, so it does not shimmer) and Outline.
- "Use Python script settings" switches a clip back to the script's behaviour.

## Pipeline

colour → gray (All colours or Brightness) → noise removal → crop (see Fit to screen)
→ Lanczos resize to 128×64 (Pillow's fixed-point algorithm) → invert → auto contrast
→ threshold / dither / outline (with Fix blur and Reduce flicker) → fine detail lines
→ remove specks
→ 1 bpp row-major MSB-first → XOR against the previous frame → PackBits.
With the script's settings each step is exactly the script's. Each clip must stay under 65,535 compressed
bytes because the offset table is `uint16_t`.

## Code map

- `src/lib/mochi.js`: the conversion core and file writers (pure JS, also runs in Node)
- `src/lib/enhance.js`: colour handling, noise removal, contrast, Fix blur, dithering, outlines
- `src/lib/decode.js`: GIF compositing with gifuct-js, ImageDecoder for APNG/WebP
- `src/lib/pipeline.js`: `convert()` with per-stage caching
- `src/worker.js`: runs decoding and encoding off the main thread
- `src/lib/sketch.js`: the example Arduino sketch and README that go in the ZIP
- `src/components/`: the UI




https://github.com/user-attachments/assets/4ff33ff1-8c29-4c99-af39-95c2e9a2d94a






