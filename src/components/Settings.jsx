import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS, MAX_BLOB, PYTHON_SETTINGS, capitalize, cleanLabel, cliCommand, effectiveLabel, pythonCompatible,
  symbolError,
} from '../lib/mochi.js';
import { CopyButton } from './CopyButton.jsx';

const COLORS = [
  ['smart', 'All colours', 'Every colour that differs from the background lights up, including red and blue.'],
  ['luma', 'Brightness', 'Only bright colours light up; red and blue come out dark. This is what gif2cpp.py does.'],
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
const FITS = [
  ['fill', 'Fill screen', 'Zooms in until the picture covers all 128×64 pixels. Edges that do not fit are cut off.'],
  ['stretch', 'Stretch', 'Squeezes the whole picture onto the screen with no bars. Shapes get distorted.'],
  ['python', 'Show all', 'Keeps a margin around the subject, so wide or tall clips get black bars. Same as the Python script.'],
];
const NOISE_NAMES = { off: 'no noise removal', gentle: 'gentle noise removal', light: 'median filter', strong: 'strong filter' };
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const nameOf = (list, v) => list.find(([k]) => k === v)?.[1] ?? v;

// Starting points for common kinds of clip. Each one only sets how the
// picture is drawn; the threshold, crop and frame limit stay as they are.
const LOOK_KEYS = ['colors', 'style', 'denoise', 'levels', 'deblur', 'detail', 'specks', 'steady'];
const pickLook = (s) => Object.fromEntries(LOOK_KEYS.map((k) => [k, s[k]]));
const PRESETS = [
  ['balanced', 'Balanced', 'Clean shapes with thin lines kept. Right for most cartoons, icons and faces.', pickLook(DEFAULT_SETTINGS)],
  ['photo', 'Photo', 'A dot pattern that shows shading. For photos, film clips and gradients.',
    { colors: 'smart', style: 'dither', denoise: 'gentle', levels: true, deblur: 30, detail: 0, specks: true, steady: true }],
  ['busy', 'Busy art', 'Draws only the edges, so colourful scenes with similar brightness stay readable.',
    { colors: 'smart', style: 'outline', denoise: 'gentle', levels: true, deblur: 0, detail: 0, specks: true, steady: true }],
  ['pixel', 'Pixel art', 'No smoothing or cleanup, so every hand-placed pixel survives.',
    { colors: 'smart', style: 'solid', denoise: 'off', levels: false, deblur: 0, detail: 0, specks: false, steady: false }],
];
const matchesLook = (s, look) => LOOK_KEYS.every((k) => s[k] === look[k]);
const sameSettings = (a, b) => Object.keys(DEFAULT_SETTINGS).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

function Presets({ s, onPick }) {
  const current = PRESETS.find(([, , , look]) => matchesLook(s, look));
  return (
    <div className="field">
      <span className="label" id="preset-label">Preset</span>
      <div className="presets" role="radiogroup" aria-labelledby="preset-label">
        {PRESETS.map(([id, name, , look]) => (
          <button key={id} type="button" role="radio" aria-checked={current?.[0] === id}
            className={`preset preset-${id}`} onClick={() => onPick(look)}>
            <i aria-hidden="true" />{name}
          </button>
        ))}
      </div>
      <p className="help">{current ? current[2] : 'Custom settings. Pick a preset to start again from a known look.'}</p>
    </div>
  );
}

// Which sections are open is remembered between visits.
const OPEN_KEY = 'gif2cpp-sections';
function readOpen() {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY)) || {};
  } catch {
    return {};
  }
}

function Section({ id, title, summary, defaultOpen = true, children }) {
  const [open, setOpen] = useState(() => readOpen()[id] ?? defaultOpen);
  const onToggle = (e) => {
    const next = e.currentTarget.open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [id]: next }));
    } catch {
      // storage blocked: the section still opens, it just is not remembered
    }
  };
  return (
    <details className="section" open={open} onToggle={onToggle}>
      <summary>
        <span className="section-title">{title}</span>
        {summary && <span className="section-summary">{summary}</span>}
        <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

/** A range input whose track fills up to the current value. */
function Range({ value, min, max, ...rest }) {
  const pct = ((value - min) / (max - min)) * 100;
  return <input type="range" min={min} max={max} value={value} style={{ '--fill': `${pct}%` }} {...rest} />;
}

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
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
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
        <p>Choose an animation to tune how it looks on the display: which pixels light up, how the picture is
          cleaned up and how it is framed.</p>
        <p className="help">Every change shows on the display straight away, so experiment freely.</p>
      </aside>
    );
  }

  const s = entry.settings;
  const r = entry.result;
  const label = effectiveLabel(entry.sym, entry.label);
  const busy = entry.status === 'loading' || entry.busy;
  const pyOk = pythonCompatible(s, entry.source?.hasAlpha);
  const cli = r ? cliCommand(entry.fileName, entry.sym, label, { ...s, threshold: r.threshold }) : '';

  return (
    <aside className="settings" aria-busy={busy}>
      <div className="settings-head">
        <h2>{label.trim()}</h2>
        {entry.kind === 'clip' && !sameSettings(s, DEFAULT_SETTINGS) && (
          <button type="button" className="btn small ghost" onClick={() => updateSettings({ ...DEFAULT_SETTINGS }, 0)}
            title="Go back to the default settings for this animation">
            Reset
          </button>
        )}
      </div>

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

      {busy && (
        <div className="working" role="status">
          <span>
            {entry.status === 'loading' ? 'Reading frames' : 'Converting'}
            {entry.progress ? ` ${Math.round(entry.progress * 100)}%` : ''}
          </span>
          <span className={`progress ${entry.progress ? '' : 'indeterminate'}`} aria-hidden="true">
            <i style={entry.progress ? { width: `${Math.round(entry.progress * 100)}%` } : undefined} />
          </span>
        </div>
      )}

      {entry.kind === 'clip' && <Presets s={s} onPick={(look) => updateSettings(look, 0)} />}

      <Section id="names" title="Names" summary={<code>{entry.sym}</code>} defaultOpen={false}>
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
      </Section>

      {entry.kind === 'clip' && (
        <>
          <Section
            id="picture"
            title="Picture"
            summary={`${nameOf(STYLES, s.style)}, ${s.autoThreshold ? 'automatic threshold' : `threshold ${s.threshold}`}${s.invert ? ', inverted' : ''}`}
          >
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
              <Range
                id="thr"
                min={0}
                max={254}
                value={s.autoThreshold && r ? r.threshold : s.threshold}
                onChange={(e) => updateSettings({ threshold: Number(e.target.value), autoThreshold: false })}
              />
              <div className="toggle inline">
                <input id="auto-thr" type="checkbox" role="switch" checked={s.autoThreshold}
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
              <Range id="detail" min={0} max={100} step={5} value={s.detail || 0}
                onChange={(e) => updateSettings({ detail: Number(e.target.value) })} />
              <p className="help">Keeps thin lines such as a nose, a mouth or eyelids, which would otherwise vanish when
                the picture is shrunk to 128×64. Raise it to show fainter lines, lower it if the picture gets busy.</p>
            </div>

            <Toggle id="invert" checked={s.invert} onChange={(v) => updateSettings({ invert: v })}
              help="Swaps lit and dark pixels.">Invert</Toggle>
          </Section>

          <Section
            id="cleanup"
            title="Cleanup"
            defaultOpen={false}
            summary={`${capitalize(NOISE_NAMES[s.denoise] || s.denoise)}${s.deblur ? `, blur fix ${s.deblur}%` : ''}`}
          >
            <Seg id="denoise" label="Noise removal" value={s.denoise} options={NOISE} onChange={(v) => updateSettings({ denoise: v })} />

            <div className="field">
              <label htmlFor="deblur">Fix blur <output htmlFor="deblur" className="num">{s.deblur ? `${s.deblur}%` : 'Off'}</output></label>
              <Range id="deblur" min={0} max={100} step={5} value={s.deblur}
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
          </Section>

          <Section
            id="framing"
            title="Framing"
            summary={`${s.manualBox ? 'Framed by hand' : nameOf(FITS, s.fit || 'fill')}${s.maxFrames ? `, ${s.maxFrames} frames` : ''}`}
          >
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
          </Section>
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

      {r && (
        <Section id="file" title="File size" summary={`${(r.blob.length / 1024).toFixed(1)} KB`}>
          <Stats entry={entry} />
        </Section>
      )}

      {entry.kind === 'clip' && r && (
        <Section id="python" title="Python script" defaultOpen={false} summary={pyOk ? 'Same output' : 'Uses web-only tools'}>
          <div className="cli">
            {pyOk ? (
              <>
                <p className="help">These settings give the same file with gif2cpp.py:</p>
                <div className="cli-row">
                  <code>{cli}</code>
                  <CopyButton text={cli} />
                </div>
              </>
            ) : (
              <>
                <p className="help">The colour, cleanup and fit tools are not in gif2cpp.py. To get output it can reproduce, switch back to its behaviour.</p>
                <button type="button" className="btn small" onClick={() => updateSettings({
                  ...PYTHON_SETTINGS,
                  denoise: s.denoise === 'off' ? 'off' : 'light',
                  background: 'black',
                })}>Use Python script settings</button>
              </>
            )}
          </div>
        </Section>
      )}

      <button type="button" className="btn ghost danger" onClick={onRemove}>Remove {label.trim()}</button>
    </aside>
  );
}
