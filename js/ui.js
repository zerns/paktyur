/**
 * ui.js — View layer. Owns screen switching, the JPG color picker + loupe,
 * the placeholder confirmation overlay, session status/progress, the countdown
 * animation, error banners, and the final output — plus the "Paktyur!" visual
 * chrome: stepper, floating decoration, trigger pills, toasts, confetti, and
 * the rotating processing captions. Emits user intents via callbacks; it
 * holds no application state itself.
 */

import {
  OVERLAY_COLORS,
  MAX_COLOR_TOLERANCE,
  PROCESSING_MESSAGES,
  PROCESSING_TICK_MS,
  DECO_EMOJI,
  DECO_COUNT_MIN,
  DECO_COUNT_MAX,
  DECO_VISIBLE_MS_MIN,
  DECO_VISIBLE_MS_MAX,
  DECO_GAP_MS_MIN,
  DECO_GAP_MS_MAX,
  DECO_FADE_MS,
} from './config.js?v=bb46100c';
import { $, clamp } from './utils.js?v=bb46100c';
import { TEMPLATES, TEMPLATE_ORDER, paintCardPreview } from './templates.js?v=bb46100c';

export const SCREENS = ['upload', 'jpgpick', 'confirm', 'session', 'processing', 'output'];
const ALL_SCREENS = ['welcome', ...SCREENS];

const STEP_DEFS = [
  { key: 'upload', label: 'Template' },
  { key: 'confirm', label: 'Preview' },
  { key: 'session', label: 'Capture' },
  { key: 'processing', label: 'Processing' },
  { key: 'output', label: 'Done' },
];

const TRIGGER_META = {
  voice: { icon: '🎙️' },
  gesture: { icon: '✌️' },
  manual: { icon: '👆' },
};

export class UI {
  constructor() {
    this.el = {
      screens: {},
      // chrome
      stepper: $('#stepper'),
      decoLayer: $('#deco-layer'),
      toast: $('#toast'),
      toastMessage: $('#toast-message'),
      toastClose: $('#toast-close'),
      // welcome
      heroStartBtn: $('#hero-start-btn'),
      // template / upload
      templateGrid: $('#template-grid'),
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
      camDot: $('#cam-dot'),
      camStatusText: $('#cam-status-text'),
      micStatus: $('#mic-status'),
      triggerRow: $('#trigger-row'),
      triggerIcon: $('#trigger-icon'),
      triggerStatus: $('#trigger-status'),
      triggerHint: $('#trigger-hint'),
      progress: $('#photo-progress'),
      cameraSelect: $('#camera-select'),
      manualBtn: $('#manual-capture-btn'),
      countdown: $('#countdown'),
      cameraFlash: $('#camera-flash'),
      stageReady: $('#stage-ready'),
      zoomPanel: $('#zoom-panel'),
      zoomOutBtn: $('#zoom-out-btn'),
      zoomInBtn: $('#zoom-in-btn'),
      zoomResetBtn: $('#zoom-reset-btn'),
      zoomSlider: $('#zoom-slider'),
      zoomValue: $('#zoom-value'),
      zoomHint: $('#zoom-hint'),
      stripPreview: $('#strip-preview'),
      filledLabel: $('#filled-label'),
      // processing
      processingCaption: $('#processing-caption'),
      procBarFill: $('#proc-bar-fill'),
      // output
      outputImg: $('#output-image'),
      downloadBtn: $('#download-btn'),
      againBtn: $('#again-btn'),
      newTemplateBtn: $('#new-template-btn'),
      copyLinkBtn: $('#copy-link-btn'),
      confetti: $('#confetti'),
    };
    for (const name of ALL_SCREENS) this.el.screens[name] = $(`#screen-${name}`);
    this.el.toastClose.addEventListener('click', () => this.hideToast());
    this._toastTimer = null;
    this._confettiRaf = null;
    this._procTimer = null;
    this._decoTimer = null;
  }

  show(screen) {
    for (const name of ALL_SCREENS) {
      this.el.screens[name].hidden = name !== screen;
    }
  }

  // --- Stepper ----------------------------------------------------------------
  renderStepper(currentScreen) {
    if (currentScreen === 'welcome') {
      this.el.stepper.hidden = true;
      return;
    }
    this.el.stepper.hidden = false;
    const stepKey = currentScreen === 'jpgpick' ? 'upload' : currentScreen;
    const cur = STEP_DEFS.findIndex((def) => def.key === stepKey);
    this.el.stepper.innerHTML = '';
    STEP_DEFS.forEach((def, i) => {
      const done = i < cur;
      const active = i === cur;
      const dot = document.createElement('span');
      dot.className = 'step-dot' + (done ? ' done' : active ? ' active' : '');
      dot.textContent = done ? '✓' : String(i + 1);
      const label = document.createElement('span');
      label.className = 'step-label' + (done ? ' done' : active ? ' active' : '');
      label.textContent = def.label;
      this.el.stepper.appendChild(dot);
      this.el.stepper.appendChild(label);
      if (i < STEP_DEFS.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'step-sep' + (done ? ' done' : '');
        this.el.stepper.appendChild(sep);
      }
    });
  }

  // --- Template chooser -----------------------------------------------------
  /**
   * Build the built-in template cards and insert them before the upload
   * dropzone. `onSelect(id)` fires when a card is clicked.
   */
  renderTemplateCards(onSelect) {
    const grid = this.el.templateGrid;
    const dropzone = this.el.dropzone;
    // Remove any previously injected cards (keep the dropzone).
    grid.querySelectorAll('.template-card.builtin').forEach((n) => n.remove());
    TEMPLATE_ORDER.forEach((id) => {
      const tpl = TEMPLATES[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'template-card builtin';
      card.dataset.template = id;
      const canvas = document.createElement('canvas');
      canvas.className = 'template-card-preview';
      paintCardPreview(canvas, id, 150);
      const name = document.createElement('span');
      name.className = 'template-card-name';
      name.textContent = tpl.name;
      const badge = document.createElement('span');
      badge.className = 'template-card-badge';
      badge.textContent = tpl.badge;
      card.append(canvas, name, badge);
      card.addEventListener('click', () => {
        this.setSelectedTemplate(id);
        onSelect(id);
      });
      grid.insertBefore(card, dropzone);
    });
  }

  /** Highlight the chosen card (or the upload card for 'custom'). */
  setSelectedTemplate(id) {
    const grid = this.el.templateGrid;
    grid.querySelectorAll('.template-card').forEach((c) => {
      const match = id === 'custom' ? c === this.el.dropzone : c.dataset.template === id;
      c.classList.toggle('selected', match);
    });
  }

  // --- Floating decoration ------------------------------------------------------
  startDeco() {
    const layer = this.el.decoLayer;
    if (!layer) return () => {};
    this._decoLayer = layer;
    this._decoTimeouts = [];
    this._decoActiveEmoji = new Set();
    this._decoQuadrants = [
      { left: [3, 15], top: [8, 45], name: 'tl' },
      { left: [80, 93], top: [8, 45], name: 'tr' },
      { left: [3, 15], top: [45, 82], name: 'bl' },
      { left: [80, 93], top: [45, 82], name: 'br' },
    ];
    for (let q = 0; q < 4; q++) {
      this._spawnDecoSlot(q, false);
    }
    this._spawnDecoFloaters();
    return () => this.stopDeco();
  }

  stopDeco() {
    this._decoTimeouts.forEach(t => clearTimeout(t));
    this._decoTimeouts = [];
    this._decoActiveEmoji.clear();
    if (this._decoLayer) this._decoLayer.innerHTML = '';
  }

  _spawnDecoSlot(quadrantIndex, isFloater) {
    if (!this._decoLayer) return;
    const quad = isFloater
      ? this._decoQuadrants[Math.floor(Math.random() * 4)]
      : this._decoQuadrants[quadrantIndex];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const emojiPool = DECO_EMOJI.filter(e => !this._decoActiveEmoji.has(e));
    if (emojiPool.length === 0) return;
    const emoji = emojiPool[Math.floor(Math.random() * emojiPool.length)];
    this._decoActiveEmoji.add(emoji);
    const left = rnd(quad.left[0], quad.left[1]);
    const top = rnd(quad.top[0], quad.top[1]);
    const size = rnd(28, 42) | 0;
    const dur = rnd(6, 11).toFixed(1);
    const delay = rnd(0, 1.4).toFixed(1);
    const rot = (rnd(-14, 14)) | 0;
    const span = document.createElement('span');
    span.textContent = emoji;
    span.dataset.decoEmoji = emoji;
    span.style.cssText =
      `--r:${rot}deg;left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;` +
      `font-size:${size}px;animation-duration:.6s,${dur}s;animation-delay:0s,${delay}s;`;
    this._decoLayer.appendChild(span);
    const visibleMs = rnd(DECO_VISIBLE_MS_MIN, DECO_VISIBLE_MS_MAX) | 0;
    const t = setTimeout(() => {
      this._despawnDecoSlot(span, quadrantIndex, isFloater);
    }, visibleMs);
    this._decoTimeouts.push(t);
  }

  _despawnDecoSlot(span, quadrantIndex, isFloater) {
    if (!this._decoLayer || !span.parentNode) return;
    const emoji = span.dataset.decoEmoji;
    span.classList.add('deco-fade');
    const t = setTimeout(() => {
      if (span.parentNode) span.remove();
      if (emoji) this._decoActiveEmoji.delete(emoji);
      const gapMs = (Math.random() * (DECO_GAP_MS_MAX - DECO_GAP_MS_MIN) + DECO_GAP_MS_MIN) | 0;
      const t2 = setTimeout(() => {
        this._spawnDecoSlot(quadrantIndex, isFloater);
      }, gapMs);
      this._decoTimeouts.push(t2);
    }, DECO_FADE_MS);
    this._decoTimeouts.push(t);
  }

  _spawnDecoFloaters() {
    const floaterCount = Math.floor(Math.random() * (DECO_COUNT_MAX - DECO_COUNT_MIN + 1) + DECO_COUNT_MIN) - 4;
    for (let i = 0; i < floaterCount; i++) {
      this._spawnDecoSlot(null, true);
    }
    const nextWaveMs = (Math.random() * (DECO_VISIBLE_MS_MAX - DECO_VISIBLE_MS_MIN) + DECO_VISIBLE_MS_MIN) | 0;
    const t = setTimeout(() => {
      this._spawnDecoFloaters();
    }, nextWaveMs);
    this._decoTimeouts.push(t);
  }

  // --- Toast ----------------------------------------------------------------------
  /**
   * Show a toast. Pass `{ persistent: true }` for errors that must stay
   * visible until the user dismisses them via the ✕ button (no auto-hide).
   */
  showToast(message, { persistent = false } = {}) {
    const t = this.el.toast;
    if (!t) return;
    clearTimeout(this._toastTimer);
    this.el.toastMessage.textContent = message;
    this.el.toastClose.hidden = !persistent;
    t.hidden = false;
    t.classList.remove('show', 'persistent');
    void t.offsetWidth; // restart animation
    if (persistent) {
      t.classList.add('persistent');
    } else {
      t.classList.add('show');
      this._toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
    }
  }

  hideToast() {
    clearTimeout(this._toastTimer);
    this.el.toast.hidden = true;
    this.el.toast.classList.remove('show', 'persistent');
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
    this.el.camStatusText.textContent = text;
    this.el.camDot.dataset.ok = ok ? 'yes' : 'no';
  }

  setMicStatus(text, ok) {
    this.el.micStatus.textContent = text ? `Mic: ${text}` : '';
    this.el.micStatus.dataset.ok = ok ? 'yes' : 'no';
  }

  setTriggerStatus(text) {
    this.el.triggerStatus.textContent = text;
  }

  setTriggerHint(text) {
    this.el.triggerHint.textContent = text || '';
    this.el.triggerHint.hidden = !text;
  }

  /** Update the big icon + active pill for the current trigger mode. */
  setTriggerMode(mode) {
    const meta = TRIGGER_META[mode];
    if (meta) this.el.triggerIcon.textContent = meta.icon;
    for (const pill of this.el.triggerRow.children) {
      pill.classList.toggle('active', pill.dataset.trigger === mode);
    }
  }

  /**
   * Enable/disable the trigger pills. `available` is a map like
   * { voice: bool, gesture: bool, manual: true }. Unavailable pills are
   * disabled so the user can only pick modes that will actually work.
   */
  setTriggerAvailability(available) {
    for (const pill of this.el.triggerRow.children) {
      const ok = !!available[pill.dataset.trigger];
      pill.disabled = !ok;
      pill.classList.toggle('unavailable', !ok);
    }
  }

  /** Show/hide the whole zoom control cluster based on camera capability. */
  setZoomAvailability(supported) {
    this.el.zoomPanel.hidden = !supported;
  }

  /** Enable/disable zoom controls — only interactive during idle SESSION. */
  setZoomInteractive(interactive) {
    this.el.zoomOutBtn.disabled = !interactive;
    this.el.zoomInBtn.disabled = !interactive;
    this.el.zoomResetBtn.disabled = !interactive;
    this.el.zoomSlider.disabled = !interactive;
    this.el.zoomPanel.classList.toggle('zoom-locked', !interactive);
  }

  /** Reflect current zoom value/range on the slider + label. */
  setZoomValue(value, caps) {
    const { min, max, step } = caps;
    this.el.zoomSlider.min = String(min);
    this.el.zoomSlider.max = String(max);
    this.el.zoomSlider.step = String(step || 0.1);
    this.el.zoomSlider.value = String(value);
    this.el.zoomValue.textContent = `${value.toFixed(1)}×`;
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
      ctx.strokeStyle = active ? '#FF6B6B' : '#fff';
      ctx.lineWidth = active ? 4 : 2;
      ctx.strokeRect(x, y, w, h);
      if (!active && i < activeIndex) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(x, y, w, h);
      }
      ctx.restore();
    });
  }

  /**
   * Render the small "Your strip" preview: the template thumbnail with each
   * placeholder shown as filled (captured), active (highlighted), or pending.
   */
  renderStripPreview(bitmap, templateW, templateH, placeholders, activeIndex) {
    const canvas = this.el.stripPreview;
    if (!canvas) return;
    const width = canvas.clientWidth || 150;
    const scale = width / templateW;
    canvas.width = width;
    canvas.height = Math.round(templateH * scale);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    placeholders.forEach((ph, i) => {
      const x = ph.x * scale;
      const y = ph.y * scale;
      const w = ph.width * scale;
      const h = ph.height * scale;
      const filled = i < activeIndex;
      const active = i === activeIndex;
      const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length];
      ctx.save();
      if (filled) {
        ctx.fillStyle = hexToRgba(color, 0.4);
        ctx.fillRect(x, y, w, h);
      }
      ctx.lineWidth = active ? 3 : 1.5;
      ctx.strokeStyle = active ? '#FF6B6B' : filled ? color : 'rgba(0,0,0,.25)';
      if (!filled && !active) ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    });

    const filled = Math.min(activeIndex, placeholders.length);
    this.el.filledLabel.textContent = `${filled} of ${placeholders.length} captured`;
  }

  // --- Countdown ------------------------------------------------------------
  /**
   * Play the 3..2..1..CLICK! animation. Resolves when finished.
   * @param {number} start
   * @param {number} tickMs
   * @param {() => void} [onTick] fired each tick (for shutter sound etc.)
   */
  async playCountdown(start, tickMs, onTick) {
    this.hideStageReady();
    const el = this.el.countdown;
    el.hidden = false;
    const steps = [];
    for (let n = start; n >= 1; n--) steps.push(String(n));
    for (const s of steps) {
      el.textContent = s;
      el.classList.remove('pop');
      // force reflow to restart animation
      void el.offsetWidth;
      el.classList.add('pop');
      if (onTick) onTick(s);
      await new Promise((r) => setTimeout(r, tickMs));
    }
    el.textContent = '';
    el.hidden = true;
    this.fireFlash();
  }

  fireFlash() {
    const flash = this.el.cameraFlash;
    if (!flash) return;
    flash.hidden = false;
    flash.classList.remove('fire');
    void flash.offsetWidth;
    flash.classList.add('fire');
    setTimeout(() => { flash.hidden = true; }, 500);
  }

  /**
   * Show the "get ready" banner at the bottom of the camera stage, with a
   * mode-specific instruction, in the gap between shots. Closed automatically
   * by `playCountdown()` the instant the next countdown starts.
   */
  showStageReady(text) {
    const el = this.el.stageReady;
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth; // restart animation
    el.classList.add('show');
  }

  hideStageReady() {
    const el = this.el.stageReady;
    if (!el) return;
    el.hidden = true;
    el.classList.remove('show');
  }

  // --- Processing -------------------------------------------------------------
  startProcessingCaptions() {
    let i = 0;
    const total = PROCESSING_MESSAGES.length;
    const tick = () => {
      this.el.processingCaption.textContent = PROCESSING_MESSAGES[i % total];
      this.el.procBarFill.style.width = `${Math.round(((i % total) + 1) / total * 100)}%`;
      i++;
    };
    tick();
    this._procTimer = setInterval(tick, PROCESSING_TICK_MS);
  }

  stopProcessingCaptions() {
    if (this._procTimer) clearInterval(this._procTimer);
    this._procTimer = null;
  }

  // --- Output ---------------------------------------------------------------
  setOutputImage(url) {
    this.el.outputImg.src = url;
  }

  /** Small celebratory confetti burst on the result screen. */
  burstConfetti() {
    const canvas = this.el.confetti;
    if (!canvas) return;
    this.stopConfetti();
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const colors = ['#FF6B6B', '#FFD93D', '#6FE7DD', '#BFA2FF', '#FF9A5A', '#7CE0D3', '#FF5A7A'];
    const total = 160;
    const parts = [];
    for (let i = 0; i < total; i++) {
      parts.push({
        x: w / 2 + (Math.random() - 0.5) * 120,
        y: h * 0.32,
        vx: (Math.random() - 0.5) * 9,
        vy: -6 - Math.random() * 8,
        g: 0.16 + Math.random() * 0.12,
        size: 6 + Math.random() * 7,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.3,
        shape: Math.random() < 0.35,
      });
    }
    let frame = 0;
    const maxFrames = 190;
    const step = () => {
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      parts.forEach((p) => {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y < h + 30) alive = true;
        const a = frame > maxFrames - 40 ? Math.max(0, (maxFrames - frame) / 40) : 1;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, 6.28); ctx.fill(); }
        else ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        ctx.restore();
      });
      frame++;
      if (alive && frame < maxFrames) this._confettiRaf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, w, h);
    };
    this._confettiRaf = requestAnimationFrame(step);
  }

  stopConfetti() {
    if (this._confettiRaf) cancelAnimationFrame(this._confettiRaf);
    this._confettiRaf = null;
  }
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
