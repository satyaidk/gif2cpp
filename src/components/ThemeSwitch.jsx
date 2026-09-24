import { useEffect, useRef, useState } from 'react';

// index.html reads the same key before first paint, so there is no flash.
const KEY = 'gif2mochi-theme';
const ICONS = {
  light: <path d="M8 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM8 0v2.5M8 13.5V16M0 8h2.5M13.5 8H16M2.3 2.3l1.8 1.8M11.9 11.9l1.8 1.8M2.3 13.7l1.8-1.8M11.9 4.1l1.8-1.8" />,
  dark: <path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" />,
  system: <path d="M1.5 2.5h13v8.5h-13zM5.5 14h5M8 11v3" />,
};
const MODES = [
  ['light', 'Light', 'Always light'],
  ['dark', 'Dark', 'Always dark'],
  ['system', 'System', 'Match your device'],
];

function readTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const Icon = ({ mode }) => <svg viewBox="0 0 16 16" aria-hidden="true">{ICONS[mode]}</svg>;

export function ThemeSwitch() {
  const [theme, setTheme] = useState(readTheme);
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  const items = useRef([]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // storage blocked: the choice still applies for this visit
    }
  }, [theme]);

  // close on a click outside; focus the current option when the menu opens
  useEffect(() => {
    if (!open) return undefined;
    items.current[MODES.findIndex(([v]) => v === theme)]?.focus();
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setOpen(false); button.current?.focus(); };
  const pick = (value) => { setTheme(value); close(); };

  const onMenuKey = (e) => {
    const i = items.current.indexOf(document.activeElement);
    const go = (j) => { e.preventDefault(); items.current[(j + MODES.length) % MODES.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(MODES.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const current = MODES.find(([v]) => v === theme);

  return (
    <div className="theme" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="btn icon theme-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${current[1]}`}
        title={`Theme: ${current[1]}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
      >
        <Icon mode={theme} />
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Theme" onKeyDown={onMenuKey}>
          {MODES.map(([value, name, help], i) => (
            <button
              key={value}
              ref={(el) => { items.current[i] = el; }}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              tabIndex={-1}
              onClick={() => pick(value)}
            >
              <Icon mode={value} />
              <span className="theme-name">{name}<small>{help}</small></span>
              <svg className="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
