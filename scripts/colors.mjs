// Checks that coloured shapes show up on the display. Run: npm run colors
// Needs Python 3 with Pillow on PATH as `python` (only to draw the test GIFs).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeGif } from '../src/lib/decode.js';
import { createClip, processClip } from '../src/lib/pipeline.js';
import { DEFAULT_SETTINGS, PYTHON_SETTINGS, W } from '../src/lib/mochi.js';

const dir = mkdtempSync(join(tmpdir(), 'mochi-colors-'));
const python = process.env.PYTHON || 'python';

// 256x128 so the whole frame maps 2:1 onto 128x64 (fit: stretch, no autocrop)
const DISCS = [
  ['red', [255, 0, 0], 40], ['blue', [0, 0, 255], 104], ['purple', [128, 0, 128], 168], ['dark green', [0, 110, 0], 222],
];
execFileSync(python, ['-c', `
import sys, json
from PIL import Image, ImageDraw, ImageFilter
d = sys.argv[1]; discs = json.loads(sys.argv[2])
def clip(name, bg, blur=0):
    frames = []
    for i in range(4):
        im = Image.new("RGB", (256, 128), tuple(bg)); dr = ImageDraw.Draw(im)
        for _, col, cx in discs: dr.ellipse((cx - 22, 42 + i, cx + 22, 86 + i), fill=tuple(col))
        if blur: im = im.filter(ImageFilter.GaussianBlur(blur))
        frames.append(im)
    frames[0].save(f"{d}/{name}.gif", save_all=True, append_images=frames[1:], duration=80, loop=0)
clip("on_black", [0, 0, 0]); clip("on_white", [255, 255, 255]); clip("blurred", [0, 0, 0], 7)
`, dir, JSON.stringify(DISCS)]);

const frame = { fit: 'stretch', autocrop: false };
const MODES = {
  'Python script (brightness)': { ...PYTHON_SETTINGS, autoThreshold: false, ...frame },
  'New default (all colours)': { ...frame },
};

/** Share of the pixels inside each disc (shrunk a little) that are lit, and lit pixels outside. */
function measure(r) {
  const f = r.bits.subarray(0, 1024);
  const lit = (x, y) => (f[(y * W + x) >> 3] >> (7 - (x & 7))) & 1;
  const res = {};
  let stray = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 128; x++) {
      const d = DISCS.find(([, , cx]) => (x - cx / 2) ** 2 + (y - 32) ** 2 <= 9 ** 2);
      const far = DISCS.every(([, , cx]) => (x - cx / 2) ** 2 + (y - 32) ** 2 > 14 ** 2);
      if (d) { res[d[0]] = res[d[0]] || [0, 0]; res[d[0]][0] += lit(x, y); res[d[0]][1]++; }
      else if (far) stray += lit(x, y);
    }
  }
  return { discs: Object.fromEntries(Object.entries(res).map(([k, [a, n]]) => [k, Math.round((a / n) * 100)])), stray };
}

let failures = 0;
for (const name of ['on_black', 'on_white', 'blurred']) {
  const clip = createClip(decodeGif(new Uint8Array(readFileSync(join(dir, `${name}.gif`)))));
  console.log(`\n${name}.gif`);
  for (const [mode, s] of Object.entries(MODES)) {
    const r = processClip(clip, { ...DEFAULT_SETTINGS, ...s });
    const m = measure(r);
    const cells = DISCS.map(([n]) => `${n} ${String(m.discs[n]).padStart(3)}%`).join('   ');
    console.log(`  ${mode.padEnd(28)} ${cells}   stray lit pixels ${m.stray}   threshold ${r.threshold}`);
    if (mode.startsWith('New')) {
      const bad = DISCS.filter(([n]) => m.discs[n] < 95).map(([n]) => n);
      if (bad.length || m.stray > 20) { failures++; console.log(`  FAIL  missing: ${bad.join(', ') || 'none'}, stray: ${m.stray}`); }
    }
  }
}
rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failure(s)` : '\nEvery colour shows up with the default settings.');
process.exit(failures ? 1 : 0);
