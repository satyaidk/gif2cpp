import { useEffect, useRef, useState } from 'react';
import { engine } from '../lib/engine.js';
import {
  boxSize, centerBox, fitHeight, fitWidth, moveBox, resizeBox, zoomBox,
} from '../lib/framing.js';

function rgbToUrl(rgb, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0, q = 0, p = 0; i < w * h; i++, q += 3, p += 4) {
    img.data[p] = rgb[q];
    img.data[p + 1] = rgb[q + 1];
    img.data[p + 2] = rgb[q + 2];
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** The area shown: the picture plus a margin, grown to include the frame. */
function viewFor(img, box) {
  const m = Math.max(img.w, img.h) * 0.1;
  const x0 = Math.min(-m, box[0] - m / 2);
  const y0 = Math.min(-m, box[1] - m / 2);
  const x1 = Math.max(img.w + m, box[2] + m / 2);
  const y1 = Math.max(img.h + m, box[3] + m / 2);
  return [x0, y0, x1 - x0, y1 - y0];
}

const ARROWS = {
  left: 'M10 3L4 8l6 5z',
  up: 'M3 10l5-6 5 6z',
  down: 'M3 6l5 6 5-6z',
  right: 'M6 3l6 5-6 5z',
};

function Icon({ d }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d={d} /></svg>;
}

/**
 * The source frame with the crop frame on it. Drag the frame to move it,
 * drag a corner or scroll to zoom. Whatever is inside the frame is what
 * the display shows.
 */
export function SourceView({ entry, sourceIndex, box, locked, onBox, onReset }) {
  const [img, setImg] = useState(null);
  const [frozen, setFrozen] = useState(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const latest = useRef({});
  const { key, settings, result } = entry;
  const bg = settings.background;
  latest.current = { box, onBox, img };

  useEffect(() => {
    let live = true;
    engine.source(key, sourceIndex, settings)
      .then((r) => live && setImg({ url: rgbToUrl(r.rgb, r.width, r.height), w: r.width, h: r.height }))
      .catch(() => live && setImg(null));
    return () => { live = false; };
    // settings only matter here through the background colour
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sourceIndex, bg]);

  const toSvg = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  // scroll to zoom around the pointer (needs a non-passive listener)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const { box: b, onBox: set, img: im } = latest.current;
      if (!b || !im) return;
      e.preventDefault();
      const p = toSvg(e);
      set(zoomBox(b, e.deltaY < 0 ? 1 / 1.12 : 1.12, im.w, im.h, p.x, p.y));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [img]);

  if (!img || !result || !box) return <div className="source placeholder" />;

  const view = frozen || viewFor(img, box);
  const [vx, vy, vw, vh] = view;
  const [x0, y0, x1, y1] = box;
  const [bw, bh] = boxSize(box);
  const hs = vw * 0.022;
  const outside = x0 < 0 || y0 < 0 || x1 > img.w || y1 > img.h;

  const start = (mode, corner) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    drag.current = { mode, corner, p0: toSvg(e), box0: box };
    setFrozen(view); // keep the view still while dragging
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const p = toSvg(e);
    if (d.mode === 'move') onBox(moveBox(d.box0, p.x - d.p0.x, p.y - d.p0.y));
    else onBox(resizeBox(d.box0, d.corner, p.x, p.y, locked));
  };
  const end = () => {
    drag.current = null;
    setFrozen(null);
  };

  // the picture moves the way the arrow points, so the frame moves the other way
  const nudge = (dx, dy, big) => {
    const f = big ? 0.2 : 0.05;
    onBox(moveBox(box, -dx * bw * f, -dy * bh * f));
  };
  const zoom = (inward) => onBox(zoomBox(box, inward ? 1 / 1.15 : 1.15, img.w, img.h));

  const onKey = (e) => {
    const k = e.key;
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[k]) nudge(...dirs[k], e.shiftKey);
    else if (k === '+' || k === '=') zoom(true);
    else if (k === '-' || k === '_') zoom(false);
    else return;
    e.preventDefault();
  };

  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];

  return (
    <figure className="source">
      <svg
        ref={svgRef}
        className="frame-editor"
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        tabIndex={0}
        role="application"
        aria-label="Frame editor. Arrow keys move the picture on the display, plus and minus zoom."
        onKeyDown={onKey}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <rect x={x0} y={y0} width={bw} height={bh} fill="#000" />
        <image href={img.url} x="0" y="0" width={img.w} height={img.h} style={{ imageRendering: 'pixelated' }} />
        <path
          fillRule="evenodd"
          fill="rgba(228,232,228,0.72)"
          d={`M${vx} ${vy}h${vw}v${vh}h${-vw}z M${x0} ${y0}v${bh}h${bw}v${-bh}z`}
        />
        <rect
          x={x0} y={y0} width={bw} height={bh}
          className="crop-area"
          onPointerDown={start('move')}
        />
        <rect x={x0} y={y0} width={bw} height={bh} className="crop-line" vectorEffect="non-scaling-stroke" />
        {corners.map(([cx, cy], i) => (
          <rect
            key={i}
            x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs}
            className="crop-handle"
            style={{ cursor: cursors[i] }}
            vectorEffect="non-scaling-stroke"
            onPointerDown={start('resize', i)}
          />
        ))}
      </svg>

      <div className="frame-tools" role="toolbar" aria-label="Position on the display">
        <div className="tool-group">
          <button type="button" className="btn icon small-icon" onClick={(e) => nudge(-1, 0, e.shiftKey)} aria-label="Move picture left"><Icon d={ARROWS.left} /></button>
          <button type="button" className="btn icon small-icon" onClick={(e) => nudge(0, -1, e.shiftKey)} aria-label="Move picture up"><Icon d={ARROWS.up} /></button>
          <button type="button" className="btn icon small-icon" onClick={(e) => nudge(0, 1, e.shiftKey)} aria-label="Move picture down"><Icon d={ARROWS.down} /></button>
          <button type="button" className="btn icon small-icon" onClick={(e) => nudge(1, 0, e.shiftKey)} aria-label="Move picture right"><Icon d={ARROWS.right} /></button>
        </div>
        <div className="tool-group">
          <button type="button" className="btn icon small-icon" onClick={() => zoom(false)} aria-label="Zoom out">
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="2" /></svg>
          </button>
          <button type="button" className="btn icon small-icon" onClick={() => zoom(true)} aria-label="Zoom in">
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="2" /><rect x="7" y="3" width="2" height="10" /></svg>
          </button>
        </div>
        <div className="tool-group">
          <button type="button" className="btn small" onClick={() => onBox(fitWidth(box, img.w, locked))}>Fit width</button>
          <button type="button" className="btn small" onClick={() => onBox(fitHeight(box, img.h, locked))}>Fit height</button>
          <button type="button" className="btn small" onClick={() => onBox(centerBox(box, img.w, img.h))}>Center</button>
        </div>
        {settings.manualBox && (
          <button type="button" className="btn small" onClick={onReset}>Back to automatic</button>
        )}
      </div>

      <figcaption>
        {settings.manualBox ? 'Framed by hand. ' : 'Framed automatically. '}
        Drag the frame to choose what the display shows; drag a corner or scroll to zoom.
        You can also drag the picture on the display itself.
        {' '}Source frame {sourceIndex + 1} of {result.nSrc}, {img.w}×{img.h}
        {outside ? '; parts outside the picture show as black.' : '.'}
      </figcaption>
    </figure>
  );
}
