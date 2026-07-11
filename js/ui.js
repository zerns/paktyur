/**
 * ui.js — View layer. Owns screen switching, the JPG color picker + loupe,
 * the placeholder confirmation overlay, session status/progress, the countdown
 * animation, error banners, and the final output. Emits user intents via
 * callbacks; it holds no application state itself.
 */

import { OVERLAY_COLORS, MAX_COLOR_TOLERANCE } from './config.js';
import { $, clamp } from './utils.js';

export const SCREENS = ['upload', 'jpgpick', 'confirm', 'session', 'processing', 'output'];

export class UI {
  constructor() {
    this.el = {
      screens: {},
      // upload
      dropzone: $('#dropzone'),
      fileInput: $('#file-input'),
      // jpg pick
      pickCanvas: $('#pick-canvas'),
      loupe: $('#loupe'),
      toleranceSlider: $('#tolerance-slider'),
      toleranceValue: $('#tolerance-value'),
      pickedSwatch: $('#picked-swatch'),
      rerunBtn: $('#rerun-btn'),
      pickHint: $('#pick-hint'),
      // confirm
      confirmCanvas: $('#confirm-canvas'),
      summary: $('#detection-summary'),
      confirmBtn: $('#confirm-btn'),
      recolorBtn: $('#recolor-btn'),
      cancelBtn: $('#cancel-btn'),
      // session
      video: $('#camera-video'),
      overlayCanvas: $('#session-overlay'),
      camStatus: $('#cam-status'),
      micStatus: $('#mic-status'),
      triggerStatus: $('#trigger-status'),
      progress: $('#photo-progress'),
      cameraSelect: $('#camera-select'),
      manualBtn: $('#manual-capture-btn'),
      countdown: $('#countdown'),
      // output
      outputImg: $('#output-image'),
      downloadBtn: $('#download-btn'),
      printBtn: $('#print-btn'),
      againBtn: $('#again-btn'),
      newTemplateBtn: $('#new-template-btn'),
      // global
      errorBanner: $('#error-banner'),
      errorText: $('#error-text'),
      errorRetry: $('#error-retry'),
      errorDismiss: $('#error-dismiss'),
    };
    for (const name of SCREENS) this.el.screens[name] = $(`#screen-${name}`);
  }

  show(screen) {
    for (const name of SCREENS) {
      this.el.screens[name].hidden = name !== screen;
    }
  }

  // --- Error banner ---------------------------------------------------------
  showError(message, onRetry) {
    this.el.errorText.textContent = message;
    this.el.errorRetry.hidden = typeof onRetry !== 'function';
    this._retryHandler = onRetry || null;
    this.el.errorBanner.hidden = false;
  }

  hideError() {
    this.el.errorBanner.hidden = true;
    this._retryHandler = null;
  }

  // --- JPG color picker + loupe --------------------------------------------
  /** Render the template into the pick canvas and return its 2D context. */
  renderPickCanvas(bitmap, width, height) {
    const c = this.el.pickCanvas;
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx;
  }

  /** Draw a magnified loupe around (canvasX, canvasY) in source pixels. */
  drawLoupe(pickCtx, canvasX, canvasY) {
    const loupe = this.el.loupe;
    const size = loupe.width; // square
    const zoom = 8;
    const src = size / zoom;
    const lctx = loupe.getContext('2d');
    lctx.imageSmoothingEnabled = false;
    lctx.clearRect(0, 0, size, size);
    lctx.drawImage(
      pickCtx.canvas,
      clamp(canvasX - src / 2, 0, pickCtx.canvas.width - src),
      clamp(canvasY - src / 2, 0, pickCtx.canvas.height - src),
      src, src,
      0, 0, size, size
    );
    // Crosshair.
    lctx.strokeStyle = '#fff';
    lctx.lineWidth = 1;
    lctx.strokeRect(size / 2 - zoom / 2, size / 2 - zoom / 2, zoom, zoom);
    loupe.hidden = false;
  }

  hideLoupe() {
    this.el.loupe.hidden = true;
  }

  setPickedColor([r, g, b]) {
    this.el.pickedSwatch.style.background = `rgb(${r},${g},${b})`;
    this.el.pickedSwatch.textContent = `rgb(${r}, ${g}, ${b})`;
  }

  setTolerance(value) {
    this.el.toleranceSlider.value = String(value);
    this.el.toleranceSlider.max = String(MAX_COLOR_TOLERANCE);
    this.el.toleranceValue.textContent = String(value);
  }

  // --- Confirmation overlay -------------------------------------------------
  /** Draw the template plus numbered overlays for detected placeholders. */
  renderConfirm(bitmap, width, height, result) {
    const c = this.el.confirmCanvas;
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const fontSize = Math.max(20, Math.round(width / 30));
    result.valid.forEach((ph, i) => {
      const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length];
      ctx.save();
      ctx.fillStyle = hexToRgba(color, 0.28);
      ctx.fillRect(ph.x, ph.y, ph.width, ph.height);
      ctx.lineWidth = Math.max(3, Math.round(width / 400));
      ctx.strokeStyle = color;
      ctx.strokeRect(ph.x, ph.y, ph.width, ph.height);
      // Sequence badge.
      ctx.fillStyle = color;
      const badge = fontSize * 1.4;
      ctx.fillRect(ph.x, ph.y, badge, badge);
      ctx.fillStyle = '#000';
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ph.seq), ph.x + badge / 2, ph.y + badge / 2);
      ctx.restore();
    });

    this._renderSummary(result);
  }

  _renderSummary(result) {
    const rejectedList = result.rejected
      .map((r) => `<li>#${r.id + 1}: ${r.reason} (${r.width}×${r.height})</li>`)
      .join('');
    this.el.summary.innerHTML = `
      <p><strong>${result.total}</strong> region(s) detected —
         <strong>${result.valid.length}</strong> valid,
         <strong>${result.rejected.length}</strong> rejected.</p>
      ${result.rejected.length ? `<details><summary>Rejected regions</summary><ul>${rejectedList}</ul></details>` : ''}
    `;
  }

  /** Toggle JPG-only re-pick controls in the confirm screen. */
  setConfirmMode(mode) {
    this.el.recolorBtn.hidden = mode !== 'jpg';
  }

  // --- Session --------------------------------------------------------------
  setCameraStatus(text, ok) {
    this.el.camStatus.textContent = `Camera: ${text}`;
    this.el.camStatus.dataset.ok = ok ? 'yes' : 'no';
  }

  setMicStatus(text, ok) {
    this.el.micStatus.textContent = `Mic: ${text}`;
    this.el.micStatus.dataset.ok = ok ? 'yes' : 'no';
  }

  setTriggerStatus(text) {
    this.el.triggerStatus.textContent = text;
  }

  setProgress(current, total) {
    this.el.progress.textContent = `Photo ${current} of ${total}`;
  }

  showManualButton(show) {
    this.el.manualBtn.hidden = !show;
  }

  populateCameras(cameras, activeId) {
    const sel = this.el.cameraSelect;
    sel.innerHTML = '';
    cameras.forEach((cam, i) => {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Camera ${i + 1}`;
      if (cam.deviceId === activeId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.hidden = cameras.length < 2;
  }

  /**
   * Draw the placeholder guide overlay onto the live preview, highlighting the
   * next placeholder and dimming the rest. Coordinates are in template space
   * and scaled to the overlay canvas (which mirrors the video box).
   */
  renderSessionOverlay(placeholders, activeIndex, templateW, templateH) {
    const canvas = this.el.overlayCanvas;
    const rect = this.el.video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scale = Math.min(canvas.width / templateW, canvas.height / templateH);
    const ox = (canvas.width - templateW * scale) / 2;
    const oy = (canvas.height - templateH * scale) / 2;

    placeholders.forEach((ph, i) => {
      const x = ox + ph.x * scale;
      const y = oy + ph.y * scale;
      const w = ph.width * scale;
      const h = ph.height * scale;
      const active = i === activeIndex;
      ctx.save();
      ctx.globalAlpha = active ? 1 : 0.35;
      ctx.strokeStyle = active ? '#69f0ae' : '#888';
      ctx.lineWidth = active ? 4 : 2;
      ctx.strokeRect(x, y, w, h);
      if (!active && i < activeIndex) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    });
  }

  // --- Countdown ------------------------------------------------------------
  /**
   * Play the 3..2..1..CLICK! animation. Resolves when finished.
   * @param {number} start
   * @param {number} tickMs
   * @param {() => void} [onTick] fired each tick (for shutter sound etc.)
   */
  async playCountdown(start, tickMs, onTick) {
    const el = this.el.countdown;
    el.hidden = false;
    const steps = [];
    for (let n = start; n >= 1; n--) steps.push(String(n));
    steps.push('CLICK!');
    for (const s of steps) {
      el.textContent = s;
      el.classList.remove('pop');
      // force reflow to restart animation
      void el.offsetWidth;
      el.classList.add('pop');
      if (onTick) onTick(s);
      await new Promise((r) => setTimeout(r, tickMs));
    }
    el.hidden = true;
  }

  // --- Output ---------------------------------------------------------------
  setOutputImage(url) {
    this.el.outputImg.src = url;
  }
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
