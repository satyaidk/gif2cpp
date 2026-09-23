// Extra steps that are not in gif2mochi.py: colour handling, contrast,
// sharpening, automatic threshold, dithering, outlines and cleanup.
//
// Why colour needs its own step: the script turns colour into brightness
// (0.30 R + 0.59 G + 0.11 B). On a black background pure red becomes 76 and
// pure blue 29, both under the default threshold of 110, so red and blue
// parts of a GIF vanish. "smart" colour instead measures how far each pixel
// is from the background colour, so every colour that stands out shows up.

import { FRAME_BYTES, H, W } from './mochi.js';

// ------------------------------------------------------------ background
/**
 * The clip's background colour: the most common colour along the frame
 * borders. Returns { color: [r, g, b], confident } where confident is false
 * when the border is too busy to call (then black is assumed).
 */
export function detectBackground(rgbFrames, w, h) {
  const bins = new Map();
  let total = 0;
  const step = Math.max(1, Math.floor(rgbFrames.length / 12));
  const ring = Math.max(1, Math.min(3, Math.floor(Math.min(w, h) / 20)));
  const add = (rgb, i) => {
    const q = i * 3;
    const key = ((rgb[q] >> 4) << 8) | ((rgb[q + 1] >> 4) << 4) | (rgb[q + 2] >> 4);
    let b = bins.get(key);
    if (!b) { b = [0, 0, 0, 0]; bins.set(key, b); }
    b[0]++; b[1] += rgb[q]; b[2] += rgb[q + 1]; b[3] += rgb[q + 2];
    total++;
  };
  for (let f = 0; f < rgbFrames.length; f += step) {
    const rgb = rgbFrames[f];
    for (let y = 0; y < h; y++) {
      const edgeRow = y < ring || y >= h - ring;
      for (let x = 0; x < w; x++) {
        if (edgeRow || x < ring || x >= w - ring) add(rgb, y * w + x);
      }
    }
  }
  let best = null;
  for (const b of bins.values()) if (!best || b[0] > best[0]) best = b;
  if (!best || best[0] / total < 0.3) return { color: [0, 0, 0], confident: false };
  return { color: [best[1] / best[0], best[2] / best[0], best[3] / best[0]].map(Math.round), confident: true };
}

/**
 * "How much does this pixel stand out" from the background colour: the
 * average of two measures.
 *  - the largest per-channel difference, so saturated colours such as red
 *    or blue count fully instead of being dimmed by the brightness formula;
 *  - the brightness difference, so light colours keep their shading (skin
 *    and a pink mouth line differ by 24 on the first measure alone, but by
 *    53 in brightness).
 * Grays give the same value on both, so black-and-white clips look the same.
 */
export function contrastGray(rgb, n, bg) {
  const out = new Uint8Array(n);
  const [br, bgc, bb] = bg;
  const bgLuma = (br * 19595 + bgc * 38470 + bb * 7471 + 0x8000) >> 16;
  for (let i = 0, q = 0; i < n; i++, q += 3) {
    const r = rgb[q];
    const g = rgb[q + 1];
    const b = rgb[q + 2];
    const dr = Math.abs(r - br);
    const dg = Math.abs(g - bgc);
    const db = Math.abs(b - bb);
    const cheb = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
    const dl = Math.abs(((r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16) - bgLuma);
    out[i] = (cheb + dl + 1) >> 1;
  }
  return out;
}

// ------------------------------------------------------------ fine detail
/** Separable max filter over a (2r+1) square, any image size. */
export function maxFilter(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = src[row + x];
      const a = x - r < 0 ? 0 : x - r;
      const b = x + r >= w ? w - 1 : x + r;
      for (let k = a; k <= b; k++) if (src[row + k] > v) v = src[row + k];
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const a = y - r < 0 ? 0 : y - r;
    const b = y + r >= h ? h - 1 : y + r;
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = a; k <= b; k++) if (tmp[k * w + x] > v) v = tmp[k * w + x];
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Keeps only pixels that belong to something line-shaped: within a
 * (2r+1) square around the pixel there must be at least 2r+1 marked
 * pixels, which a line crossing the square has but a speck of noise
 * (a few pixels) does not. Summed-area table, so any r costs the same.
 */
function keepElongated(map, w, h, r) {
  const sat = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      run += map[y * w + x] ? 1 : 0;
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + run;
    }
  }
  const need = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const y0 = y - r < 0 ? 0 : y - r;
    const y1 = y + r >= h ? h - 1 : y + r;
    for (let x = 0; x < w; x++) {
      if (!map[y * w + x]) continue;
      const x0 = x - r < 0 ? 0 : x - r;
      const x1 = x + r >= w ? w - 1 : x + r;
      const count = sat[(y1 + 1) * (w + 1) + x1 + 1] - sat[y0 * (w + 1) + x1 + 1]
        - sat[(y1 + 1) * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      if (count < need) map[y * w + x] = 0;
    }
  }
}

/**
 * Thin lines at full resolution, before the picture is shrunk to 128x64
 * (which would average them away). A pixel is on a dark line ("valley")
 * when the pixels on both sides of it, in some direction and within
 * `reach`, are brighter; a bright line ("peak") is the opposite. A plain
 * shape edge has one brighter and one darker side, and a smooth shading
 * gradient rises on one side only, so neither is mistaken for a line.
 * The strength (how much darker or brighter) is kept; poolLines() then
 * carries each line onto at least one display pixel.
 */
export function lineMaps(g, w, h, reach) {
  const n = w * h;
  const valley = new Uint8Array(n);
  const peak = new Uint8Array(n);
  const vDir = new Uint8Array(n); // direction across the line, for thinning
  const pDir = new Uint8Array(n);
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const STEP = DIRS.map(([dx, dy]) => dy * w + dx); // index offset per direction
  for (let y = 0; y < h; y++) {
    // pixels at least `reach` from every edge need no bounds checks
    const inner = y >= reach && y < h - reach;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = g[i];
      let v = 0;
      let pk = 0;
      let vd = 0;
      let pd = 0;
      if (inner && x >= reach && x < w - reach) {
        for (let k = 0; k < 4; k++) {
          const st = STEP[k];
          for (let d = 1, o = st; d <= reach; d++, o += st) {
            const a = g[i - o];
            const b = g[i + o];
            const lo = a < b ? a : b;
            const hi = a > b ? a : b;
            if (lo - p > v) { v = lo - p; vd = k; }
            if (p - hi > pk) { pk = p - hi; pd = k; }
          }
        }
      } else {
        for (let k = 0; k < 4; k++) {
          const [dx, dy] = DIRS[k];
          for (let d = 1; d <= reach; d++) {
            const x1 = x - dx * d;
            const y1 = y - dy * d;
            const x2 = x + dx * d;
            const y2 = y + dy * d;
            if (x1 < 0 || x2 < 0 || x1 >= w || x2 >= w || y1 < 0 || y2 < 0 || y1 >= h || y2 >= h) break;
            const a = g[y1 * w + x1];
            const b = g[y2 * w + x2];
            const lo = a < b ? a : b;
            const hi = a > b ? a : b;
            if (lo - p > v) { v = lo - p; vd = k; }
            if (p - hi > pk) { pk = p - hi; pd = k; }
          }
        }
      }
      // ignore faint ripples: grain and compression noise
      if (v > 6) { valley[i] = v; vDir[i] = vd; }
      if (pk > 6) { peak[i] = pk; pDir[i] = pd; }
    }
  }
  // Texture guard: dithering, halftone and grain are dense dark AND bright
  // specks side by side, while a real line has only one kind around it. So
  // each kind is weakened by the other kind nearby, and texture cancels out.
  const r = Math.max(1, Math.floor(reach / 3));
  const vNear = maxFilter(valley, w, h, r);
  const pNear = maxFilter(peak, w, h, r);
  for (let i = 0; i < n; i++) {
    const v = valley[i] - pNear[i];
    const p = peak[i] - vNear[i];
    valley[i] = v > 0 ? v : 0;
    peak[i] = p > 0 ? p : 0;
  }
  // Lines must be about 1.5 display pixels long; isolated specks are not lines.
  const lengthR = Math.max(1, Math.ceil(reach * 0.5));
  keepElongated(valley, w, h, lengthR);
  keepElongated(peak, w, h, lengthR);
  // Thin each line to its centre (non-maximum suppression across the line),
  // so a text stroke adds at most its middle pixel on the display and never
  // makes a digit bolder or fills its holes.
  const thin = (map, dirs) => {
    const out = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = map[i];
        if (!v) continue;
        const [dx, dy] = DIRS[dirs[i]];
        const xa = x - dx;
        const ya = y - dy;
        const xb = x + dx;
        const yb = y + dy;
        const before = xa >= 0 && ya >= 0 && xa < w && ya < h ? map[ya * w + xa] : 0;
        const after = xb >= 0 && yb >= 0 && xb < w && yb < h ? map[yb * w + xb] : 0;
        if (v > before && v >= after) out[i] = v;
      }
    }
    return out;
  };
  return { valley: thin(valley, vDir), peak: thin(peak, pDir) };
}

/**
 * Shrinks a line map onto the 128x64 display by taking the strongest value
 * under each display pixel (max pooling), so a line one source pixel wide
 * still lands on a display pixel instead of being averaged away. Parts of
 * the crop box outside the picture count as no line.
 */
export function poolLines(map, w, h, box) {
  const [bx0, by0, bx1, by1] = box;
  const sx = (bx1 - bx0) / W;
  const sy = (by1 - by0) / H;
  const out = new Uint8Array(W * H);
  const xs = new Int32Array(W + 1);
  for (let ox = 0; ox <= W; ox++) xs[ox] = Math.floor(bx0 + ox * sx);
  for (let oy = 0; oy < H; oy++) {
    const ya = Math.floor(by0 + oy * sy);
    const yb = Math.max(ya + 1, Math.floor(by0 + (oy + 1) * sy));
    for (let ox = 0; ox < W; ox++) {
      const xa = xs[ox];
      const xb = Math.max(xa + 1, xs[ox + 1]);
      let m = 0;
      for (let y = ya < 0 ? 0 : ya; y < yb && y < h; y++) {
        const row = y * w;
        for (let x = xa < 0 ? 0 : xa; x < xb && x < w; x++) if (map[row + x] > m) m = map[row + x];
      }
      out[oy * W + ox] = m;
    }
  }
  return out;
}

/**
 * Which detected lines to restore on a converted 1-bit frame, and how.
 * A line is restored only where it sits in a broad, plain area: a dark
 * line where at least 70% of the surrounding 5x5 pixels are lit (a mouth
 * on skin), a bright line where at most 30% are (a thin arc on a black
 * dial). In busy places such as small text, tick marks or texture the
 * normal conversion is the more faithful one, and carving holes or adding
 * strokes there would only distort the shapes.
 * Returns { strength, want }: the line strength per pixel (0 = none) and
 * the value to set there. In outline style every line is lit, and only
 * where the surroundings are mostly dark.
 */
export function lineCandidates(b, lines, style) {
  const { valley, peak } = lines;
  const n = W * H;
  const sat = new Uint16Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      run += b[y * W + x];
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + run;
    }
  }
  const strength = new Uint8Array(n);
  const want = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    const y0 = y - 2 < 0 ? 0 : y - 2;
    const y1 = y + 2 >= H ? H - 1 : y + 2;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = valley[i];
      const p = peak[i];
      if (!v && !p) continue;
      const x0 = x - 2 < 0 ? 0 : x - 2;
      const x1 = x + 2 >= W ? W - 1 : x + 2;
      const lit = sat[(y1 + 1) * (W + 1) + x1 + 1] - sat[y0 * (W + 1) + x1 + 1]
        - sat[(y1 + 1) * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
      const share = lit / ((x1 - x0 + 1) * (y1 - y0 + 1));
      if (style === 'outline') {
        if (share <= 0.3) { strength[i] = v > p ? v : p; want[i] = 1; }
      } else if (v > p && share >= 0.7) {
        strength[i] = v;
      } else if (p > v && share <= 0.3) {
        strength[i] = p;
        want[i] = 1;
      }
    }
  }
  return { strength, want };
}

/**
 * Applies lineCandidates() at or above `min`, one connected line at a time.
 * A line is drawn only if the normal conversion really lost it: when 40%
 * or more of its pixels are already shown (or touch pixels that are), it
 * is a stroke that is already there, such as part of a small digit, and
 * redrawing it would only make it bolder or change its shape. A line that
 * is truly missing (a faint arc on a dark dial, a mouth on skin) shows
 * almost nothing yet and is drawn whole. Fragments shorter than 3 display
 * pixels are skipped as noise. Returns the pixels it changed.
 */
export function drawLines(b, cand, min) {
  const set = new Uint8Array(b.length);
  if (!cand) return set;
  const { strength, want } = cand;
  const seen = new Uint8Array(b.length);
  const stack = [];
  const comp = [];
  for (let s = 0; s < b.length; s++) {
    if (seen[s] || strength[s] < min) continue;
    // collect one 8-connected line of candidates wanting the same value
    const wv = want[s];
    comp.length = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      const x = i % W;
      const y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W || (!dx && !dy)) continue;
          const j = yy * W + xx;
          if (!seen[j] && strength[j] >= min && want[j] === wv) { seen[j] = 1; stack.push(j); }
        }
      }
    }
    let shown = 0;
    for (const i of comp) {
      const x = i % W;
      if (b[i] === wv
        || (x > 0 && b[i - 1] === wv) || (x < W - 1 && b[i + 1] === wv)
        || (i >= W && b[i - W] === wv) || (i + W < b.length && b[i + W] === wv)) shown++;
    }
    // a lost line is at least 3 display pixels long; 1-2 pixel bits are noise
    if (comp.length < 3 || shown >= comp.length * 0.4) continue;
    for (const i of comp) {
      if (b[i] !== wv) { b[i] = wv; set[i] = 1; }
    }
  }
  return set;
}

/**
 * Safety net for busy clips: the line strength needed so that restored
 * lines cover at most `share` of the display, never below the user's minimum.
 */
export function capLineThreshold(candidates, min, share = 0.12) {
  const hist = new Uint32Array(256);
  let total = 0;
  for (const { strength } of candidates) {
    for (let i = 0; i < strength.length; i++) hist[strength[i]]++;
    total += strength.length;
  }
  let above = 0;
  for (let v = 255; v >= Math.max(1, min); v--) {
    above += hist[v];
    if (above > total * share) return Math.max(min, v + 1);
  }
  return min;
}

/** Averages k x k blocks: a quick shrink that keeps thin lines' contrast. */
export function shrinkBy(g, w, h, k) {
  const ow = Math.floor(w / k);
  const oh = Math.floor(h / k);
  const out = new Uint8Array(ow * oh);
  const area = k * k;
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      let s = 0;
      for (let y = oy * k; y < oy * k + k; y++) for (let x = ox * k, r = y * w; x < ox * k + k; x++) s += g[r + x];
      out[oy * ow + ox] = (s + (area >> 1)) / area;
    }
  }
  return { data: out, w: ow, h: oh };
}

/** Fine detail 1..100 -> smallest line strength that gets drawn. */
export const lineThreshold = (detail) => Math.round(28 - detail * 0.26);

// ------------------------------------------------------------ noise
/**
 * Detail-preserving noise removal at source resolution (a switching median).
 * A pixel is replaced by its 3x3 median only when it is an impulse: clearly
 * brighter (or darker) than the median, with at most one neighbour on its
 * side of the halfway point. Grain and stray specks have no such
 * neighbours. The pixels of a thin line or text stroke do, along the
 * stroke, even when it is anti-aliased, so they survive; a plain median
 * filter erases them.
 */
export function gentleDenoise(src, w, h) {
  const out = src.slice();
  const win = new Uint8Array(9);
  const sorted = new Uint8Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // fast path away from the edges: most pixels have no neighbour 40 or
      // more away, and then p cannot be 40 from the median either
      if (y > 0 && y < h - 1 && x > 0 && x < w - 1) {
        const i = y * w + x;
        const p = src[i];
        const lo = p - 40;
        const hi = p + 40;
        const u = i - w;
        const d = i + w;
        const a = src[u - 1]; const b = src[u]; const c = src[u + 1];
        const e = src[i - 1]; const f = src[i + 1];
        const g = src[d - 1]; const k2 = src[d]; const l = src[d + 1];
        if (a > lo && a < hi && b > lo && b < hi && c > lo && c < hi && e > lo && e < hi
          && f > lo && f < hi && g > lo && g < hi && k2 > lo && k2 < hi && l > lo && l < hi) continue;
      }
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
          win[k++] = src[yy * w + xx];
        }
      }
      const p = win[4];
      // fast path: no neighbour 40 or more away, so p cannot be 40 from the median
      let lo = 255;
      let hi = 0;
      for (let q = 0; q < 9; q++) { if (win[q] < lo) lo = win[q]; if (win[q] > hi) hi = win[q]; }
      if (hi - p < 40 && p - lo < 40) continue;
      sorted.set(win);
      sorted.sort();
      const med = sorted[4];
      if (Math.abs(p - med) < 40) continue;
      const mid = (p + med) / 2;
      let same = 0;
      for (let i = 0; i < 9; i++) {
        if (i !== 4 && (p > med ? win[i] > mid : win[i] < mid)) same++;
      }
      if (same <= 1) out[y * w + x] = med;
    }
  }
  return out;
}

// ------------------------------------------------------------ tone
/** Low/high cut points over the whole clip, or null if contrast is already fine. */
export function levelsRange(frames) {
  const hist = new Uint32Array(256);
  for (const f of frames) for (let i = 0; i < f.length; i++) hist[f[i]]++;
  const total = frames.length * W * H;
  const pick = (target) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  const lo = pick(total * 0.005);
  const hi = pick(total * 0.995);
  if (hi - lo < 24 || (lo < 4 && hi > 250)) return null;
  return [lo, hi];
}

export function applyLevels(f, [lo, hi]) {
  const out = new Uint8Array(f.length);
  const k = 255 / (hi - lo);
  for (let i = 0; i < f.length; i++) {
    const v = (f[i] - lo) * k;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/** Unsharp mask on a 128x64 frame. amount 0..100. */
export function sharpen(f, amount) {
  const k = (amount / 100) * 2.5;
  const out = new Uint8Array(f.length);
  const at = (x, y) => f[(y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const blur = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1)
        + 2 * at(x - 1, y) + 4 * at(x, y) + 2 * at(x + 1, y)
        + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) / 16;
      const v = f[y * W + x] + k * (f[y * W + x] - blur);
      out[y * W + x] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
  return out;
}

/** Edge strength (Sobel), scaled to 0..255. */
export function edges(f) {
  const out = new Uint8Array(f.length);
  const at = (x, y) => f[(y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
        - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
        - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const v = (Math.abs(gx) + Math.abs(gy)) / 4;
      out[y * W + x] = v > 255 ? 255 : v;
    }
  }
  return out;
}

/** Otsu's method over every frame of the clip; null when there is nothing to separate. */
export function otsu(frames) {
  const hist = new Float64Array(256);
  for (const f of frames) for (let i = 0; i < f.length; i++) hist[f[i]]++;
  let total = 0;
  let sum = 0;
  for (let v = 0; v < 256; v++) { total += hist[v]; sum += v * hist[v]; }
  let w0 = 0;
  let sum0 = 0;
  let best = -1;
  let t = null;
  for (let v = 0; v < 255; v++) {
    w0 += hist[v];
    if (!w0) continue;
    const w1 = total - w0;
    if (!w1) break;
    sum0 += v * hist[v];
    const m0 = sum0 / w0;
    const m1 = (sum - sum0) / w1;
    const between = w0 * w1 * (m0 - m1) ** 2;
    if (between > best) { best = between; t = v; }
  }
  return t;
}

// ------------------------------------------------------------ to 1 bit
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) * 4);

/** Sliding max (or min) over a (2r+1) square window, separable. */
function windowExtreme(f, r, isMax) {
  const tmp = new Uint8Array(f.length);
  const out = new Uint8Array(f.length);
  const pick = isMax ? (a, b) => (a > b ? a : b) : (a, b) => (a < b ? a : b);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = f[y * W + x];
      for (let d = 1; d <= r; d++) {
        if (x - d >= 0) v = pick(v, f[y * W + x - d]);
        if (x + d < W) v = pick(v, f[y * W + x + d]);
      }
      tmp[y * W + x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = tmp[y * W + x];
      for (let d = 1; d <= r; d++) {
        if (y - d >= 0) v = pick(v, tmp[(y - d) * W + x]);
        if (y + d < H) v = pick(v, tmp[(y + d) * W + x]);
      }
      out[y * W + x] = v;
    }
  }
  return out;
}

/**
 * Per-pixel thresholds for blurry clips (Bernsen's method). A blurred edge
 * lies where the picture is halfway between the shape and what surrounds
 * it, and that halfway point differs for a bright shape and a dim one, so
 * one global threshold makes bright shapes too fat and dim ones too thin.
 * Here each pixel is cut at the midpoint of its neighbourhood instead.
 * Flat areas (little local contrast) keep the global threshold, so noise
 * in dark or bright regions is not amplified.
 */
export function localThresholds(f, globalThr, radius) {
  const mx = windowExtreme(f, radius, true);
  const mn = windowExtreme(f, radius, false);
  const t = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) {
    t[i] = mx[i] - mn[i] >= 40 ? (mx[i] + mn[i]) >> 1 : globalThr;
  }
  return t;
}

/** Length of the run of equal pixels through each pixel, across rows and down columns. */
function runLengths(b) {
  const hr = new Uint8Array(b.length);
  const vr = new Uint8Array(b.length);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      let e = x;
      while (e + 1 < W && b[y * W + e + 1] === b[y * W + x]) e++;
      for (let k = x; k <= e; k++) hr[y * W + k] = Math.min(255, e - x + 1);
      x = e + 1;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      let e = y;
      while (e + 1 < H && b[(e + 1) * W + x] === b[y * W + x]) e++;
      for (let k = y; k <= e; k++) vr[k * W + x] = Math.min(255, e - y + 1);
      y = e + 1;
    }
  }
  return { hr, vr };
}

/**
 * Combines the global-threshold result g with the Fix blur result l.
 * Fix blur may reshape anything except structures at most 3 pixels wide in
 * g: a thin stroke (text, tick marks, a line) is never cut, and a thin
 * gap (the hole in a small 0, the space between two digits) is never
 * filled, because the midpoint rule distorts those. Wide shapes, soft
 * blurry edges and regions such as an iris inside skin are free to change.
 */
export function mergeLocal(g, l) {
  const { hr, vr } = runLengths(g);
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = hr[i] <= 3 || vr[i] <= 3 ? g[i] : l[i];
  return out;
}

/** Fix blur 1..100 -> neighbourhood radius in display pixels. */
export const blurRadius = (amount) => Math.max(1, Math.round((amount / 100) * 8));

/**
 * 1 = lit, one byte per pixel. local: per-pixel thresholds or null.
 * steady: { bits, gray } of the previous frame, or null. A pixel keeps its
 * previous state only while its brightness barely changed and stays near
 * the threshold, which stops noise from blinking; anything that really
 * moves (a needle sweeping over a digit) is thresholded afresh, so it
 * leaves no trail behind.
 */
export function toBinary(f, thr, style, steady = null, local = null) {
  const out = new Uint8Array(W * H);
  if (style === 'dither') {
    // ordered dither keeps the pattern still between frames, so no shimmer
    const bias = 127 - thr;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        out[i] = f[i] + bias > BAYER[(y & 7) * 8 + (x & 7)] ? 1 : 0;
      }
    }
    return out;
  }
  for (let i = 0; i < out.length; i++) {
    const t = local ? local[i] : thr;
    const v = f[i];
    if (steady && Math.abs(v - steady.gray[i]) <= 12 && Math.abs(v - t) <= 10) out[i] = steady.bits[i];
    else out[i] = v > t ? 1 : 0;
  }
  return out;
}

/**
 * Cleans specks, but only in plain areas. A lit pixel with no lit
 * neighbour (or a faint one, barely over the threshold, with one) is
 * removed only on a broadly dark area, and a dark pinhole is filled only
 * inside a broadly lit area (judged on the surrounding 5x5 pixels). Next to
 * small text or tick marks both are left alone: there a "pinhole" is the
 * hole inside a 0, 6 or 8 and a lone pixel is part of a digit.
 * f/thr: the gray frame and threshold the pixels were cut from (optional).
 */
export function removeSpecks(b, f = null, thr = 0, keep = null) {
  const out = b.slice();
  const sat = new Uint16Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      run += b[y * W + x];
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + run;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx || dy) && xx >= 0 && xx < W) n += b[yy * W + xx];
        }
      }
      const i = y * W + x;
      if (keep && keep[i]) continue; // a drawn fine line, e.g. a nostril dot
      const lone = b[i] && (n === 0 || (n === 1 && f && f[i] < thr + 48));
      const hole = !b[i] && n >= 7;
      if (!lone && !hole) continue;
      const x0 = x - 2 < 0 ? 0 : x - 2;
      const x1 = x + 2 >= W ? W - 1 : x + 2;
      const y0 = y - 2 < 0 ? 0 : y - 2;
      const y1 = y + 2 >= H ? H - 1 : y + 2;
      const lit = sat[(y1 + 1) * (W + 1) + x1 + 1] - sat[y0 * (W + 1) + x1 + 1]
        - sat[(y1 + 1) * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
      const share = lit / ((x1 - x0 + 1) * (y1 - y0 + 1));
      // a lone speck on dark ground (the speck itself plus at most one more)
      if (lone && share <= 0.12) out[i] = 0;
      // a pinhole in a lit area (only the hole itself and at most one more dark)
      else if (hole && share >= 0.88) out[i] = 1;
    }
  }
  return out;
}

export function packBinary(b) {
  const out = new Uint8Array(FRAME_BYTES);
  for (let i = 0; i < W * H; i++) if (b[i]) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}
