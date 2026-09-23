import { useEffect, useState } from 'react';
import {
  MAX_BLOB, PYTHON_SETTINGS, capitalize, cleanLabel, cliCommand, effectiveLabel, pythonCompatible, symbolError,
} from '../lib/mochi.js';
import { CopyButton } from './CopyButton.jsx';

const COLORS = [
  ['smart', 'All colours', 'Every colour that differs from the background lights up, including red and blue.'],
  ['luma', 'Brightness', 'Only bright colours light up; red and blue come out dark. This is what gif2mochi.py does.'],
];
const STYLES = [
  ['solid', 'Solid', 'Clean shapes. Best for cartoons, icons and faces.'],
  ['dither', 'Dither', 'A dot pattern that shows shades. Best for photos and gradients.'],
  ['outline', 'Outline', 'Only the edges. Good for busy, colourful art whose parts are similar in brightness.'],
];
const NOISE = [
  ['off', 'Off', 'No filtering. Use it for clean pixel or vector art.'],
  ['gentle', 'Gentle', 'Removes stray specks and grain but keeps thin lines and small text.'],
  ['light', 'Median', 'A 3×3 median filter, as the script does. Smooths more, but can break thin lines.'],
  ['strong', 'Strong', 'A 5×5 median filter for very grainy or compressed clips. Rounds off fine detail.'],
];
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

function Seg({ id, label, value, options, onChange }) {
  const current = options.find(([v]) => v === value) || options[0];
  return (
    <div className="field">
      <span className="label" id={`${id}-label`}>{label}</span>
      <div className="seg" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map(([v, name]) => (
          <button key={v} type="button" role="radio" aria-checked={current[0] === v} onClick={() => onChange(v)}>{name}</button>
        ))}
      </div>
      {current[2] && <p className="help">{current[2]}</p>}
    </div>
  );
}

const FITS = [
  ['fill', 'Fill screen', 'Zooms in until the picture covers all 128×64 pixels. Edges that do not fit are cut off.'],
  ['stretch', 'Stretch', 'Squeezes the whole picture onto the screen with no bars. Shapes get distorted.'],
  ['python', 'Show all', 'Keeps a margin around the subject, so wide or tall clips get black bars. Same as the Python script.'],
];

function SymbolField({ entry, taken, onCommit, disabled }) {
  const [draft, setDraft] = useState(entry.sym);
  useEffect(() => setDraft(entry.sym), [entry.key, entry.sym]);
  const err = symbolError(draft)
    || (draft.toUpperCase() !== entry.sym.toUpperCase() && taken(draft) ? `"${draft}" is already used by another animation.` : null);

  return (
    <div className="field">
      <label htmlFor="sym">C name</label>
      <input
        id="sym"
        className="code-input"
        value={draft}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!!err}
        aria-describedby="sym-help"
        onChange={(e) => {
          const v = e.target.value.trim();
          setDraft(v);
          if (!symbolError(v) && (v.toUpperCase() === entry.sym.toUpperCase() || !taken(v))) onCommit(v);
        }}
      />
      <p id="sym-help" className={err ? 'help bad' : 'help'}>
        {err || <>Becomes <code>anim_{entry.sym}.h</code>, <code>{entry.sym}_data</code> and <code>ANIM_{entry.sym.toUpperCase()}</code>.</>}
      </p>
    </div>
  );
}

function Toggle({ id, checked, onChange, children, help }) {
  return (
    <div className="toggle">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{children}</label>
      {help && <p className="help">{help}</p>}
    </div>
  );
}

function Stats({ entry }) {
  const r = entry.result;
  if (!r) return null;
  const pct = Math.min(100, (r.blob.length / MAX_BLOB) * 100);
  return (
    <dl className="stats">
      {entry.kind === 'clip' && (
        <>
          <dt>Frames</dt>
          <dd>{r.nFrames === r.nSrc ? r.nFrames : `${r.nFrames} of ${r.nSrc} (subsampled)`}</dd>
          <dt>Source</dt>
          <dd>{entry.source.width}×{entry.source.height}</dd>
          <dt>{r.manual ? 'Crop box (by hand)' : 'Crop box'}</dt>
          <dd className="num">({r.box.join(', ')})</dd>
        </>
      )}
      {entry.kind === 'imported' && (<><dt>Frames</dt><dd>{r.nFrames}</dd></>)}
      <dt>Stored</dt>
      <dd>
        {(r.rawBytes / 1024).toFixed(0)} KB raw to {(r.blob.length / 1024).toFixed(1)} KB
        {r.blob.length > 0 && ` (${(r.rawBytes / r.blob.length).toFixed(1)}×)`}
      </dd>
      <dt>Offset table</dt>
      <dd>
        <span className={`meter ${pct >= 100 ? 'over' : pct > 85 ? 'near' : ''}`}><i style={{ width: `${pct}%` }} /></span>
        {r.blob.length.toLocaleString()} of {MAX_BLOB.toLocaleString()} bytes
      </dd>
      <dt>Round trip</dt>
      <dd className={r.error ? 'bad' : 'ok'}>{r.error ? 'Not written' : 'Decodes back exactly'}</dd>
    </dl>
  );
}

export function Settings({ entry, update, updateSettings, taken, onRemove }) {
  if (!entry) {
    return (
      <aside className="settings empty">
        <h2>Settings</h2>
        <p>Add a GIF to adjust its threshold, crop and frame count here.</p>
      </aside>
    );
  }

  const s = entry.settings;
  const r = entry.result;
  const label = effectiveLabel(entry.sym, entry.label);
  const busy = entry.status === 'loading' || entry.busy;

  return (
    <aside className="settings" aria-busy={busy}>
      <h2>{label.trim()}</h2>
      {entry.kind === 'imported' && (
        <p className="note">Opened from <code>{entry.fileName}</code>. Its frames are kept exactly as they are.
          To change them, convert the original GIF again with the same C name.</p>
      )}
      {entry.kind === 'missing' && (
        <p className="note warn">Listed in animations.h, but <code>anim_{entry.sym}.h</code> was not opened.
          It stays in animations.h so your sketch still finds your existing file.
          Open that header too, or add a GIF with the C name <code>{entry.sym}</code> to replace it.</p>
      )}
      {entry.status === 'error' && <p className="note bad" role="alert">{entry.loadError}</p>}
      {entry.source?.note && <p className="note warn">{entry.source.note}</p>}

      <SymbolField entry={entry} taken={taken} disabled={entry.kind !== 'clip'} onCommit={(sym) => update({ sym })} />

      <div className="field">
        <label htmlFor="label">Display name</label>
        <input
          id="label"
          value={entry.label}
          maxLength={11}
          placeholder={capitalize(entry.sym).slice(0, 11)}
          onChange={(e) => update({ label: cleanLabel(e.target.value) })}
        />
        <p className="help">Shown as <code>ANIMS[n].name</code>. Up to 11 characters.</p>
      </div>

      {entry.kind === 'clip' && (
        <>
          <h3 className="group">Picture</h3>

          <Seg id="colors" label="Colours" value={s.colors} options={COLORS} onChange={(v) => updateSettings({ colors: v })} />
          {s.colors !== 'luma' && r?.bgColor && (
            <p className="help bg-found">
              <i style={{ background: `rgb(${r.bgColor.color.join(',')})` }} aria-hidden="true" />
              {r.bgColor.confident
                ? `Background detected: ${hex(r.bgColor.color)}. Anything that differs from it lights up.`
                : 'The border is too busy to find one background colour, so black is used.'}
            </p>
          )}

          <Seg id="style" label="Style" value={s.style} options={STYLES} onChange={(v) => updateSettings({ style: v })} />

          <div className="field">
            <label htmlFor="thr">
              {s.style === 'dither' ? 'Brightness' : 'Threshold'}
              <output htmlFor="thr" className="num">{s.autoThreshold && r ? r.threshold : s.threshold}</output>
            </label>
            <input
              id="thr"
              type="range"
              min={0}
              max={254}
              value={s.autoThreshold && r ? r.threshold : s.threshold}
              onChange={(e) => updateSettings({ threshold: Number(e.target.value), autoThreshold: false })}
            />
            <div className="toggle inline">
              <input id="auto-thr" type="checkbox" checked={s.autoThreshold}
                onChange={(e) => updateSettings({ autoThreshold: e.target.checked, threshold: r?.threshold ?? s.threshold })} />
              <label htmlFor="auto-thr">Automatic</label>
            </div>
            <p className="help">
              {s.style === 'dither'
                ? 'Lower it to light more pixels.'
                : 'Pixels brighter than this light up. Automatic picks the value that best separates the subject from the background.'}
            </p>
          </div>

          <div className="field">
            <label htmlFor="detail">Fine detail <output htmlFor="detail" className="num">{s.detail ? `${s.detail}%` : 'Off'}</output></label>
            <input id="detail" type="range" min={0} max={100} step={5} value={s.detail || 0}
              onChange={(e) => updateSettings({ detail: Number(e.target.value) })} />
            <p className="help">Keeps thin lines such as a nose, a mouth or eyelids, which would otherwise vanish when
              the picture is shrunk to 128×64. Raise it to show fainter lines, lower it if the picture gets busy.</p>
          </div>

          <Toggle id="invert" checked={s.invert} onChange={(v) => updateSettings({ invert: v })}
            help="Swaps lit and dark pixels.">Invert</Toggle>

          <h3 className="group">Cleanup</h3>

          <Seg id="denoise" label="Noise removal" value={s.denoise} options={NOISE} onChange={(v) => updateSettings({ denoise: v })} />

          <div className="field">
            <label htmlFor="deblur">Fix blur <output htmlFor="deblur" className="num">{s.deblur ? `${s.deblur}%` : 'Off'}</output></label>
            <input id="deblur" type="range" min={0} max={100} step={5} value={s.deblur}
              onChange={(e) => updateSettings({ deblur: Number(e.target.value) })} />
            <p className="help">
              {s.style === 'solid'
                ? 'Puts the edges of soft or blurry shapes where they belong, whether the shape is bright or dim. Raise it for very blurry clips.'
                : 'Sharpens the picture before it is turned into dots or outlines.'}
            </p>
          </div>

          <Toggle id="levels" checked={s.levels} onChange={(v) => updateSettings({ levels: v })}
            help="Stretches faded or low-contrast clips to the full range.">Auto contrast</Toggle>
          {s.style !== 'dither' && (
            <Toggle id="specks" checked={s.specks} onChange={(v) => updateSettings({ specks: v })}
              help="Removes lone lit pixels and fills pinholes.">Remove specks</Toggle>
          )}
          {s.style !== 'dither' && (
            <Toggle id="steady" checked={s.steady} onChange={(v) => updateSettings({ steady: v })}
              help="Pixels near the threshold stop blinking between frames. Also makes the file smaller.">Reduce flicker</Toggle>
          )}

          <h3 className="group">Framing</h3>

          <Seg id="fit" label="Fit to screen" value={s.fit || 'fill'} options={FITS} onChange={(v) => updateSettings({ fit: v, manualBox: null })} />
          {s.manualBox && (
            <p className="help note-inline">Framed by hand under the display. Choosing a fit option or turning
              Crop to the subject on or off goes back to automatic framing.</p>
          )}
          <Toggle id="autocrop" checked={s.autocrop} onChange={(v) => updateSettings({ autocrop: v, manualBox: null })}
            help="Frames the part of the clip that stands out. Turn off to use the whole picture.">Crop to the subject</Toggle>

          <div className="field">
            <label htmlFor="maxf">Frame limit</label>
            <input
              id="maxf"
              type="number"
              min={0}
              max={entry.source?.nSrc || 9999}
              value={s.maxFrames || ''}
              placeholder={`All ${entry.source?.nSrc ?? ''}`}
              onChange={(e) => updateSettings({ maxFrames: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
            <p className="help">Keeps this many evenly spaced frames. Leave empty to keep all.</p>
          </div>

          {entry.source?.hasAlpha && (
            <Seg id="bg" label="Transparent pixels" value={s.background} options={[['black', 'Black'], ['white', 'White']]}
              onChange={(v) => updateSettings({ background: v })} />
          )}
        </>
      )}

      {r?.error && (
        <div className="note bad" role="alert">
          <p>{r.error}</p>
          {r.suggestMaxFrames > 0 && (
            <button type="button" className="btn small" onClick={() => updateSettings({ maxFrames: r.suggestMaxFrames })}>
              Limit to {r.suggestMaxFrames} frames
            </button>
          )}
        </div>
      )}

      {busy && (
        <p className="working" role="status">
          {entry.status === 'loading' ? 'Reading frames' : 'Converting'}
          {entry.progress ? ` ${Math.round(entry.progress * 100)}%` : ''}
        </p>
      )}

      <Stats entry={entry} />

      {entry.kind === 'clip' && r && (
        <div className="cli">
          <span className="label">Python script</span>
          {pythonCompatible(s, entry.source?.hasAlpha) ? (
            <>
              <p className="help">These settings give the same file with gif2mochi.py:</p>
              <div className="cli-row">
                <code>{cliCommand(entry.fileName, entry.sym, label, { ...s, threshold: r.threshold })}</code>
                <CopyButton text={cliCommand(entry.fileName, entry.sym, label, { ...s, threshold: r.threshold })} />
              </div>
            </>
          ) : (
            <>
              <p className="help">The colour, cleanup and fit tools are not in gif2mochi.py. To get output it can reproduce, switch back to its behaviour.</p>
              <button type="button" className="btn small" onClick={() => updateSettings({
                ...PYTHON_SETTINGS,
                denoise: s.denoise === 'off' ? 'off' : 'light',
                background: 'black',
              })}>Use Python script settings</button>
            </>
          )}
        </div>
      )}

      <button type="button" className="btn ghost danger" onClick={onRemove}>Remove {label.trim()}</button>
    </aside>
  );
}
