// A small built-in animation (a bouncing, blinking mochi) so first-time
// visitors can try every tool without having a GIF at hand. It is drawn as a
// numbered PNG sequence and goes through the same pipeline as a real upload.

const W = 256;
const H = 128;
const FRAMES = 16;

function drawFrame(ctx, i) {
  const t = i / FRAMES;
  const hop = Math.abs(Math.sin(t * Math.PI * 2)); // two hops per loop
  const squash = hop < 0.18 ? 1 - hop / 0.18 : 0; // flattens as it lands
  const bw = 78 * (1 + squash * 0.16);
  const bh = 58 * (1 - squash * 0.2);
  const ground = 112;
  const cx = W / 2;
  const cy = ground - bh / 2 - hop * 34;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // shadow shrinks while the mochi is in the air
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, ground + 6, 46 - hop * 18, 4, 0, 0, Math.PI * 2);
  ctx.stroke();

  // body: a soft dome with a flat base
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - bw / 2, cy + bh / 2);
  ctx.bezierCurveTo(cx - bw / 2 - 6, cy - bh * 0.9, cx + bw / 2 + 6, cy - bh * 0.9, cx + bw / 2, cy + bh / 2);
  ctx.closePath();
  ctx.fill();

  // face
  const blink = i === 11 || i === 12;
  const ey = cy + bh * 0.02;
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  for (const dx of [-16, 16]) {
    ctx.beginPath();
    if (blink) {
      ctx.moveTo(cx + dx - 5, ey);
      ctx.lineTo(cx + dx + 5, ey);
      ctx.stroke();
    } else {
      ctx.arc(cx + dx, ey, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.moveTo(cx - 6, ey + 11);
  ctx.quadraticCurveTo(cx - 3, ey + 15, cx, ey + 11);
  ctx.quadraticCurveTo(cx + 3, ey + 15, cx + 6, ey + 11);
  ctx.stroke();
}

/** Resolves with PNG files named mochi_00.png, mochi_01.png, … */
export async function sampleFrames() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const files = [];
  for (let i = 0; i < FRAMES; i++) {
    drawFrame(ctx, i);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    files.push(new File([blob], `mochi_${String(i).padStart(2, '0')}.png`, { type: 'image/png' }));
  }
  return files;
}
