import JSZip from 'jszip';
import { budget, cliCommand, effectiveLabel, headerText, pythonCompatible, registryText } from './mochi.js';
import { playerSketch, readme } from './sketch.js';

/** Registry rows in ANIMS order. Entries whose conversion failed are left out. */
export function registryRows(entries) {
  return entries
    .filter((e) => e.kind === 'missing' || e.result?.blob && !e.result.error)
    .map((e) => ({ sym: e.sym, label: effectiveLabel(e.sym, e.label) }));
}

/** anim_<sym>.h for one entry, or null when there is nothing to write. */
export function entryHeader(e) {
  if (e.kind === 'imported') return e.headerText;
  if (!e.result || e.result.error) return null;
  const r = e.result;
  return headerText(e.sym, effectiveLabel(e.sym, e.label), r.blob, r.offsets, r.nFrames);
}

export function budgetFor(entries) {
  const counted = entries.filter((e) => e.result && !e.result.error);
  return budget(counted.map((e) => ({ bytes: e.result.blob.length, frames: e.result.nFrames })));
}

export function sketchFor(entries) {
  return playerSketch(entries
    .filter((e) => e.kind === 'missing' || (e.result && !e.result.error))
    .map((e) => ({ label: effectiveLabel(e.sym, e.label), frameMs: e.frameMs || 50 })));
}

export async function buildZip(entries, { folder = 'MochiPlayer', withSketch = true } = {}) {
  const zip = new JSZip();
  const dir = zip.folder(folder);
  const written = [];
  for (const e of entries) {
    const text = entryHeader(e);
    if (text) {
      dir.file(`anim_${e.sym}.h`, text);
      written.push({
        sym: e.sym,
        label: effectiveLabel(e.sym, e.label),
        frames: e.result.nFrames,
        bytes: e.result.blob.length,
        // only clips processed the way the script does can be reproduced with it
        cli: e.kind === 'clip' && pythonCompatible(e.settings, e.source?.hasAlpha)
          ? cliCommand(e.fileName, e.sym, effectiveLabel(e.sym, e.label), { ...e.settings, threshold: e.result.threshold })
          : null,
      });
    }
  }
  dir.file('animations.h', registryText(registryRows(entries)));
  if (withSketch) dir.file(`${folder}.ino`, sketchFor(entries));
  dir.file('README.md', readme(written, folder, withSketch, budgetFor(entries)));
  return zip.generateAsync({ type: 'blob' });
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const saveText = (text, name) => saveBlob(new Blob([text], { type: 'text/plain' }), name);
