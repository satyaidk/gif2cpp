// Runs decoding and encoding off the main thread so the page stays responsive.
import { decodeFile, decodeSequence } from './lib/decode.js';
import { createClip, processClip, sourceFrame } from './lib/pipeline.js';

const clips = new Map(); // id -> clip
const latest = new Map(); // id -> newest process reqId

const reply = (reqId, data, transfer = []) => self.postMessage({ reqId, ...data }, transfer);
const fail = (reqId, err) => reply(reqId, { failed: err?.message || String(err) });

async function load({ reqId, id, files, sequence }) {
  const decoded = sequence ? await decodeSequence(files) : await decodeFile(files[0]);
  const clip = createClip(decoded);
  clips.set(id, clip);
  const delays = clip.frames.map((f) => f.delay);
  reply(reqId, {
    width: clip.width,
    height: clip.height,
    nSrc: clip.frames.length,
    hasAlpha: clip.hasAlpha,
    avgDelay: delays.reduce((a, b) => a + b, 0) / delays.length,
    note: decoded.note,
  });
}

function process({ reqId, id, settings }) {
  if (latest.get(id) !== reqId) return reply(reqId, { stale: true });
  const clip = clips.get(id);
  if (!clip) return fail(reqId, 'Clip is no longer loaded.');
  const r = processClip(clip, settings, (done, total) => {
    self.postMessage({ type: 'progress', id, done, total });
  });
  reply(reqId, r, [r.bits.buffer, r.blob.buffer]);
}

function source({ reqId, id, index, settings }) {
  const clip = clips.get(id);
  if (!clip) return fail(reqId, 'Clip is no longer loaded.');
  const rgb = sourceFrame(clip, index, settings).slice();
  reply(reqId, { rgb, width: clip.width, height: clip.height }, [rgb.buffer]);
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') await load(m);
    else if (m.type === 'process') {
      // Let queued messages arrive first; only the newest request per clip runs.
      latest.set(m.id, m.reqId);
      setTimeout(() => {
        try { process(m); } catch (err) { fail(m.reqId, err); }
      }, 0);
    } else if (m.type === 'source') source(m);
    else if (m.type === 'drop') { clips.delete(m.id); latest.delete(m.id); }
  } catch (err) {
    fail(m.reqId, err);
  }
};
