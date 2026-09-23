// convert() from the Python script plus the extra tools, split so each stage
// is cached:
//
//   colour -> gray        (per background + colour mode)
//   subject box           (per frame limit + gray)
//   noise removal         (per gray + noise setting)  <- the slow part
//   crop, resize          (per crop box, so dragging the frame stays quick)
//   invert, contrast, fix blur, threshold / dither / outline, specks
//                         (on 128x64 frames, rerun on every change)

import {
  FRAME_BYTES, H, MAX_BLOB, W, boxFor, crop, encode, flattenRgb, lumaOf, medianFilter, medianSize,
  resizeLanczos, roundtripOk, subjectBox, subsampleIndices,
} from './mochi.js';
import {
  applyLevels, blurRadius, capLineThreshold, contrastGray, detectBackground, drawLines, edges, gentleDenoise,
  levelsRange, lineCandidates, mergeLocal,
  lineMaps, lineThreshold, localThresholds, otsu, packBinary, poolLines, removeSpecks, sharpen, shrinkBy, toBinary,
} from './enhance.js';

export function createClip(decoded) {
  return {
    width: decoded.width,
    height: decoded.height,
    frames: decoded.frames, // [{ rgb, alpha, delay }]
    hasAlpha: decoded.frames.some((f) => f.alpha),
    rgb: new Map(), // transparency background -> flattened rgb frames
    bgColor: new Map(), // transparency background -> detected background colour
    gray: new Map(), // `${bg}|${colors}` -> gray frames
    subjects: new Map(), // `${maxFrames}|${bg}|${colors}` -> bright-area box or null
    denoised: null, // { key, frames } full-size gray after noise removal
    lines: null, // { key, frames: [{ valley, peak }] } full-size fine-detail maps
    prepared: null, // { key, frames: [Uint8Array(8192)] } cropped and resized
  };
}

const bgValue = (s) => (s.background === 'white' ? 255 : 0);

function rgbFrames(clip, bg) {
  if (!clip.rgb.has(bg)) clip.rgb.set(bg, clip.frames.map((f) => flattenRgb(f, bg)));
  return clip.rgb.get(bg);
}

function background(clip, bg) {
  if (!clip.bgColor.has(bg)) clip.bgColor.set(bg, detectBackground(rgbFrames(clip, bg), clip.width, clip.height));
  return clip.bgColor.get(bg);
}

function grayFrames(clip, bg, colors) {
  const key = `${bg}|${colors}`;
  if (!clip.gray.has(key)) {
    // keep one colour mode in memory at a time
    for (const k of clip.gray.keys()) if (k !== key) clip.gray.delete(k);
    const n = clip.width * clip.height;
    const rgb = rgbFrames(clip, bg);
    const frames = colors === 'luma'
      ? rgb.map((f) => lumaOf(f, n))
      : rgb.map((f) => contrastGray(f, n, background(clip, bg).color));
    clip.gray.set(key, frames);
  }
  return clip.gray.get(key);
}

/** Invert, contrast and sharpen: the gray each 128x64 frame is cut from. */
function tone(prepared, s) {
  let frames = s.invert ? prepared.map((f) => f.map((v) => 255 - v)) : prepared;
  if (s.levels) {
    const range = levelsRange(frames);
    if (range) frames = frames.map((f) => applyLevels(f, range));
  }
  // Fix blur: solid style uses per-pixel thresholds (see toBinary); dither
  // and outline work from the tones, so those get an unsharp mask instead
  if (s.deblur > 0 && s.style !== 'solid') frames = frames.map((f) => sharpen(f, s.deblur));
  if (s.style === 'outline') frames = frames.map(edges);
  return frames;
}

export function processClip(clip, settings, onProgress = () => {}) {
  const s = settings;
  const { width: w, height: h } = clip;
  const bg = bgValue(s);
  const colors = s.colors || 'luma';
  const gray = grayFrames(clip, bg, colors);
  const idx = subsampleIndices(gray.length, s.maxFrames);
  const frames = idx.map((i) => gray[i]);

  // finding the subject is slow, so it is cached apart from the fit mode
  const subjKey = `${s.maxFrames}|${bg}|${colors}`;
  const manualSet = Array.isArray(s.manualBox) && s.manualBox.length === 4;
  if (s.autocrop && !manualSet && !clip.subjects.has(subjKey)) {
    // the script looks for gray > 150; the contrast map is less bright, so look a bit lower
    clip.subjects.set(subjKey, subjectBox(frames, w, h, colors === 'luma' ? 150 : 100));
  }
  const subject = s.autocrop && !manualSet ? clip.subjects.get(subjKey) : null;
  const manual = manualSet;
  const box = manual ? s.manualBox : boxFor(subject, w, h, s.fit || 'fill', s.autocrop);

  // Noise removal works on the whole frame before cropping (as in the
  // script), so moving or zooming the frame only redoes crop + resize.
  const median = medianSize(s.denoise);
  const pre = s.denoise === 'gentle' ? gentleDenoise : null;
  const denKey = `${idx.length}|${s.maxFrames}|${bg}|${colors}|${s.denoise}`;
  if (!clip.denoised || clip.denoised.key !== denKey) {
    const out = [];
    for (let i = 0; i < frames.length; i++) {
      let g = median ? medianFilter(frames[i], w, h, median) : frames[i];
      if (pre) g = pre(g, w, h);
      out.push(g);
      if (i % 8 === 7) onProgress(i + 1, frames.length);
    }
    clip.denoised = { key: denKey, frames: out };
    clip.prepared = null;
  }

  // Fine detail: find thin lines at full size, before the shrink would
  // average them away. Only the zoom level changes these, so moving the
  // frame reuses them.
  // For big pictures the search runs on a copy shrunk to about twice the
  // display's resolution: a line thinner than one display pixel is still
  // at least half as strong there, and the search is several times faster.
  const detail = s.detail || 0;
  const scale = Math.max((box[2] - box[0]) / W, (box[3] - box[1]) / H);
  const down = Math.max(1, Math.round(scale / 2)); // whole-number block size, about 2x display resolution
  const reach = Math.max(1, Math.round((scale / down) * 1.5));
  if (detail > 0) {
    const lineKey = `${denKey}|${down}|${reach}`;
    if (!clip.lines || clip.lines.key !== lineKey) {
      const frames = clip.denoised.frames.map((g) => {
        const sm = down > 1 ? shrinkBy(g, w, h, down) : { data: g, w, h };
        return { ...lineMaps(sm.data, sm.w, sm.h, reach), w: sm.w, h: sm.h };
      });
      clip.lines = { key: lineKey, w: frames[0].w, h: frames[0].h, down, frames };
    }
  }

  const shrink = (g) => {
    const c = crop(g, w, h, box);
    return resizeLanczos(c.data, c.w, c.h, W, H);
  };
  const prepKey = `${denKey}|${box.join(',')}|${detail > 0 ? clip.lines.key : ''}`;
  if (!clip.prepared || clip.prepared.key !== prepKey) {
    clip.prepared = {
      key: prepKey,
      frames: clip.denoised.frames.map(shrink),
      lines: detail > 0
        ? clip.lines.frames.map((m) => {
          const lbox = box.map((v) => v / clip.lines.down);
          return { valley: poolLines(m.valley, clip.lines.w, clip.lines.h, lbox), peak: poolLines(m.peak, clip.lines.w, clip.lines.h, lbox) };
        })
        : null,
    };
  }

  const toned = tone(clip.prepared.frames, s);
  let threshold = s.threshold;
  if (s.autoThreshold) {
    const t = s.style === 'dither' ? 127 : otsu(toned);
    threshold = t === null ? s.threshold : t;
  }

  const packed = [];
  let prev = null;
  const radius = s.deblur > 0 && s.style === 'solid' ? blurRadius(s.deblur) : 0;

  // pass 1: the normal conversion, and where it lost fine lines
  const useSteady = s.steady && s.style !== 'dither';
  const base = toned.map((f) => {
    let b = toBinary(f, threshold, s.style, prev);
    if (radius) b = mergeLocal(b, toBinary(f, threshold, s.style, prev, localThresholds(f, threshold, radius)));
    prev = useSteady ? { bits: b, gray: f } : null;
    return b;
  });
  const cands = clip.prepared.lines
    ? base.map((b, k) => {
      const m = clip.prepared.lines[k];
      // inverting swaps which lines are dark and which are bright
      return lineCandidates(b, s.invert ? { valley: m.peak, peak: m.valley } : m, s.style);
    })
    : null;
  const lineMin = cands ? capLineThreshold(cands, lineThreshold(detail)) : 0;

  // pass 2: restore those lines, clean up, pack
  base.forEach((b0, k) => {
    let b = b0.slice();
    const drawn = drawLines(b, cands?.[k], lineMin);
    if (s.specks && s.style !== 'dither') b = removeSpecks(b, s.style === 'solid' ? toned[k] : null, threshold, drawn);
    packed.push(packBinary(b));
  });
  const { blob, offsets } = encode(packed);

  const bits = new Uint8Array(packed.length * FRAME_BYTES);
  packed.forEach((p, i) => bits.set(p, i * FRAME_BYTES));

  let error = null;
  let suggestMaxFrames = null;
  if (blob.length > MAX_BLOB) {
    suggestMaxFrames = Math.floor(packed.length * MAX_BLOB / blob.length * 0.9);
    error = `${blob.length.toLocaleString()} compressed bytes is over the ${MAX_BLOB.toLocaleString()} byte limit of the uint16 offset table.`;
  } else if (!roundtripOk(blob, offsets, packed)) {
    error = 'Round-trip decode failed, so no header was produced.';
  }

  // delay of each kept frame, stretched to cover the frames that were skipped
  const delays = idx.map((src, k) => {
    const next = k + 1 < idx.length ? idx[k + 1] : clip.frames.length;
    let ms = 0;
    for (let j = src; j < next; j++) ms += clip.frames[j].delay;
    return ms;
  });

  return {
    nSrc: clip.frames.length,
    nFrames: packed.length,
    sourceIndex: idx,
    delays,
    box,
    manual,
    threshold,
    bgColor: colors === 'luma' ? null : background(clip, bg),
    lineMin: detail > 0 ? lineMin : null,
    bits,
    blob,
    offsets,
    rawBytes: packed.length * FRAME_BYTES,
    error,
    suggestMaxFrames,
  };
}

/** Colour source frame for the crop view (after transparency flattening). */
export function sourceFrame(clip, index, settings) {
  return rgbFrames(clip, bgValue(settings))[index];
}
