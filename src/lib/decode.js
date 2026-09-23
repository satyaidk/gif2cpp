// Turns uploaded files into full-size RGB frames.
//
// Pillow's GIF reader hands back fully composited frames (it applies each
// frame's disposal method), so we do the same with gifuct-js patches here.
// Animated PNG / WebP go through the browser's ImageDecoder, which already
// returns composited frames.

import { parseGIF, decompressFrames } from 'gifuct-js';
import { splitRgba } from './mochi.js';

const toFrame = (rgba, w, h, delay) => ({ ...splitRgba(rgba, w * h), delay });

/** Browsers treat GIF delays of 10 ms or less as 100 ms. */
const gifDelay = (ms) => (ms && ms > 10 ? ms : 100);

/** GIF bytes -> { width, height, frames: [{ rgb, alpha, delay }] } (pure, runs in Node too) */
export function decodeGif(buffer) {
  const gif = parseGIF(buffer);
  const raw = decompressFrames(gif, true);
  if (!raw.length) throw new Error('This GIF has no frames.');
  const w = gif.lsd.width;
  const h = gif.lsd.height;
  const canvas = new Uint8ClampedArray(w * h * 4);
  const frames = [];
  let prev = null;
  let saved = null;

  for (const f of raw) {
    // dispose of the previous frame before drawing this one
    if (prev) {
      if (prev.disposalType === 2) {
        const { left, top, width, height } = prev.dims;
        for (let y = Math.max(0, top); y < Math.min(h, top + height); y++) {
          for (let x = Math.max(0, left); x < Math.min(w, left + width); x++) {
            canvas.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 4);
          }
        }
      } else if (prev.disposalType === 3 && saved) {
        canvas.set(saved);
      }
    }
    saved = f.disposalType === 3 ? canvas.slice() : null;

    const { left, top, width, height } = f.dims;
    const patch = f.patch;
    for (let y = 0; y < height; y++) {
      const cy = top + y;
      if (cy < 0 || cy >= h) continue;
      for (let x = 0; x < width; x++) {
        const cx = left + x;
        if (cx < 0 || cx >= w) continue;
        const p = (y * width + x) * 4;
        if (patch[p + 3] === 0) continue; // transparent pixel keeps what is below
        const q = (cy * w + cx) * 4;
        canvas[q] = patch[p];
        canvas[q + 1] = patch[p + 1];
        canvas[q + 2] = patch[p + 2];
        canvas[q + 3] = 255;
      }
    }
    frames.push(toFrame(canvas, w, h, gifDelay(f.delay)));
    prev = f;
  }
  return { width: w, height: h, frames };
}

// ------------------------------------------------------------ browser-only
function mimeFor(name, type) {
  if (type) return type;
  const ext = name.toLowerCase().split('.').pop();
  return { png: 'image/png', apng: 'image/png', webp: 'image/webp', gif: 'image/gif',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp' }[ext] || '';
}

export const isGif = (file) => mimeFor(file.name, file.type) === 'image/gif';

function drawToRgba(source, w, h) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

async function decodeWithImageDecoder(file, type) {
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type });
  await decoder.tracks.ready;
  const count = decoder.tracks.selectedTrack.frameCount;
  const frames = [];
  let w = 0;
  let h = 0;
  for (let i = 0; i < count; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    if (i === 0) { w = image.displayWidth; h = image.displayHeight; }
    const ms = image.duration ? image.duration / 1000 : 100;
    frames.push(toFrame(drawToRgba(image, w, h), w, h, ms > 10 ? ms : 100));
    image.close();
  }
  decoder.close();
  return { width: w, height: h, frames };
}

async function decodeStill(file) {
  const bmp = await createImageBitmap(file);
  const w = bmp.width;
  const h = bmp.height;
  const frame = toFrame(drawToRgba(bmp, w, h), w, h, 100);
  bmp.close();
  return { width: w, height: h, frames: [frame] };
}

/** One animated file (GIF, APNG, animated WebP) or a single still. */
export async function decodeFile(file) {
  const type = mimeFor(file.name, file.type);
  if (type === 'image/gif') return { ...decodeGif(new Uint8Array(await file.arrayBuffer())), note: null };
  if (typeof ImageDecoder !== 'undefined' && (await ImageDecoder.isTypeSupported(type))) {
    return { ...(await decodeWithImageDecoder(file, type)), note: null };
  }
  const still = await decodeStill(file);
  return {
    ...still,
    note: 'This browser cannot read animated PNG/WebP, so only the first frame was used. Try Chrome or Edge.',
  };
}

/** A numbered sequence of stills, like pointing the script at a folder. */
export async function decodeSequence(files) {
  // Python sorts the full paths as plain strings
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const frames = [];
  let w = 0;
  let h = 0;
  for (const file of sorted) {
    const s = await decodeStill(file);
    if (!frames.length) { w = s.width; h = s.height; }
    if (s.width !== w || s.height !== h) {
      throw new Error(`${file.name} is ${s.width}x${s.height}; every frame must be ${w}x${h}.`);
    }
    frames.push(s.frames[0]);
  }
  return { width: w, height: h, frames, note: null };
}
