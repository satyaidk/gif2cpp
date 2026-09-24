import { useEffect, useRef, useState } from 'react';
import { effectiveLabel } from '../lib/mochi.js';
import { drawBits } from './Oled.jsx';

function Thumb({ entry, panel }) {
  const ref = useRef(null);
  const r = entry.result;
  useEffect(() => {
    if (r?.bits) drawBits(ref.current, r.bits, Math.floor(r.nFrames / 2), panel);
    else drawBits(ref.current, null, 0, panel);
  }, [r, panel]);
  const working = entry.status === 'loading' || entry.busy || (!r && entry.status !== 'error' && entry.kind === 'clip');
  return (
    <span className={`thumb-wrap ${working ? 'working' : ''}`} aria-hidden="true">
      <canvas ref={ref} width={128} height={64} className="thumb" />
      {working && (
        <span className={`thumb-progress ${entry.progress ? '' : 'indeterminate'}`}>
          <i style={entry.progress ? { width: `${Math.round(entry.progress * 100)}%` } : undefined} />
        </span>
      )}
    </span>
  );
}

function status(e) {
  if (e.kind === 'missing') return { text: 'Header not opened', tone: 'warn' };
  if (e.status === 'error') return { text: 'Could not read', tone: 'bad' };
  if (e.status === 'loading') return { text: 'Reading…', tone: '' };
  if (e.busy && e.progress) return { text: `Converting ${Math.round(e.progress * 100)}%`, tone: '' };
  if (!e.result) return { text: 'Converting…', tone: '' };
  if (e.result.error) return { text: 'Too large', tone: 'bad' };
  return { text: `${e.result.nFrames} frames, ${(e.result.blob.length / 1024).toFixed(1)} KB`, tone: '' };
}

export function Library({ entries, selected, onSelect, onMove, onReorder, onRemove, panel, indexOf }) {
  // Drag a row to reorder; the up and down buttons do the same from the keyboard.
  const [dragKey, setDragKey] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const endDrag = () => { setDragKey(null); setDropAt(null); };

  if (!entries.length) {
    return <p className="library-empty">Converted animations appear here, in the order they get in <code>ANIMS[]</code>.</p>;
  }
  return (
    <ol className="library" aria-label="Animations">
      {entries.map((e, i) => {
        const st = status(e);
        const idx = indexOf(e);
        const cls = [
          e.key === selected && 'selected',
          e.key === dragKey && 'dragged',
          dragKey && dropAt === i && 'drop-before',
          dragKey && dropAt === i + 1 && i === entries.length - 1 && 'drop-after',
        ].filter(Boolean).join(' ');
        return (
          <li
            key={e.key}
            className={cls}
            draggable={entries.length > 1}
            title={entries.length > 1 ? 'Drag to change the order' : undefined}
            onDragStart={(ev) => {
              ev.dataTransfer.effectAllowed = 'move';
              ev.dataTransfer.setData('text/plain', e.sym);
              setDragKey(e.key);
            }}
            onDragOver={(ev) => {
              if (!dragKey) return;
              ev.preventDefault();
              const r = ev.currentTarget.getBoundingClientRect();
              setDropAt(ev.clientY < r.top + r.height / 2 ? i : i + 1);
            }}
            onDrop={(ev) => {
              if (!dragKey) return;
              ev.preventDefault();
              if (dropAt != null) onReorder(dragKey, dropAt);
              endDrag();
            }}
            onDragEnd={endDrag}
          >
            <button type="button" className="entry" onClick={() => onSelect(e.key)} aria-current={e.key === selected}>
              <Thumb entry={e} panel={panel} />
              <span className="entry-text">
                <span className="entry-name">{effectiveLabel(e.sym, e.label).trim()}</span>
                <code className="entry-sym">{idx >= 0 ? `ANIM_${e.sym.toUpperCase()} = ${idx}` : `anim_${e.sym}.h`}</code>
                <span className={`entry-status ${st.tone}`}>{st.text}</span>
              </span>
            </button>
            <span className="entry-tools">
              <button type="button" className="btn icon tiny" disabled={i === 0} onClick={() => onMove(e.key, -1)} aria-label={`Move ${e.sym} up`}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4l5 6H3z" /></svg>
              </button>
              <button type="button" className="btn icon tiny" disabled={i === entries.length - 1} onClick={() => onMove(e.key, 1)} aria-label={`Move ${e.sym} down`}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12L3 6h10z" /></svg>
              </button>
              <button type="button" className="btn icon tiny" onClick={() => onRemove(e.key)} aria-label={`Remove ${e.sym}`}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Budget({ b }) {
  const total = b.partitionKB;
  const sketch = (b.sketchKB / total) * 100;
  const frames = Math.min(100 - sketch, (b.framesKB / total) * 100);
  return (
    <div className="budget">
      <h3>Flash</h3>
      <div className="budget-bar" aria-hidden="true">
        <i className="b-sketch" style={{ width: `${sketch}%` }} />
        <i className={`b-frames ${b.tight ? 'tight' : ''}`} style={{ width: `${frames}%` }} />
      </div>
      <p>
        Frames use {b.framesKB.toFixed(0)} KB, the sketch about {b.sketchKB} KB.
        {' '}About {Math.max(0, b.freeKB).toFixed(0)} KB of the {b.partitionKB} KB app partition is free.
      </p>
      {b.tight && <p className="warn">That is tight. In the Arduino IDE choose Tools, Partition Scheme, Huge APP.</p>}
    </div>
  );
}
