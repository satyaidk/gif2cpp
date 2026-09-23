// Manual framing: the crop box, in source pixels, that gets scaled onto the
// 128x64 display. It may extend past the picture; those parts are black.

const MIN_W = 8;

export function roundBox([x0, y0, x1, y1]) {
  const rx0 = Math.round(x0);
  const ry0 = Math.round(y0);
  return [rx0, ry0, Math.max(rx0 + 2, Math.round(x1)), Math.max(ry0 + 1, Math.round(y1))];
}

export const boxSize = (b) => [b[2] - b[0], b[3] - b[1]];
export const boxCenter = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

export function moveBox(b, dx, dy) {
  return [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
}

/** factor < 1 zooms in (smaller box). (px, py): the point that stays put. */
export function zoomBox(b, factor, w, h, px, py) {
  const [bw, bh] = boxSize(b);
  const [cx, cy] = boxCenter(b);
  const ax = px ?? cx;
  const ay = py ?? cy;
  const maxW = Math.max(w, h * 2) * 8;
  const f = Math.min(Math.max(factor, MIN_W / bw), maxW / bw);
  return [ax + (b[0] - ax) * f, ay + (b[1] - ay) * f, ax + (b[2] - ax) * f, ay + (b[3] - ay) * f];
}

/**
 * Drags one corner to (px, py) while the opposite corner stays fixed.
 * corner: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
 * locked keeps the display's 2:1 shape.
 */
export function resizeBox(b, corner, px, py, locked) {
  const ax = corner === 0 || corner === 3 ? b[2] : b[0];
  const ay = corner === 0 || corner === 1 ? b[3] : b[1];
  const sx = corner === 0 || corner === 3 ? -1 : 1;
  const sy = corner === 0 || corner === 1 ? -1 : 1;
  let bw = Math.max(MIN_W, (px - ax) * sx);
  let bh = Math.max(MIN_W / 2, (py - ay) * sy);
  if (locked) {
    bw = Math.max(bw, bh * 2);
    bh = bw / 2;
  }
  const x0 = sx > 0 ? ax : ax - bw;
  const y0 = sy > 0 ? ay : ay - bh;
  return [x0, y0, x0 + bw, y0 + bh];
}

/** Whole width of the picture on screen, keeping the box's vertical centre. */
export function fitWidth(b, w, locked) {
  const [, cy] = boxCenter(b);
  const bh = locked ? w / 2 : b[3] - b[1];
  return [0, cy - bh / 2, w, cy + bh / 2];
}

/** Whole height of the picture on screen, keeping the box's horizontal centre. */
export function fitHeight(b, h, locked) {
  const [cx] = boxCenter(b);
  const bw = locked ? h * 2 : b[2] - b[0];
  return [cx - bw / 2, 0, cx + bw / 2, h];
}

export function centerBox(b, w, h) {
  const [bw, bh] = boxSize(b);
  return [(w - bw) / 2, (h - bh) / 2, (w + bw) / 2, (h + bh) / 2];
}
