// Checks that the web port writes the same files as reference/gif2mochi.py.
// Needs Python 3 with Pillow on PATH as `python`.  Run: npm run parity

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGif } from '../src/lib/decode.js';
import { createClip, processClip } from '../src/lib/pipeline.js';
import { DEFAULT_SETTINGS, PYTHON_SETTINGS, effectiveLabel, headerText, registryText } from '../src/lib/mochi.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'mochi-parity-'));
const gifs = join(work, 'gifs');
const pyOut = join(work, 'py');
const python = process.env.PYTHON || 'python';
mkdirSync(pyOut, { recursive: true });

const CASES = [
  { file: 'ball.gif', sym: 'ball', label: 'Ball', args: [], s: {} },
  { file: 'tiny.gif', sym: 'tiny', label: '', args: [], s: {} },
  { file: 'tall.gif', sym: 'tall', label: 'Tall one', args: ['--threshold', '90'], s: { threshold: 90 } },
  { file: 'light.gif', sym: 'light', label: 'Light', args: ['--invert', '--threshold', '130'], s: { invert: true, threshold: 130 } },
  { file: 'waves.gif', sym: 'waves', label: 'Waves', args: ['--max-frames', '37'], s: { maxFrames: 37 } },
  { file: 'ball.gif', sym: 'ballraw', label: 'Raw ball', args: ['--no-autocrop', '--no-denoise'], s: { autocrop: false, denoise: false } },
];

execFileSync(python, [join(root, 'scripts', 'make_test_gifs.py'), gifs], { stdio: 'inherit' });

const norm = (s) => s.replace(/\r\n/g, '\n');
let failures = 0;
const rows = [];

for (const c of CASES) {
  const pyArgs = [join(root, 'reference', 'gif2mochi.py'), join(gifs, c.file), c.sym];
  if (c.label) pyArgs.push(c.label);
  execFileSync(python, [...pyArgs, '--outdir', pyOut, ...c.args], { stdio: 'pipe' });
  const expected = norm(readFileSync(join(pyOut, `anim_${c.sym}.h`), 'utf8'));

  const clip = createClip(decodeGif(new Uint8Array(readFileSync(join(gifs, c.file)))));
  const r = processClip(clip, { ...DEFAULT_SETTINGS, ...PYTHON_SETTINGS, autoThreshold: false, denoise: 'light', ...c.s });
  const label = effectiveLabel(c.sym, c.label);
  const actual = headerText(c.sym, label, r.blob, r.offsets, r.nFrames);
  rows.push({ sym: c.sym, label });

  if (actual === expected) {
    console.log(`PASS  ${c.sym.padEnd(8)} ${r.nFrames} frames, ${r.blob.length} bytes, box ${r.box}`);
  } else {
    failures++;
    const a = actual.split('\n');
    const e = expected.split('\n');
    const line = a.findIndex((l, i) => l !== e[i]);
    console.log(`FAIL  ${c.sym}: first difference at line ${line + 1}`);
    console.log(`  python: ${e[line]?.slice(0, 120)}`);
    console.log(`  web:    ${a[line]?.slice(0, 120)}`);
  }
}

const regExpected = norm(readFileSync(join(pyOut, 'animations.h'), 'utf8'));
if (registryText(rows) === regExpected) console.log('PASS  animations.h');
else { failures++; console.log('FAIL  animations.h differs'); }

rmSync(work, { recursive: true, force: true });
console.log(failures ? `\n${failures} mismatch(es)` : '\nAll outputs identical to the Python script.');
process.exit(failures ? 1 : 0);
