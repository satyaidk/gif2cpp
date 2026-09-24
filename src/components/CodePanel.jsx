import { useMemo, useState } from 'react';
import { CopyButton } from './CopyButton.jsx';
import { saveText } from '../lib/exporter.js';

const MAX_LINES = 220;

function Code({ text }) {
  const { lines, more } = useMemo(() => {
    const all = text.split('\n');
    return { lines: all.slice(0, MAX_LINES), more: Math.max(0, all.length - MAX_LINES) };
  }, [text]);
  return (
    <pre className="code" tabIndex={0}>
      {lines.map((l, i) => {
        const t = l.trimStart();
        const cls = t.startsWith('//') ? 'c-com' : t.startsWith('#') ? 'c-pre' : '';
        return <span key={i} className={`ln ${cls}`}>{l}{'\n'}</span>;
      })}
      {more > 0 && <span className="c-more">{`… ${more.toLocaleString()} more lines. Copy or download to get the whole file.`}</span>}
    </pre>
  );
}

/** files: [{ name, text, hint }] */
export function CodePanel({ files }) {
  const [active, setActive] = useState(0);
  const i = Math.min(active, files.length - 1);
  const file = files[i];

  return (
    <section className="code-panel" aria-label="Generated code">
      <div className="code-head">
        <div className="tabs" role="tablist" aria-label="Files">
          {files.map((f, k) => (
            <button key={f.name + k} type="button" role="tab" aria-selected={k === i} className="tab" onClick={() => setActive(k)}>
              {f.name}
            </button>
          ))}
        </div>
        {file?.text && (
          <div className="code-actions">
            <span className="size">{(new Blob([file.text]).size / 1024).toFixed(1)} KB</span>
            <CopyButton text={file.text} />
            <button type="button" className="btn small" onClick={() => saveText(file.text, file.name)}>Download</button>
          </div>
        )}
      </div>
      {file?.hint && <p className="code-hint">{file.hint}</p>}
      {file?.text ? <Code key={file.name} text={file.text} /> : <p className="code-empty">{file?.empty}</p>}
    </section>
  );
}
