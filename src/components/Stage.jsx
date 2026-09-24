import { useEffect, useMemo, useRef, useState } from 'react';
import { Oled, PANELS, textBits } from './Oled.jsx';
import { SourceView } from './SourceView.jsx';
import { boxSize, moveBox, roundBox, zoomBox } from '../lib/framing.js';

function usePlayback(nFrames, frameMs, resetKey) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const reduced = useRef(
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    setFrame(0);
    setPlaying(!reduced.current);
  }, [resetKey]);

  useEffect(() => {
    if (frame >= nFrames && nFrames > 0) setFrame(0);
  }, [frame, nFrames]);

  useEffect(() => {
    if (!playing || nFrames < 2) return undefined;
    let raf;
    let last = performance.now();
    let acc = 0;
    const tick = (now) => {
      acc += now - last;
      last = now;
      const ms = Math.max(10, frameMs || 50);
      if (acc >= ms) {
        const steps = Math.floor(acc / ms);
        acc -= steps * ms;
        setFrame((f) => (f + steps) % nFrames);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, nFrames, frameMs]);

  return { frame: Math.min(frame, Math.max(0, nFrames - 1)), setFrame, playing, setPlaying };
}

/** Typing in a field or using a control should never trigger a shortcut. */
export const isTyping = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"], [role="application"], dialog');

function entryStatus(entry) {
  if (!entry) return 'idle';
  if (entry.status === 'error' || entry.result?.error) return 'bad';
  if (entry.status === 'loading' || entry.busy || !entry.result) return 'busy';
  return 'ok';
}

export function Stage({ entry, panel, setPanel, onFrameMs, onFraming, dragging }) {
  const idle = useMemo(() => textBits([['gif2cpp', 17], ['drop a GIF', 11]]), []);
  const dropHere = useMemo(() => textBits([['let go', 19], ['to convert it', 11]]), []);
  // an over-limit result still has frames worth previewing
  const result = entry?.result;
  const nFrames = result?.nFrames || 0;
  const { frame, setFrame, playing, setPlaying } = usePlayback(nFrames, entry?.frameMs, entry?.key);
  const bits = dragging ? dropHere : result?.bits || (entry ? null : idle);

  const [paused, setPausedFrame] = useState(0);
  useEffect(() => { if (!playing) setPausedFrame(frame); }, [playing, frame]);

  // Space plays or pauses, the arrow keys step through frames.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || nFrames < 2) return;
      if (e.key === ' ' && !e.target.closest?.('button, a')) {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        const step = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
        setFrame((f) => (f + step + nFrames) % nFrames);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nFrames, setFrame, setPlaying]);

  // Framing: the manual box if there is one, otherwise the automatic one
  const editable = entry?.kind === 'clip' && result && entry.source;
  const box = editable ? entry.settings.manualBox || result.box : null;
  const locked = (entry?.settings?.fit || 'fill') !== 'stretch';
  const setBox = (b) => onFraming(roundBox(b));
  const panStart = useRef(null);
  const pan = editable ? {
    start: () => { panStart.current = box; },
    // the picture follows the pointer, so the frame moves the opposite way
    move: (fx, fy) => {
      const b0 = panStart.current || box;
      const [bw, bh] = boxSize(b0);
      setBox(moveBox(b0, -fx * bw, -fy * bh));
    },
    end: () => { panStart.current = null; },
    zoom: (factor, fx, fy) => {
      const [bw, bh] = boxSize(box);
      setBox(zoomBox(box, factor, entry.source.width, entry.source.height, box[0] + fx * bw, box[1] + fy * bh));
    },
  } : null;

  return (
    <section className="stage" aria-label="Preview">
      <Oled bits={bits} frame={bits === idle || bits === dropHere ? 0 : frame} panel={panel} pan={pan} status={entryStatus(entry)} />

      <div className="transport">
        <button
          type="button"
          className="btn icon"
          onClick={() => setPlaying((p) => !p)}
          disabled={nFrames < 2}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" /><rect x="9.5" y="2" width="3.5" height="12" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6z" /></svg>
          )}
        </button>
        <input
          type="range"
          className="scrub"
          min={0}
          max={Math.max(0, nFrames - 1)}
          value={frame}
          style={{ '--fill': `${nFrames > 1 ? (frame / (nFrames - 1)) * 100 : 0}%` }}
          disabled={nFrames < 2}
          onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
          aria-label="Frame"
        />
        <span className="count">{nFrames ? `${frame + 1} / ${nFrames}` : '0 / 0'}</span>
        <label className="ms">
          <input
            type="number"
            min={10}
            max={5000}
            value={entry?.frameMs ?? 50}
            disabled={!entry || entry.kind === 'missing'}
            onChange={(e) => onFrameMs(Math.max(10, Number(e.target.value) || 10))}
          />
          ms per frame
        </label>
      </div>

      <div className="panel-pick" role="radiogroup" aria-label="Display colour">
        {Object.entries(PANELS).map(([id, p]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={panel === id}
            className={`chip panel-chip-${id}`}
            onClick={() => setPanel(id)}
          >
            <i aria-hidden="true" />{p.name}
          </button>
        ))}
      </div>

      {entry?.kind === 'clip' && result && (
        <SourceView
          entry={entry}
          sourceIndex={result.sourceIndex[playing ? 0 : paused] ?? 0}
          box={box}
          locked={locked}
          onBox={setBox}
          onReset={() => onFraming(null)}
        />
      )}
      {entry?.kind === 'clip' && result && playing && (
        <p className="hint">Pause to see the source frame that matches the display. Use <kbd>←</kbd> <kbd>→</kbd> to step through frames.</p>
      )}
    </section>
  );
}
