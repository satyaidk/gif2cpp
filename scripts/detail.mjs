// Checks that faint thin lines (a nose, a mouth) survive shrinking a large,
// light-coloured picture to 128x64. Run: npm run detail
// Needs Python 3 with Pillow on PATH as `python` (only to draw the test GIF).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeGif } from '../src/lib/decode.js';
import { createClip, processClip } from '../src/lib/pipeline.js';
import { DEFAULT_SETTINGS, W } from '../src/lib/mochi.js';

const dir = mkdtempSync(join(tmpdir(), 'mochi-detail-'));
const python = process.env.PYTHON || 'python';

// A light face on a dark navy background, like many anime GIFs. Source
// coordinates; the whole 480x270 frame maps onto 128x64 (fit: stretch).
execFileSync(python, ['-c', `
import sys
from PIL import Image, ImageDraw
frames = []
for i in range(3):
    im = Image.new("RGB", (480, 270), (25, 18, 58)); d = ImageDraw.Draw(im)
    d.ellipse((90, -60, 390, 300), fill=(252, 244, 248))                   # face
    for cx in (175, 305):
        d.ellipse((cx - 24, 95, cx + 24, 143), fill=(190, 150, 240))       # iris
        d.ellipse((cx - 9, 104 + i, cx + 1, 114 + i), fill=(255, 255, 255))  # highlight
        d.arc((cx - 40, 80, cx + 40, 150), 200, 340, fill=(40, 30, 60), width=5)  # lashes
    d.line((240, 170, 243, 186), fill=(236, 212, 220), width=2)             # nose, faint
    d.arc((205, 185, 275, 225), 20, 160, fill=(228, 178, 190), width=2)      # mouth
    frames.append(im)
frames[0].save(sys.argv[1], save_all=True, append_images=frames[1:], duration=80, loop=0)
`, join(dir, 'face.gif')]);

const clip = createClip(decodeGif(new Uint8Array(readFileSync(join(dir, 'face.gif')))));
const sx = 128 / 480;
const sy = 64 / 270;

function measure(r) {
  const f = r.bits.subarray(0, 1024);
  const dark = (x, y) => !((f[(y * W + x) >> 3] >> (7 - (x & 7))) & 1);
  // a feature counts as shown when each display column across it has a dark
  // pixel within one row of where the line lies
  const coverage = (pts) => {
    const cols = new Map();
    for (const [x, y] of pts) {
      const ox = Math.round(x * sx);
      const oy = Math.round(y * sy);
      const hit = [-1, 0, 1].some((d) => oy + d >= 0 && oy + d < 64 && dark(ox, oy + d));
      cols.set(ox, (cols.get(ox) || false) || hit);
    }
    return Math.round(([...cols.values()].filter(Boolean).length / cols.size) * 100);
  };
  const mouth = [];
  for (let a = 20; a <= 160; a += 2) {
    const t = (a * Math.PI) / 180;
    mouth.push([240 + 35 * Math.cos(t), 205 + 20 * Math.sin(t)]);
  }
  const nose = [];
  for (let t = 0; t <= 1; t += 0.1) nose.push([240 + 3 * t, 170 + 16 * t]);
  // plain skin that should stay lit: cheeks and forehead
  let clutter = 0;
  let skin = 0;
  for (const [x0, y0, x1, y1] of [[110, 160, 190, 200], [290, 160, 370, 200], [180, 20, 300, 70]]) {
    for (let y = Math.round(y0 * sy); y < Math.round(y1 * sy); y++) {
      for (let x = Math.round(x0 * sx); x < Math.round(x1 * sx); x++) { skin++; clutter += dark(x, y); }
    }
  }
  return { mouth: coverage(mouth), nose: coverage(nose), clutter: Math.round((clutter / skin) * 100) };
}

let failures = 0;
const base = { ...DEFAULT_SETTINGS, fit: 'stretch', autocrop: false };
for (const [name, s] of [['Fine detail off', { detail: 0 }], ['Fine detail 50 (default)', {}], ['Fine detail 100', { detail: 100 }]]) {
  const m = measure(processClip(clip, { ...base, ...s }));
  console.log(`${name.padEnd(26)} mouth ${String(m.mouth).padStart(3)}%   nose ${String(m.nose).padStart(3)}%   dark pixels on plain skin ${m.clutter}%`);
  if (name.includes('default') && (m.mouth < 80 || m.nose < 60 || m.clutter > 3)) {
    failures++;
    console.log('  FAIL');
  }
}
// Speedometers: white digits and ticks on a noisy dark background (like a
// real GIF), plus a thin grey arc. The arc must be restored; the digits must
// look the same as the plain conversion (restoring lines inside small text
// only distorts it), and the empty middle of the dial must stay empty.
const box = [20, 30, 460, 250];
const dx = 128 / (box[2] - box[0]);
const dy = 64 / (box[3] - box[1]);
for (const size of [32, 18]) {
  execFileSync(python, ['-c', `
import sys, math, random
from PIL import Image, ImageDraw, ImageFont
size = int(sys.argv[2]); random.seed(5)
try: font = ImageFont.truetype('arial.ttf', size)
except OSError: font = ImageFont.load_default(size)
frames = []
for f in range(2):
    im = Image.new("RGB", (480, 480), (18, 18, 18)); px = im.load()
    for _ in range(9000):  # dither and compression specks in the dark background
        v = random.choice([30, 40, 60, 90]); px[random.randrange(480), random.randrange(480)] = (v, v, v)
    d = ImageDraw.Draw(im)
    cx, cy, R = 240, 250, 215
    d.arc((cx - R, cy - R, cx + R, cy + R), 150, 390, fill=(95, 95, 95), width=2)
    for v in range(0, 281, 10):
        a = math.radians(210 - v * 240 / 280); major = v % 20 == 0
        r1, r2 = (R - 8, R - 34) if major else (R - 8, R - 22)
        d.line((cx + r1 * math.cos(a), cy - r1 * math.sin(a), cx + r2 * math.cos(a), cy - r2 * math.sin(a)), fill=(245, 245, 245), width=5 if major else 3)
        if major and v:
            t = str(v); rt = R - 40 - size; x, y = cx + rt * math.cos(a), cy - rt * math.sin(a)
            d.text((x - d.textlength(t, font=font) / 2, y - size / 2), t, fill=(240, 240, 240), font=font)
    frames.append(im)
frames[0].save(sys.argv[1], save_all=True, append_images=frames[1:], duration=40, loop=0)
`, join(dir, `dial${size}.gif`), String(size)]);

  const dial = createClip(decodeGif(new Uint8Array(readFileSync(join(dir, `dial${size}.gif`)))));
  const def = processClip(dial, { ...DEFAULT_SETTINGS, manualBox: box });
  const plain = processClip(dial, { ...DEFAULT_SETTINGS, manualBox: box, detail: 0, deblur: 0, specks: false, steady: false });
  const bit = (r, x, y) => (r.bits[(y * W + x) >> 3] >> (7 - (x & 7))) & 1;
  const srcR = (x, y) => Math.hypot(x / dx + box[0] - 240, y / dy + box[1] - 250);
  let arcHit = 0;
  let arcN = 0;
  for (let deg = 160; deg <= 380; deg += 2) {
    const a = (deg * Math.PI) / 180;
    const ox = Math.round((240 + 215 * Math.cos(a) - box[0]) * dx);
    const oy = Math.round((250 + 215 * Math.sin(a) - box[1]) * dy);
    if (ox < 1 || ox > 126 || oy < 1 || oy > 62) continue;
    arcN++;
    let hit = 0;
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) hit |= bit(def, ox + k, oy + j);
    arcHit += hit;
  }
  const inner = 215 - 40 - size * 2.2; // inside the ring of digits
  let same = 0;
  let text = 0;
  let stray = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 128; x++) {
      const r = srcR(x, y);
      if (r > inner && r < 190) { text++; same += bit(def, x, y) === bit(plain, x, y); }
      if (r < inner - 12) stray += bit(def, x, y);
    }
  }
  const arc = Math.round((arcHit / arcN) * 100);
  const digits = Math.round((same / text) * 100);
  console.log(`
Dial, ${size}px digits: arc drawn along ${arc}%, digits match the plain conversion on ${digits}%, stray pixels in the empty middle ${stray}`);
  if (arc < 85 || digits < 96 || stray > 2) {
    failures++;
    console.log('  FAIL');
  }
}

rmSync(dir, { recursive: true, force: true });
console.log(failures ? '\nFine detail check failed.' : '\nNose, mouth and the dial arc survive; digits are not distorted.');
process.exit(failures ? 1 : 0);
