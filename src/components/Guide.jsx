import { useEffect, useRef, useState } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS = [
  [['Space'], 'Play or pause the preview'],
  [['←', '→'], 'Step one frame back or forward'],
  [['Shift', '←'], 'Jump ten frames'],
  [['['], 'Select the previous animation'],
  [[']'], 'Select the next animation'],
  [[MOD, 'O'], 'Choose GIFs to add'],
  [[MOD, 'S'], 'Download all files (.zip)'],
  [['?'], 'Open this guide'],
];

const WIRING = [
  ['GND', 'GND', 'GND'],
  ['VCC', '3V3', '5V or 3.3V'],
  ['SCL', 'GPIO 22', 'A5'],
  ['SDA', 'GPIO 21', 'A4'],
];

function Steps() {
  return (
    <ol className="guide-steps">
      <li>
        <h3>Convert your GIFs</h3>
        <p>Drop GIFs anywhere on the page. Check each one on the display preview and adjust it until it reads well at
          128×64. A preset is the quickest way to start.</p>
      </li>
      <li>
        <h3>Download the files</h3>
        <p>Download all files (.zip) and unzip it. The <code>MochiPlayer</code> folder is a ready-made Arduino sketch
          with every animation header inside.</p>
      </li>
      <li>
        <h3>Install two libraries</h3>
        <p>In the Arduino IDE open Library Manager and install <strong>Adafruit SSD1306</strong> and <strong>Adafruit GFX
          Library</strong>.</p>
      </li>
      <li>
        <h3>Wire the display</h3>
        <table className="wiring">
          <thead>
            <tr><th scope="col">Display</th><th scope="col">ESP32</th><th scope="col">Arduino Uno</th></tr>
          </thead>
          <tbody>
            {WIRING.map(([pin, esp, uno]) => (
              <tr key={pin}><th scope="row"><code>{pin}</code></th><td>{esp}</td><td>{uno}</td></tr>
            ))}
          </tbody>
        </table>
      </li>
      <li>
        <h3>Upload</h3>
        <p>Open <code>MochiPlayer.ino</code>, pick your board and port, and upload. If the screen stays dark, try
          changing <code>OLED_ADDR</code> from <code>0x3C</code> to <code>0x3D</code>. If the sketch is too big for an
          ESP32, choose Tools, Partition Scheme, Huge APP.</p>
      </li>
    </ol>
  );
}

function Shortcuts() {
  return (
    <dl className="shortcuts">
      {SHORTCUTS.map(([keys, what]) => (
        <div key={what}>
          <dt>{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Guide({ open, onClose }) {
  const ref = useRef(null);
  const [tab, setTab] = useState('start');

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Every way of closing goes through the app's state, so it can never
  // disagree with the dialog. Escape is caught at 'cancel', which fires
  // straight away; 'close' can lag behind until the next frame.
  useEffect(() => {
    const d = ref.current;
    const cancel = (e) => { e.preventDefault(); onCloseRef.current(); };
    const closed = () => onCloseRef.current();
    d.addEventListener('cancel', cancel);
    d.addEventListener('close', closed);
    return () => {
      d.removeEventListener('cancel', cancel);
      d.removeEventListener('close', closed);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="guide"
      aria-labelledby="guide-title"
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="guide-inner">
        <header className="guide-head">
          <h2 id="guide-title">Guide</h2>
          <button type="button" className="btn icon tiny guide-close" onClick={onClose} aria-label="Close guide">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>
          </button>
        </header>
        <div className="seg guide-tabs" role="tablist" aria-label="Guide sections">
          <button type="button" role="tab" aria-selected={tab === 'start'} aria-checked={tab === 'start'} onClick={() => setTab('start')}>
            From GIF to display
          </button>
          <button type="button" role="tab" aria-selected={tab === 'keys'} aria-checked={tab === 'keys'} onClick={() => setTab('keys')}>
            Keyboard shortcuts
          </button>
        </div>
        <div className="guide-body" role="tabpanel">
          {tab === 'start' ? <Steps /> : <Shortcuts />}
        </div>
      </div>
    </dialog>
  );
}
