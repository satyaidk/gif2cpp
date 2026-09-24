import { useEffect, useRef, useState } from 'react';
import { FRAME_BYTES, H, W } from '../lib/mochi.js';

export const PANELS = {
  white: { name: 'White', top: [236, 246, 255], bottom: [236, 246, 255] },
  blue: { name: 'Blue', top: [96, 200, 255], bottom: [96, 200, 255] },
  duo: { name: 'Yellow + blue', top: [255, 212, 64], bottom: [96, 200, 255] },
};
const OFF = [10, 14, 18];

/** Draws one 1024-byte frame the way the display will show it. */
export function drawBits(canvas, bits, frame, panel = 'white') {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const base = frame * FRAME_BYTES;
  const { top, bottom } = PANELS[panel];
  for (let i = 0; i < W * H; i++) {
    const on = bits && bits[base + (i >> 3)] & (0x80 >> (i & 7));
    const c = on ? (i < W * 16 ? top : bottom) : OFF;
    const p = i * 4;
    d[p] = c[0];
    d[p + 1] = c[1];
    d[p + 2] = c[2];
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** A still 128x64 bitmap of text, for the idle screen. */
export function textBits(lines) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = H / (lines.length + 1);
  lines.forEach(([text, size], i) => {
    ctx.font = `700 ${size}px Archivo, Arial, sans-serif`;
    ctx.fillText(text, W / 2, step * (i + 1));
  });
  const px = ctx.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(FRAME_BYTES);
  for (let i = 0; i < W * H; i++) if (px[i * 4] > 128) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}

// What each header pin connects to, shown when you point at a pin.
const PINS = [
  ['GND', 'Ground. Connect to GND on your board.'],
  ['VCC', 'Power. Connect to 3.3V. Most modules also take 5V.'],
  ['SCL', 'I2C clock. GPIO 22 on an ESP32, A5 on an Arduino Uno.'],
  ['SDA', 'I2C data. GPIO 21 on an ESP32, A4 on an Arduino Uno.'],
];

const STATUS_TEXT = {
  idle: 'Waiting for a GIF',
  busy: 'Converting',
  ok: 'Ready',
  bad: 'Needs attention',
};

// The power-on sequence runs once per page load, the way a real SSD1306
// shows random RAM contents for a moment and then fills in page by page.
let booted = false;
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function noiseBits() {
  const out = new Uint8Array(FRAME_BYTES);
  crypto.getRandomValues(out);
  return out;
}

/** Only the first `pages` 8-pixel rows of `bits` (one SSD1306 page each). */
function firstPages(bits, frame, pages) {
  const out = new Uint8Array(FRAME_BYTES);
  if (bits) out.set(bits.subarray(frame * FRAME_BYTES, frame * FRAME_BYTES + pages * 8 * (W / 8)));
  return out;
}

/**
 * pan: optional { start(), move(dxFrac, dyFrac), end(), zoom(factor, fx, fy) }
 * where fractions are of the screen size, so the picture can be dragged
 * and scroll-zoomed right on the display.
 */
export function Oled({ bits, frame, panel, pan, status = 'idle' }) {
  const ref = useRef(null);
  const glass = useRef(null);
  const drag = useRef(null);
  const panRef = useRef(pan);
  panRef.current = pan;
  const [booting, setBooting] = useState(() => !booted && !reducedMotion());
  const latest = useRef({ bits, frame, panel });
  latest.current = { bits, frame, panel };

  useEffect(() => {
    if (!booting) return undefined;
    booted = true;
    const steps = [];
    for (let i = 0; i < 5; i++) steps.push([() => noiseBits(), 0, 70]);
    steps.push([() => null, 0, 160]);
    for (let p = 1; p <= 8; p++) steps.push([(b, f) => firstPages(b, f, p), 0, 55]);
    let k = 0;
    let timer;
    const run = () => {
      if (k >= steps.length) { setBooting(false); return; }
      const [make, , ms] = steps[k++];
      const { bits: b, frame: f, panel: pl } = latest.current;
      const img = make(b, f);
      drawBits(ref.current, img, 0, pl);
      timer = setTimeout(run, ms);
    };
    run();
    return () => clearTimeout(timer);
  }, [booting]);

  useEffect(() => {
    if (!booting) drawBits(ref.current, bits, frame, panel);
  }, [bits, frame, panel, booting]);

  useEffect(() => {
    const el = glass.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const p = panRef.current;
      if (!p) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      p.zoom(e.deltaY < 0 ? 1 / 1.12 : 1.12, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const down = (e) => {
    if (!pan || e.button !== 0) return;
    e.preventDefault();
    glass.current.setPointerCapture(e.pointerId);
    const r = glass.current.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    pan.start();
  };
  const move = (e) => {
    const d = drag.current;
    if (d) pan.move((e.clientX - d.x) / d.w, (e.clientY - d.y) / d.h);
  };
  const up = () => {
    if (drag.current) pan?.end();
    drag.current = null;
  };
  return (
    <div className={`module ${booting ? 'booting' : ''}`}>
      <div className="module-pins">
        {PINS.map(([name, tip]) => (
          <button key={name} type="button" className="pin" aria-label={`${name}: ${tip}`}>
            <i aria-hidden="true" />
            <span aria-hidden="true">{name}</span>
            <span className="pin-tip" role="tooltip" aria-hidden="true">{tip}</span>
          </button>
        ))}
      </div>
      <span className="hole tl" aria-hidden="true" />
      <span className="hole tr" aria-hidden="true" />
      <span className="hole bl" aria-hidden="true" />
      <span className="hole br" aria-hidden="true" />
      <div
        ref={glass}
        className={`glass ${pan ? 'pannable' : ''}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        title={pan ? 'Drag to move the picture, scroll to zoom' : undefined}
      >
        <canvas ref={ref} width={W} height={H} className={`screen panel-${panel}`}
          role="img" aria-label="Preview on a 128 by 64 OLED display" />
        <div className="pixel-grid" aria-hidden="true" />
      </div>
      <div className={`led led-${status}`} title={STATUS_TEXT[status]}>
        <i aria-hidden="true" />
        <span aria-hidden="true">STAT</span>
      </div>
      <div className="module-silk" aria-hidden="true">SSD1306 128x64 I2C</div>
    </div>
  );
}
