/**
 * templates.js — Built-in photo-strip templates rendered as real frame
 * bitmaps. Each template is painted to a canvas (gradient border, rounded
 * inner panel, caption) with its photo slots punched out to transparency, so
 * a generated template is a drop-in replacement for an uploaded PNG: the
 * existing `composite()` (mode 'png') draws captured photos underneath and the
 * frame on top, and the transparent slots reveal the photos.
 *
 * Geometry mirrors the Claude Design "Strip" component so the preview, the
 * live strip, and the exported PNG all match.
 */

// --- Slot layout helpers (percentages of the inner panel) -------------------
function vSlots(n) {
  const pad = 6, gap = 4, side = 9;
  const h = (100 - 2 * pad - (n - 1) * gap) / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push({ l: side, t: pad + i * (h + gap), w: 100 - 2 * side, h });
  return out;
}

function gSlots(cols, rows) {
  const padX = 8, padY = 8, gx = 6, gy = 6;
  const w = (100 - 2 * padX - (cols - 1) * gx) / cols;
  const h = (100 - 2 * padY - (rows - 1) * gy) / rows;
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push({ l: padX + c * (w + gx), t: padY + r * (h + gy), w, h });
  return out;
}

export const TEMPLATES = {
  strip4: { id: 'strip4', name: 'Classic Strip', badge: '4 photos', accent: '#FF6B6B', accent2: '#FF9A5A', caption: 'Paktyur! ♥', ar: 0.46, slots: vSlots(4) },
  grid4:  { id: 'grid4',  name: 'Party Grid',    badge: '4 photos', accent: '#BFA2FF', accent2: '#8EC5FC', caption: '♡ Paktyur! ♡', ar: 1.02, slots: gSlots(2, 2) },
  duo:    { id: 'duo',    name: 'Best Duo',      badge: '2 photos', accent: '#6FE7DD', accent2: '#4FC3B5', caption: 'Paktyur!', ar: 0.78, slots: vSlots(2) },
  trio:   { id: 'trio',   name: 'Triple Fun',    badge: '3 photos', accent: '#FFC93D', accent2: '#FF9A5A', caption: 'Paktyur! ✨', ar: 0.52, slots: vSlots(3) },
};

export const TEMPLATE_ORDER = ['strip4', 'grid4', 'duo', 'trio'];

/** Compute pixel geometry for a template at output width `W`. */
function geometry(tpl, W) {
  const pad = Math.round(W * 0.06);
  const innerW = W - 2 * pad;
  const innerH = Math.round(innerW / (tpl.ar || 0.46));
  const capH = Math.round(W * 0.15);
  const H = innerH + 2 * pad + capH;
  const rad = Math.max(6, Math.round(W * 0.032));
  return { pad, innerW, innerH, capH, H, rad };
}

/** Convert a template's percentage slots to pixel placeholder rects. */
function slotRects(tpl, geom) {
  const { pad, innerW, innerH } = geom;
  return tpl.slots.map((s, i) => {
    const x = Math.round(pad + (s.l / 100) * innerW);
    const y = Math.round(pad + (s.t / 100) * innerH);
    const width = Math.round((s.w / 100) * innerW);
    const height = Math.round((s.h / 100) * innerH);
    return {
      x, y, width, height,
      centerX: x + width / 2,
      centerY: y + height / 2,
      area: width * height,
      pixelCount: width * height,
      id: i,
      seq: i + 1,
    };
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paint the frame chrome (gradient, inner panel, caption) — no slots. */
function paintFrame(ctx, tpl, W, geom) {
  const { pad, innerW, innerH, capH, H, rad } = geom;
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, tpl.accent);
  g.addColorStop(1, tpl.accent2 || tpl.accent);
  ctx.fillStyle = g;
  roundRectPath(ctx, 0, 0, W, H, Math.round(W * 0.09));
  ctx.fill();

  ctx.fillStyle = '#FFFDF9';
  roundRectPath(ctx, pad, pad, innerW, innerH, Math.round(rad * 1.1));
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.max(11, Math.round(W * 0.06))}px Fredoka, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tpl.caption || 'Paktyur!', W / 2, innerH + 2 * pad + capH / 2);
}

/**
 * Render a template to a real ImageBitmap with transparent photo slots.
 * @returns {Promise<{bitmap: ImageBitmap, size: {width, height}, placeholders: Array}>}
 */
export async function renderTemplate(id, W = 900) {
  const tpl = typeof id === 'string' ? TEMPLATES[id] : id;
  if (!tpl) throw new Error(`Unknown template: ${id}`);
  const geom = geometry(tpl, W);
  const placeholders = slotRects(tpl, geom);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = geom.H;
  const ctx = canvas.getContext('2d');
  paintFrame(ctx, tpl, W, geom);

  // Punch the slots to transparency so composited photos show through.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  placeholders.forEach((ph) => {
    roundRectPath(ctx, ph.x, ph.y, ph.width, ph.height, geom.rad);
    ctx.fill();
  });
  ctx.restore();

  const bitmap = await createImageBitmap(canvas);
  return { bitmap, size: { width: W, height: geom.H }, placeholders };
}

/**
 * Paint a card-sized preview into an existing canvas: the frame plus numbered
 * slot outlines (slots stay visible, not punched). Used by the chooser grid.
 */
export function paintCardPreview(canvas, id, W = 150) {
  const tpl = typeof id === 'string' ? TEMPLATES[id] : id;
  const geom = geometry(tpl, W);
  canvas.width = W;
  canvas.height = geom.H;
  const ctx = canvas.getContext('2d');
  paintFrame(ctx, tpl, W, geom);
  const placeholders = slotRects(tpl, geom);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  placeholders.forEach((ph) => {
    ctx.fillStyle = 'rgba(0,0,0,.035)';
    roundRectPath(ctx, ph.x, ph.y, ph.width, ph.height, geom.rad);
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,.18)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.font = `700 ${Math.max(12, Math.round(ph.height * 0.4))}px Fredoka, sans-serif`;
    ctx.fillText(String(ph.seq), ph.centerX, ph.centerY);
  });
  ctx.restore();
}
