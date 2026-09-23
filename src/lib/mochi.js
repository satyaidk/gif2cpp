// Core of gif2mochi, ported from tools/gif2mochi.py.
//
// Every step reproduces what the Python/Pillow version does, so a GIF
// converted here produces the same anim_<sym>.h byte for byte:
//   grayscale (ITU-R 601-2, Pillow's fixed-point form; colors: 'luma')
//   -> 3x3 median (edges replicated, like ImageFilter.MedianFilter)
//   -> crop (areas outside the source read as black)
//   -> Lanczos resize to 128x64 (Pillow's Resample.c, 22-bit coefficients)
//   -> optional invert -> threshold -> 1 bpp pack, row-major, MSB first
//   -> XOR against the previous frame -> PackBits.
//
// With PYTHON_SETTINGS the output is identical to the script. The other
// settings add steps from enhance.js (colour handling, cleanup, dithering).
//
// Pure functions only (no DOM), so it runs in the worker and in Node.

export const W = 128;
export const H = 64;
export const FRAME_BYTES = (W * H) / 8; // 1024
export const MAX_BLOB = 65535; // the uint16 offset table cannot address more

export const DEFAULT_SETTINGS = Object.freeze({
  threshold: 110,
  autoThreshold: true, // pick the threshold per clip (Otsu)
  invert: false,
  maxFrames: 0,
  autocrop: true,
  fit: 'fill', // 'fill' | 'stretch' | 'python' (see cropBox)
  colors: 'smart', // 'smart': any colour that differs from the background shows; 'luma': brightness only
  style: 'solid', // 'solid' | 'dither' | 'outline'
  denoise: 'gentle', // 'off' | 'gentle' (keeps thin lines) | 'light' (3x3 median, the script) | 'strong' (5x5)
  levels: true, // stretch contrast across the clip
  deblur: 50, // 0..100, fix blurry edges (see enhance.js localThresholds)
  detail: 50, // 0..100, keep thin lines that shrinking would erase (see enhance.js lineMaps)
  specks: true, // remove lone pixels and fill pinholes
  steady: true, // hysteresis between frames against flicker
  background: 'black', // what transparent pixels become (no CLI equivalent)
  manualBox: null, // [x0, y0, x1, y1] in source pixels when framed by hand, else null
});

/** Exactly what gif2mochi.py does. Threshold, invert, frame limit and crop stay as they are. */
export const PYTHON_SETTINGS = Object.freeze({
  colors: 'luma', fit: 'python', style: 'solid', levels: false, deblur: 0, detail: 0, specks: false, steady: false,
  manualBox: null,
});

/** True when gif2mochi.py can produce the same output from these settings. */
export function pythonCompatible(s, hasAlpha) {
  return s.colors === 'luma' && s.fit === 'python' && s.style === 'solid' && !s.levels && !s.deblur && !s.detail
    && !s.specks && !s.steady && (s.denoise === 'light' || s.denoise === 'off') && !s.manualBox
    && !(hasAlpha && s.background === 'white');
}

/** Median size for a denoise setting; 0 for none or for the gentle filter. */
export const medianSize = (denoise) => (denoise === 'strong' ? 5 : denoise === 'light' || denoise === true ? 3 : 0);

// =============================================================== colour
/** RGBA -> { rgb, alpha }; alpha is null when every pixel is opaque. */
export function splitRgba(rgba, n) {
  const rgb = new Uint8Array(n * 3);
  let alpha = null;
  for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
    rgb[q] = rgba[p];
    rgb[q + 1] = rgba[p + 1];
    rgb[q + 2] = rgba[p + 2];
    if (rgba[p + 3] !== 255) {
      if (!alpha) alpha = new Uint8Array(n).fill(255);
      alpha[i] = rgba[p + 3];
    }
  }
  return { rgb, alpha };
}

/** Transparent pixels onto a solid gray level (0 or 255). */
export function flattenRgb(frame, bg) {
  if (!frame.alpha) return frame.rgb;
  const { rgb, alpha } = frame;
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    for (let c = 0; c < 3; c++) {
      const v = rgb[i * 3 + c];
      out[i * 3 + c] = a === 255 ? v : Math.round((v * a + bg * (255 - a)) / 255);
    }
  }
  return out;
}

/** RGB -> luminance exactly as Pillow's convert("L") (ITU-R 601-2, L24 macro). */
export function lumaOf(rgb, n) {
  const out = new Uint8Array(n);
  for (let i = 0, q = 0; i < n; i++, q += 3) {
    out[i] = (rgb[q] * 19595 + rgb[q + 1] * 38470 + rgb[q + 2] * 7471 + 0x8000) >> 16;
  }
  return out;
}

// =============================================================== filters
/**
 * Rank filter with replicated edges, same result as Pillow's
 * MedianFilter(size). Uses a sliding histogram (Huang) so large source
 * frames stay fast.
 */
export function medianFilter(src, w, h, size) {
  const rank = (size * size) >> 1;
  const m = size >> 1;
  const out = new Uint8Array(w * h);
  const hist = new Int32Array(256);
  const rows = new Int32Array(size);
  const clampX = (x) => (x < 0 ? 0 : x >= w ? w - 1 : x);

  for (let y = 0; y < h; y++) {
    for (let d = -m; d <= m; d++) {
      const yy = y + d < 0 ? 0 : y + d >= h ? h - 1 : y + d;
      rows[d + m] = yy * w;
    }
    hist.fill(0);
    for (let d = -m; d <= m; d++) {
      const cx = clampX(d);
      for (let r = 0; r < size; r++) hist[src[rows[r] + cx]]++;
    }
    let med = 0;
    let lt = 0; // number of window values below med
    while (lt + hist[med] <= rank) lt += hist[med++];
    out[y * w] = med;

    for (let x = 1; x < w; x++) {
      const ox = clampX(x - m - 1);
      const ix = clampX(x + m);
      for (let r = 0; r < size; r++) {
        const vo = src[rows[r] + ox];
        hist[vo]--;
        if (vo < med) lt--;
        const vi = src[rows[r] + ix];
        hist[vi]++;
        if (vi < med) lt++;
      }
      while (lt > rank) lt -= hist[--med];
      while (lt + hist[med] <= rank) lt += hist[med++];
      out[y * w + x] = med;
    }
  }
  return out;
}

/** Pillow crop: the box may extend past the image, those pixels are 0. */
export function crop(src, w, h, box) {
  const [x0, y0, x1, y1] = box;
  const cw = x1 - x0;
  const ch = y1 - y0;
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const sy = y + y0;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < cw; x++) {
      const sx = x + x0;
      if (sx >= 0 && sx < w) out[y * cw + x] = src[sy * w + sx];
    }
  }
  return { data: out, w: cw, h: ch };
}

// =============================================================== Lanczos
const PRECISION_BITS = 32 - 8 - 2;
const ONE = 1 << PRECISION_BITS;
const HALF = 1 << (PRECISION_BITS - 1);

function sinc(x) {
  if (x === 0) return 1;
  x *= Math.PI;
  return Math.sin(x) / x;
}
function lanczos(x) {
  return x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0;
}

/** precompute_coeffs() + normalize_coeffs_8bpc() from Pillow's Resample.c */
function coeffs(inSize, outSize) {
  const scale = inSize / outSize;
  const filterscale = scale < 1 ? 1 : scale;
  const support = 3 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const kk = new Int32Array(outSize * ksize);
  const tmp = new Float64Array(ksize);
  const inv = 1.0 / filterscale;

  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const v = lanczos((x + xmin - center + 0.5) * inv);
      tmp[x] = v;
      ww += v;
    }
    for (let x = 0; x < xmax; x++) {
      const v = ww !== 0 ? tmp[x] / ww : tmp[x];
      kk[xx * ksize + x] = v < 0 ? Math.trunc(-0.5 + v * ONE) : Math.trunc(0.5 + v * ONE);
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { ksize, bounds, kk };
}

function clip8(ss) {
  const v = Math.floor(ss / ONE);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function resampleH(src, sw, sh, dw) {
  const { ksize, bounds, kk } = coeffs(sw, dw);
  const out = new Uint8Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let xx = 0; xx < dw; xx++) {
      const xmin = bounds[xx * 2];
      const xmax = bounds[xx * 2 + 1];
      const k = xx * ksize;
      let ss = HALF;
      for (let x = 0; x < xmax; x++) ss += src[row + xmin + x] * kk[k + x];
      out[y * dw + xx] = clip8(ss);
    }
  }
  return out;
}

function resampleV(src, sw, sh, dh) {
  const { ksize, bounds, kk } = coeffs(sh, dh);
  const out = new Uint8Array(sw * dh);
  for (let yy = 0; yy < dh; yy++) {
    const ymin = bounds[yy * 2];
    const ymax = bounds[yy * 2 + 1];
    const k = yy * ksize;
    for (let x = 0; x < sw; x++) {
      let ss = HALF;
      for (let y = 0; y < ymax; y++) ss += src[(ymin + y) * sw + x] * kk[k + y];
      out[yy * sw + x] = clip8(ss);
    }
  }
  return out;
}

/** Image.resize((dw, dh), Image.LANCZOS) for an 8-bit single-band image. */
export function resizeLanczos(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src.slice();
  const needH = sw !== dw;
  const needV = sh !== dh;
  // Pillow runs the vertical pass first when height shrinks much more
  const horizontalFirst = !(sh - dh > 0 && sh - dh > (sw - dw) * 2);
  let img = src;
  let w = sw;
  let h = sh;
  if (horizontalFirst) {
    if (needH) { img = resampleH(img, w, h, dw); w = dw; }
    if (needV) { img = resampleV(img, w, h, dh); h = dh; }
  } else {
    if (needV) { img = resampleV(img, w, h, dh); h = dh; }
    if (needH) { img = resampleH(img, w, h, dw); w = dw; }
  }
  return img;
}

// =============================================================== pipeline
export function subsampleIndices(n, limit) {
  if (!limit || n <= limit) return Array.from({ length: n }, (_, i) => i);
  const step = n / limit;
  return Array.from({ length: limit }, (_, i) => Math.floor(i * step));
}

/** Union of the bright area (median-5 > thr) over every 3rd frame, or null. */
export function subjectBox(frames, w, h, thr = 150) {
  let box = null;
  for (let i = 0; i < frames.length; i += 3) {
    const f = medianFilter(frames[i], w, h, 5);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (f[row + x] > thr) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) continue;
    const b = [x0, y0, x1 + 1, y1 + 1];
    box = box === null ? b : [
      Math.min(box[0], b[0]), Math.min(box[1], b[1]),
      Math.max(box[2], b[2]), Math.max(box[3], b[3]),
    ];
  }
  return box;
}

/** content_box() from the script: subject padded, then grown to 2:1 (may leave black bars). */
export function paddedBox(subject, w, h) {
  const box = subject || [0, 0, w, h];
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  let bw = (box[2] - box[0]) * 1.10;
  let bh = (box[3] - box[1]) * 1.18;
  if (bw / bh < 2.0) bw = bh * 2.0;
  else bh = bw / 2.0;
  // Python's int() truncates toward zero
  return [
    Math.trunc(cx - bw / 2), Math.trunc(cy - bh / 2),
    Math.trunc(cx + bw / 2), Math.trunc(cy + bh / 2),
  ];
}

export function contentBox(frames, w, h, thr = 150) {
  return paddedBox(subjectBox(frames, w, h, thr), w, h);
}

/**
 * A 2:1 box that always lies inside the source, so the screen is filled
 * with picture and never with black bars. It covers the subject when it
 * can; if the subject is wider or taller than 2:1 allows, the edges that
 * do not fit are cut off.
 */
export function fillBox(subject, w, h) {
  const box = subject || [0, 0, w, h];
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  let bw = Math.max(1, (box[2] - box[0]) * 1.06);
  let bh = Math.max(1, (box[3] - box[1]) * 1.06);
  if (bw / bh < 2) bw = bh * 2;
  else bh = bw / 2;
  const shrink = Math.min(1, w / bw, h / bh);
  bw = Math.max(1, Math.round(bw * shrink));
  bh = Math.max(1, Math.round(bh * shrink));
  const x0 = Math.round(Math.min(Math.max(cx - bw / 2, 0), w - bw));
  const y0 = Math.round(Math.min(Math.max(cy - bh / 2, 0), h - bh));
  return [x0, y0, x0 + bw, y0 + bh];
}

/** The subject (lightly padded) or the whole frame, any aspect: gets stretched to 2:1. */
export function stretchBox(subject, w, h) {
  if (!subject) return [0, 0, w, h];
  const [x0, y0, x1, y1] = subject;
  const px = Math.round((x1 - x0) * 0.03);
  const py = Math.round((y1 - y0) * 0.03);
  return [Math.max(0, x0 - px), Math.max(0, y0 - py), Math.min(w, x1 + px), Math.min(h, y1 + py)];
}

/**
 * The crop box for a clip.
 *   fill    - no black bars; crops what does not fit (default)
 *   stretch - whole subject, distorted to 2:1
 *   python  - exactly what gif2mochi.py does (padded box, black bars)
 */
export function boxFor(subject, w, h, fit, autocrop) {
  const s = autocrop ? subject : null;
  if (fit === 'python') return autocrop ? paddedBox(s, w, h) : [0, 0, w, h];
  return fit === 'stretch' ? stretchBox(s, w, h) : fillBox(s, w, h);
}

export function cropBox(frames, w, h, fit, autocrop) {
  return boxFor(autocrop ? subjectBox(frames, w, h) : null, w, h, fit, autocrop);
}

/** Everything in to_bits() before the threshold: gray 128x64 bytes. */
export function prepareFrame(gray, w, h, box, median, pre = null) {
  let g = median ? medianFilter(gray, w, h, median) : gray;
  if (pre) g = pre(g, w, h);
  const c = crop(g, w, h, box);
  return resizeLanczos(c.data, c.w, c.h, W, H);
}

/** Threshold + pack() in one pass: 1024 bytes, row-major, MSB first. */
export function packFrame(small, thr, invert) {
  const out = new Uint8Array(FRAME_BYTES);
  for (let i = 0; i < W * H; i++) {
    const p = invert ? 255 - small[i] : small[i];
    if (p > thr) out[i >> 3] |= 0x80 >> (i & 7);
  }
  return out;
}

// =============================================================== PackBits
export function packbits(data) {
  const out = [];
  const n = data.length;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run < n && data[i + run] === data[i] && run < 128) run++;
    if (run >= 2) {
      out.push(256 - (run - 1), data[i]);
      i += run;
    } else {
      let j = i + 1;
      let lit = 1;
      while (j < n && lit < 128) {
        if (j + 1 < n && data[j] === data[j + 1]) break;
        j++;
        lit++;
      }
      out.push(lit - 1);
      for (let k = i; k < i + lit; k++) out.push(data[k]);
      i = j;
    }
  }
  return out;
}

export function unpackbits(c, start, end, size) {
  const out = new Uint8Array(size);
  let o = 0;
  let i = start;
  while (o < size && i < end) {
    const t = c[i++];
    if (t < 128) {
      for (let k = 0; k <= t && o < size && i < end; k++) out[o++] = c[i++];
      // Python slices past the end silently; keep reading position in step
    } else {
      const v = c[i++];
      for (let k = 0; k < 257 - t && o < size; k++) out[o++] = v;
    }
  }
  return { data: out, length: o };
}

// =============================================================== encoding
/** packed: array of 1024-byte frames -> { blob, offsets } */
export function encode(packed) {
  let prev = new Uint8Array(FRAME_BYTES);
  const bytes = [];
  const offsets = [];
  const delta = new Uint8Array(FRAME_BYTES);
  for (const cur of packed) {
    offsets.push(bytes.length);
    for (let i = 0; i < FRAME_BYTES; i++) delta[i] = cur[i] ^ prev[i];
    const c = packbits(delta);
    for (let i = 0; i < c.length; i++) bytes.push(c[i]);
    prev = cur;
  }
  offsets.push(bytes.length);
  return { blob: Uint8Array.from(bytes), offsets };
}

/** Decodes a whole clip back to 1024-byte frames; null if it is malformed. */
export function decodeAll(blob, offsets, nframes) {
  const out = new Uint8Array(nframes * FRAME_BYTES);
  const acc = new Uint8Array(FRAME_BYTES);
  for (let f = 0; f < nframes; f++) {
    const d = unpackbits(blob, offsets[f], offsets[f + 1], FRAME_BYTES);
    if (d.length !== FRAME_BYTES) return null;
    for (let i = 0; i < FRAME_BYTES; i++) acc[i] ^= d.data[i];
    out.set(acc, f * FRAME_BYTES);
  }
  return out;
}

/** Mirrors roundtrip_ok(), and additionally checks every frame matches. */
export function roundtripOk(blob, offsets, packed) {
  const all = decodeAll(blob, offsets, packed.length);
  if (!all) return false;
  for (let f = 0; f < packed.length; f++) {
    const base = f * FRAME_BYTES;
    for (let i = 0; i < FRAME_BYTES; i++) if (all[base + i] !== packed[f][i]) return false;
  }
  return true;
}

// =============================================================== naming
const C_KEYWORDS = new Set(('auto break case char const continue default do double else enum ' +
  'extern float for goto if inline int long register restrict return short signed sizeof ' +
  'static struct switch typedef union unsigned void volatile while bool true false class ' +
  'new delete this template typename namespace public private protected virtual operator ' +
  'friend using try catch throw').split(' '));

/** slug() from the Python script. */
export function slug(name) {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  let s = base.toLowerCase().replace(/[^0-9a-z]+/g, '');
  if (!s) s = 'anim';
  if (/^[0-9]/.test(s)) s = 'a' + s;
  return s;
}

/** Python's str.capitalize(): first letter upper, the rest lower. */
export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** Returns an error message, or null when sym is a usable C identifier. */
export function symbolError(sym) {
  if (!sym) return 'Enter a name.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sym)) {
    return 'Use letters, digits and _ only, not starting with a digit.';
  }
  if (C_KEYWORDS.has(sym)) return `"${sym}" is a C/C++ keyword.`;
  // #define ANIM_COUNT <index> would silently replace the ANIM_COUNT constant
  if (sym.toUpperCase() === 'COUNT') return '"count" would clash with ANIM_COUNT in animations.h.';
  return null;
}

/** Characters that would break the C string literal are dropped. */
export function cleanLabel(label) {
  return (label || '').replace(/["\\\r\n]/g, '');
}

/** The label that actually goes into the files: (label or sym.capitalize())[:11] */
export function effectiveLabel(sym, label) {
  return (cleanLabel(label) || capitalize(sym)).slice(0, 11);
}

// =============================================================== file writers
/** write_header() */
export function headerText(sym, label, blob, offsets, nframes) {
  const lines = [];
  lines.push(`// ${label} - ${nframes} frames, ${W}x${H}, XOR-delta + PackBits\n`);
  lines.push('#pragma once\n#include <Arduino.h>\n\n');
  lines.push(`#define ${sym.toUpperCase()}_FRAMES ${nframes}\n\n`);
  lines.push(`const uint16_t ${sym}_offsets[${offsets.length}] PROGMEM = {\n`);
  const offRows = [];
  for (let i = 0; i < offsets.length; i += 16) {
    offRows.push('  ' + offsets.slice(i, i + 16).join(', '));
  }
  lines.push(offRows.join(',\n'));
  lines.push('\n};\n\n');
  const hexRows = [];
  for (let i = 0; i < blob.length; i += 16) {
    const row = [];
    for (let k = i; k < Math.min(i + 16, blob.length); k++) {
      row.push('0x' + blob[k].toString(16).padStart(2, '0'));
    }
    hexRows.push('  ' + row.join(', '));
  }
  lines.push(`const uint8_t ${sym}_data[${blob.length}] PROGMEM = {\n${hexRows.join(',\n')}\n};\n`);
  return lines.join('');
}

const REGISTRY_TOP = `// Auto-generated index of all Mochi animations.
// Each frame is XOR-delta encoded against the previous frame, then PackBits
// compressed. Maintained by tools/gif2mochi.py.
#pragma once
#include <Arduino.h>

`;

/** write_registry(): rows = [{ sym, label }] in ANIMS order. */
export function registryText(rows) {
  const out = [REGISTRY_TOP];
  for (const { sym } of rows) out.push(`#include "anim_${sym}.h"\n`);
  out.push(`
struct Anim {
  const char*     name;
  const uint8_t*  data;
  const uint16_t* offsets;
  uint16_t        frames;
};

const Anim ANIMS[] = {
`);
  for (const { sym, label } of rows) {
    out.push(`  { "${label.padEnd(11)}", ${sym}_data, ${sym}_offsets, ${sym.toUpperCase()}_FRAMES },\n`);
  }
  out.push('};\n\nconst uint8_t ANIM_COUNT = sizeof(ANIMS) / sizeof(ANIMS[0]);\n\n');
  out.push('// Index of each animation, in the order listed above\n');
  rows.forEach(({ sym }, i) => out.push(`#define ANIM_${sym.toUpperCase().padEnd(12)} ${i}\n`));
  return out.join('');
}

// =============================================================== file readers
const ROW_RE = /\{\s*"([^"]*)"\s*,\s*(\w+)_data\s*,\s*\2_offsets\s*,\s*\w+_FRAMES\s*\}/g;

/** read_registry(): [{ sym, label }] */
export function parseRegistry(text) {
  return [...text.matchAll(ROW_RE)].map((m) => ({ sym: m[2], label: m[1].trim() }));
}

function parseNumbers(body) {
  return body.split(',').map((s) => s.trim()).filter(Boolean).map((s) => Number(s));
}

/** Reads an existing anim_<sym>.h back into blob + offsets. */
export function parseHeader(text) {
  const data = text.match(/const\s+uint8_t\s+(\w+)_data\s*\[\s*(\d+)\s*\]\s*PROGMEM\s*=\s*\{([^}]*)\}/);
  const offs = text.match(/const\s+uint16_t\s+(\w+)_offsets\s*\[\s*(\d+)\s*\]\s*PROGMEM\s*=\s*\{([^}]*)\}/);
  if (!data || !offs) throw new Error('no _data / _offsets arrays found');
  const sym = data[1];
  const blob = Uint8Array.from(parseNumbers(data[3]));
  const offsets = parseNumbers(offs[3]);
  if (blob.length !== Number(data[2])) throw new Error('data array length does not match its size');
  if (blob.some((b) => Number.isNaN(b)) || offsets.some((o) => Number.isNaN(o))) {
    throw new Error('could not read the array values');
  }
  const nMatch = text.match(/_FRAMES\s+(\d+)/);
  const nframes = nMatch ? Number(nMatch[1]) : offsets.length - 1;
  const lMatch = text.match(/^\/\/\s*(.*?)\s+-\s+\d+\s+frames/m);
  const bits = decodeAll(blob, offsets, nframes);
  if (!bits) throw new Error('frames do not decode cleanly');
  return { sym, label: lMatch ? lMatch[1] : capitalize(sym), blob, offsets, nframes, bits };
}

// =============================================================== reporting
/** Same numbers as `gif2mochi.py --budget`. */
export function budget(entries) {
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  const totalFrames = entries.reduce((s, e) => s + e.frames, 0);
  const framesKB = totalBytes / 1024;
  const freeKB = 1310 - framesKB - 290;
  return { totalBytes, totalFrames, framesKB, sketchKB: 290, partitionKB: 1310, freeKB, tight: freeKB <= 100 };
}

/** The command that reproduces these settings with the original script. */
export function cliCommand(fileName, sym, label, s) {
  const q = (v) => (/[\s"']/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v);
  const parts = ['python3 gif2mochi.py', q(fileName), sym, q(label)];
  if (s.threshold !== 110) parts.push(`--threshold ${s.threshold}`);
  if (s.invert) parts.push('--invert');
  if (s.maxFrames) parts.push(`--max-frames ${s.maxFrames}`);
  if (!s.autocrop) parts.push('--no-autocrop');  // the script only frames like fit 'python'
  if (medianSize(s.denoise) === 0) parts.push('--no-denoise');
  return parts.join(' ');
}
