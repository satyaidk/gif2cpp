import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine } from './lib/engine.js';
import {
  DEFAULT_SETTINGS, FRAME_BYTES, parseHeader, parseRegistry, registryText, slug,
} from './lib/mochi.js';
import { budgetFor, buildZip, entryHeader, registryRows, saveBlob, sketchFor } from './lib/exporter.js';
import { Stage } from './components/Stage.jsx';
import { Settings } from './components/Settings.jsx';
import { Budget, Library } from './components/Library.jsx';
import { CodePanel } from './components/CodePanel.jsx';

let nextId = 1;
const uid = () => `e${nextId++}`;
const IMAGE_RE = /\.(gif|png|apng|webp|jpe?g|bmp)$/i;
const STILL_RE = /\.(png|jpe?g|bmp)$/i;
const same = (a, b) => a.toUpperCase() === b.toUpperCase();

function uniqueSym(base, entries, ignoreKey) {
  const used = (s) => entries.some((e) => e.key !== ignoreKey && same(e.sym, s));
  if (!used(base)) return base;
  let n = 2;
  while (used(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Name for a frame sequence: the folder, or the first file minus its number. */
function sequenceName(files) {
  const rel = files[0].webkitRelativePath;
  if (rel && rel.includes('/')) return rel.split('/')[0];
  return files[0].name.replace(/\.[^.]*$/, '').replace(/[-_ ]*\d+$/, '') || 'frames';
}

export default function App() {
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState(null);
  const [panel, setPanel] = useState('white');
  const [withSketch, setWithSketch] = useState(true);
  const [notice, setNotice] = useState(null);
  const [dragging, setDragging] = useState(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const timers = useRef(new Map());

  const patch = useCallback((key, p) => {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...(typeof p === 'function' ? p(e) : p) } : e)));
  }, []);

  // ------------------------------------------------------------ conversion
  const schedule = useCallback((key, settings, delay = 120) => {
    clearTimeout(timers.current.get(key));
    timers.current.set(key, setTimeout(async () => {
      patch(key, { busy: true });
      try {
        const r = await engine.process(key, settings);
        if (r.stale) return;
        patch(key, (e) => ({
          result: r,
          busy: false,
          progress: null,
          status: 'ready',
          frameMs: e.frameMsTouched
            ? e.frameMs
            : Math.max(20, Math.round(r.delays.reduce((a, b) => a + b, 0) / r.delays.length)),
        }));
      } catch (err) {
        patch(key, { busy: false, status: 'error', loadError: err.message });
      }
    }, delay));
  }, [patch]);

  useEffect(() => engine.onProgress(({ id, done, total }) => {
    patch(id, { progress: done / total });
  }), [patch]);

  const addClip = useCallback((files, name, sequence) => {
    const key = uid();
    const base = slug(name);
    setEntries((list) => {
      const entry = {
        key, kind: 'clip', fileName: name, sym: base, label: '', settings: { ...DEFAULT_SETTINGS },
        status: 'loading', frameMs: 50,
      };
      // Same name as a header opened from your sketch: replace it in place,
      // like the Python script's "updated in animations.h".
      const i = list.findIndex((e) => e.kind !== 'clip' && same(e.sym, base));
      if (i >= 0) return list.map((e, k) => (k === i ? { ...entry, sym: e.sym } : e));
      return [...list, { ...entry, sym: uniqueSym(base, list) }];
    });
    setSelected(key);
    engine.load(key, files, sequence)
      .then((info) => {
        patch(key, { source: info, status: 'processing' });
        // settings may have been changed while the frames were loading
        const cur = entriesRef.current.find((e) => e.key === key);
        schedule(key, cur?.settings || { ...DEFAULT_SETTINGS }, 0);
      })
      .catch((err) => patch(key, { status: 'error', loadError: `${name}: ${err.message}` }));
  }, [patch, schedule]);

  const openSketchFiles = useCallback(async (files) => {
    const errors = [];
    let registry = null;
    const headers = [];
    for (const f of files) {
      const text = await f.text();
      const rows = parseRegistry(text);
      if (/^animations\.h$/i.test(f.name) || (rows.length && !/_data\s*\[/.test(text))) {
        registry = rows;
        continue;
      }
      try {
        headers.push({ ...parseHeader(text), headerText: text, fileName: f.name });
      } catch (err) {
        errors.push(`${f.name}: ${err.message}`);
      }
    }

    const order = registry ? registry.map((r) => r.sym) : [];
    headers.forEach((h) => { if (!order.includes(h.sym)) order.push(h.sym); });
    const incoming = order.map((sym) => {
      const h = headers.find((x) => x.sym === sym);
      const regLabel = registry?.find((r) => r.sym === sym)?.label;
      if (!h) return { key: uid(), kind: 'missing', sym, label: regLabel || '', status: 'ready' };
      return {
        key: uid(), kind: 'imported', fileName: h.fileName, sym, label: regLabel ?? h.label,
        headerText: h.headerText, status: 'ready', frameMs: 50,
        result: {
          blob: h.blob, offsets: h.offsets, nFrames: h.nframes, bits: h.bits,
          rawBytes: h.nframes * FRAME_BYTES, error: null,
        },
      };
    });

    const skipped = [];
    const next = [...entriesRef.current];
    for (const e of incoming) {
      const i = next.findIndex((x) => same(x.sym, e.sym));
      if (i < 0) next.push(e);
      else if (next[i].kind === 'missing' && e.kind === 'imported') next[i] = e;
      else if (!skipped.includes(e.sym)) skipped.push(e.sym);
    }
    entriesRef.current = next;
    setEntries(next);
    if (incoming.length) setSelected((s) => s ?? incoming[0].key);

    const msgs = [];
    if (incoming.length) msgs.push(`Opened ${incoming.length} animation${incoming.length === 1 ? '' : 's'} from your sketch.`);
    if (skipped.length) msgs.push(`Kept the ones already here for: ${skipped.join(', ')}.`);
    msgs.push(...errors);
    setNotice({ tone: errors.length ? 'bad' : 'ok', text: msgs.join(' ') });
  }, []);

  const addFiles = useCallback((fileList) => {
    const files = [...fileList];
    const headers = files.filter((f) => /\.h$/i.test(f.name));
    const images = files.filter((f) => IMAGE_RE.test(f.name) || f.type.startsWith('image/'));
    const ignored = files.length - headers.length - images.length;
    if (headers.length) openSketchFiles(headers);
    images.forEach((f) => addClip([f], f.name, false));
    if (ignored > 0) {
      setNotice({ tone: 'bad', text: `Skipped ${ignored} file${ignored === 1 ? '' : 's'}: use GIF, PNG, WebP, JPG, BMP or .h files.` });
    }
  }, [addClip, openSketchFiles]);

  const addSequence = useCallback((fileList) => {
    const files = [...fileList].filter((f) => STILL_RE.test(f.name));
    if (!files.length) {
      setNotice({ tone: 'bad', text: 'A frame sequence needs PNG, JPG or BMP images.' });
      return;
    }
    addClip(files, sequenceName(files), true);
  }, [addClip]);

  // ------------------------------------------------------------ editing
  const selectedEntry = entries.find((e) => e.key === selected) || null;

  const updateSettings = (p, delay = 120) => {
    const e = entriesRef.current.find((x) => x.key === selected);
    if (!e || e.kind !== 'clip') return;
    const settings = { ...e.settings, ...p };
    // keep the ref current so fast pointer moves build on each other
    entriesRef.current = entriesRef.current.map((x) => (x.key === e.key ? { ...x, settings } : x));
    patch(e.key, { settings });
    if (e.source) schedule(e.key, settings, delay);
  };

  const remove = (key) => {
    const list = entriesRef.current;
    const i = list.findIndex((e) => e.key === key);
    if (i < 0) return;
    if (list[i].kind === 'clip') engine.drop(key);
    clearTimeout(timers.current.get(key));
    const rest = list.filter((e) => e.key !== key);
    setEntries(rest);
    if (selected === key) setSelected(rest[Math.min(i, rest.length - 1)]?.key ?? null);
  };

  const move = (key, dir) => setEntries((list) => {
    const i = list.findIndex((e) => e.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const taken = (sym) => entries.some((e) => e.key !== selected && same(e.sym, sym));

  // ------------------------------------------------------------ output
  const rows = useMemo(() => registryRows(entries), [entries]);
  const indexOf = (e) => rows.findIndex((r) => r.sym === e.sym);
  const b = useMemo(() => budgetFor(entries), [entries]);
  const exportable = rows.length > 0;

  const files = useMemo(() => {
    const out = [];
    if (selectedEntry && selectedEntry.kind !== 'missing') {
      const text = entryHeader(selectedEntry);
      out.push({
        name: `anim_${selectedEntry.sym}.h`,
        text,
        empty: selectedEntry.result?.error ? 'Fix the problem in the settings to generate this header.' : 'Converting…',
      });
    }
    out.push({
      name: 'animations.h',
      text: exportable ? registryText(rows) : '',
      hint: 'Lists every animation in the ANIMS[] table. Order follows the list on the left.',
      empty: 'Add a GIF to generate animations.h.',
    });
    out.push({
      name: 'MochiPlayer.ino',
      text: exportable ? sketchFor(entries) : '',
      hint: 'Example sketch for an SSD1306 with Adafruit GFX. decodeFrame() undoes the PackBits and XOR steps.',
      empty: 'Add a GIF to generate the example sketch.',
    });
    return out;
  }, [selectedEntry, rows, entries, exportable]);

  const downloadZip = async () => {
    const blob = await buildZip(entries, { withSketch });
    saveBlob(blob, withSketch ? 'MochiPlayer.zip' : 'mochi_animations.zip');
  };

  // ------------------------------------------------------------ page-wide drop
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [addFiles]);

  const gifInput = useRef(null);
  const seqInput = useRef(null);
  const hInput = useRef(null);

  return (
    <div className={`app ${dragging ? 'dragging' : ''}`}>
      <header className="top">
        <div className="brand">
          <h1>gif2mochi</h1>
          <p>Turn GIFs into animation headers for 128×64 OLED displays.</p>
        </div>
        <div className="export">
          <label className="check">
            <input type="checkbox" checked={withSketch} onChange={(e) => setWithSketch(e.target.checked)} />
            Include example sketch
          </label>
          <button type="button" className="btn primary" disabled={!exportable} onClick={downloadZip}>
            Download all files (.zip)
          </button>
        </div>
      </header>

      <nav className="side" aria-label="Animations">
        <div className="add">
          <button type="button" className="dropzone" onClick={() => gifInput.current.click()}>
            <strong>Add GIFs</strong>
            <span>Drop them anywhere on the page, or click to choose. Animated PNG and WebP work too.</span>
          </button>
          <div className="add-more">
            <button type="button" className="btn small" onClick={() => seqInput.current.click()}>Add frame sequence</button>
            <button type="button" className="btn small" onClick={() => hInput.current.click()}>Open sketch headers</button>
          </div>
          <input ref={gifInput} type="file" hidden multiple accept=".gif,.png,.apng,.webp,image/gif,image/png,image/webp"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={seqInput} type="file" hidden multiple accept=".png,.jpg,.jpeg,.bmp"
            onChange={(e) => { addSequence(e.target.files); e.target.value = ''; }} />
          <input ref={hInput} type="file" hidden multiple accept=".h"
            onChange={(e) => { openSketchFiles([...e.target.files]); e.target.value = ''; }} />
        </div>

        {notice && (
          <p className={`notice ${notice.tone}`} role="status">
            {notice.text}
            <button type="button" className="btn icon tiny" onClick={() => setNotice(null)} aria-label="Dismiss">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>
            </button>
          </p>
        )}

        <Library
          entries={entries}
          selected={selected}
          onSelect={setSelected}
          onMove={move}
          onRemove={remove}
          panel={panel}
          indexOf={indexOf}
        />
        {entries.length > 0 && <Budget b={b} />}
      </nav>

      <main className="work">
        <Stage
          entry={selectedEntry}
          panel={panel}
          setPanel={setPanel}
          onFrameMs={(ms) => selectedEntry && patch(selectedEntry.key, { frameMs: ms, frameMsTouched: true })}
          onFraming={(box) => updateSettings({ manualBox: box }, box ? 30 : 0)}
        />
        <Settings
          entry={selectedEntry}
          update={(p) => selectedEntry && patch(selectedEntry.key, p)}
          updateSettings={updateSettings}
          taken={taken}
          onRemove={() => selectedEntry && remove(selectedEntry.key)}
        />
        <CodePanel key={selected || 'none'} files={files} />
      </main>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <p>Drop GIFs to convert them, or .h files from your sketch to open them</p>
        </div>
      )}
    </div>
  );
}

