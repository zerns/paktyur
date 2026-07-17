/**
 * app.js — Orchestrator. Implements the 12-step photo-booth flow as an
 * explicit state machine, wiring together the camera, voice, gesture,
 * detector, image processor, and UI modules. Owns all app state and manages
 * resource lifecycle (bitmaps, streams, object URLs, listeners).
 */

// Clickjacking guard. CSP `frame-ancestors` only works as an HTTP header, and
// GitHub Pages can't set custom headers — so bust out of any framing here.
// The app requests camera/mic, making UI-redress attacks worth blocking.
if (window.top !== window.self) {
  try {
    window.top.location = window.self.location.href;
  } catch {
    document.documentElement.style.display = 'none';
  }
}

import {
  MIN_PHOTOS,
  MAX_PHOTOS,
  DEFAULT_COLOR_TOLERANCE,
  COUNTDOWN_START,
  COUNTDOWN_TICK_MS,
  PROCESSING_MIN_MS,
  OUTPUT_DISPLAY_WIDTH,
} from './config.js?v=bb46100c';
import {
  features,
  isOnline,
  validateTemplateFile,
  revokeAllObjectUrls,
  trackObjectUrl,
  revokeObjectUrl,
  closeBitmap,
  createDisposerBag,
  on,
  $,
} from './utils.js?v=bb46100c';
import {
  decode,
  validateDimensions,
  toImageData,
  bitmapSize,
  composite,
  exportPNG,
  createCanvas,
  downscaleCanvas,
} from './imageProcessor.js?v=bb46100c';
import { detectPlaceholders } from './placeholderDetector.js?v=bb46100c';
import { renderTemplate } from './templates.js?v=bb46100c';
import { Camera } from './camera.js?v=bb46100c';
import { VoiceTrigger, requestMicPermission } from './microphone.js?v=bb46100c';
import { GestureTrigger } from './gesture.js?v=bb46100c';
import { UI } from './ui.js?v=bb46100c';

const State = {
  WELCOME: 'welcome',
  UPLOAD: 'upload',
  JPGPICK: 'jpgpick',
  CONFIRM: 'confirm',
  SESSION: 'session',
  PROCESSING: 'processing',
  OUTPUT: 'output',
};

class App {
  constructor() {
    this.ui = new UI();
    this.bag = createDisposerBag(); // global listeners
    this.reset(true);
    this._bindGlobal();
    this.bag.add(this.ui.startDeco());
    this._enter(State.WELCOME);
  }

  /** Clear per-template state and release resources. */
  reset(initial = false) {
    // Release large objects.
    closeBitmap(this.template);
    (this.photos || []).forEach(closeBitmap);
    if (this.outputUrl) revokeObjectUrl(this.outputUrl);

    this.template = null; // ImageBitmap
    this.templateSize = { width: 0, height: 0 };
    this.mode = null; // 'png' | 'jpg'
    this.detection = null; // {total, valid, rejected}
    this.pickedColor = null; // [r,g,b]
    this.tolerance = DEFAULT_COLOR_TOLERANCE;
    this.photos = []; // captured ImageBitmaps per placeholder
    this.activeIndex = 0;
    this.outputUrl = null;
    this.triggerMode = null; // 'voice' | 'gesture' | 'manual'
    this.builtInTemplate = false; // true for the four generated templates
    this.capturing = false;
    this.workCanvas = this.workCanvas || createCanvas(1, 1);

    if (!initial) {
      this._teardownSession();
      revokeAllObjectUrls();
    }
  }

  _bindGlobal() {
    const { el } = this.ui;
    // Brand logo — back to welcome.
    this.bag.add(on($('#brand-btn'), 'click', () => this._enter(State.WELCOME, { reset: true })));

    // Welcome.
    this.bag.add(on(el.heroStartBtn, 'click', () => this._enter(State.UPLOAD)));

    // Template chooser (built-in cards) + upload.
    this.ui.renderTemplateCards((id) => this._selectDefaultTemplate(id));
    this.bag.add(on(el.fileInput, 'change', (e) => this._onFile(e.target.files?.[0])));
    this.bag.add(on(el.dropzone, 'click', () => el.fileInput.click()));
    this.bag.add(on(el.dropzone, 'dragover', (e) => { e.preventDefault(); el.dropzone.classList.add('drag'); }));
    this.bag.add(on(el.dropzone, 'dragleave', () => el.dropzone.classList.remove('drag')));
    this.bag.add(on(el.dropzone, 'drop', (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('drag');
      this._onFile(e.dataTransfer.files?.[0]);
    }));

    // JPG pick.
    this.bag.add(on(el.pickCanvas, 'mousemove', (e) => this._onPickMove(e)));
    this.bag.add(on(el.pickCanvas, 'mouseleave', () => this.ui.hideLoupe()));
    this.bag.add(on(el.pickCanvas, 'click', (e) => this._onPickClick(e)));
    this.bag.add(on(el.toleranceSlider, 'input', (e) => {
      this.tolerance = Number(e.target.value);
      this.ui.setTolerance(this.tolerance);
    }));
    this.bag.add(on(el.rerunBtn, 'click', () => this._runJpgDetection()));

    // Confirm.
    this.bag.add(on(el.confirmBtn, 'click', () => this._confirmDetection()));
    this.bag.add(on(el.cancelBtn, 'click', () => this._enter(State.UPLOAD, { reset: true })));
    this.bag.add(on(el.recolorBtn, 'click', () => this._enter(State.JPGPICK)));

    // Session.
    this.bag.add(on(el.manualBtn, 'click', () => this._triggerCapture()));
    this.bag.add(on(el.cameraSelect, 'change', (e) => this._switchCamera(e.target.value)));
    // Trigger mode pills — let the user switch capture method live.
    for (const pill of el.triggerRow.children) {
      this.bag.add(on(pill, 'click', () => this._setTriggerMode(pill.dataset.trigger)));
    }

    // Output.
    this.bag.add(on(el.downloadBtn, 'click', () => this._download()));
    this.bag.add(on(el.againBtn, 'click', () => this._retakeSameTemplate()));
    this.bag.add(on(el.newTemplateBtn, 'click', () => this._enter(State.UPLOAD, { reset: true })));
    this.bag.add(on(el.copyLinkBtn, 'click', () => this._copyLink()));

    // Offline/online: gesture depends on the network.
    this.bag.add(on(window, 'offline', () => this._onConnectivityChange()));
    this.bag.add(on(window, 'online', () => this._onConnectivityChange()));
  }

  // --- State transitions ----------------------------------------------------
  _enter(state, opts = {}) {
    if (opts.reset) this.reset(false);
    this.state = state;
    this.ui.show(state);
    this.ui.renderStepper(state);
    if (state === State.UPLOAD) this.ui.setSelectedTemplate(null);
    if (state !== State.SESSION) this._teardownSession();
    if (state !== State.OUTPUT) this.ui.stopConfetti();
    if (state !== State.PROCESSING) this.ui.stopProcessingCaptions();
  }

  // === Step 1-2: Upload + validate =========================================
  async _onFile(file) {
    if (!file) return;
    try {
      const mode = await validateTemplateFile(file); // 'png' | 'jpg'
      const bitmap = await decode(file);
      this.templateSize = validateDimensions(bitmap);
      closeBitmap(this.template);
      this.template = bitmap;
      this.mode = mode;
      this.builtInTemplate = false;
      this.ui.setSelectedTemplate('custom');

      if (mode === 'png') {
        // Wait until detection resolves before announcing success — an
        // immediate success toast would silently overwrite (and then
        // auto-fade) a still-unacknowledged persistent error toast.
        await this._runPngDetection();
      } else {
        this.pickedColor = null;
        this.tolerance = DEFAULT_COLOR_TOLERANCE;
        this._enter(State.JPGPICK);
        this._setupJpgPick();
        this.ui.showToast('Template uploaded! ✨');
      }
    } catch (err) {
      this.ui.showToast(err.message);
    }
  }

  // === Built-in template: generate a real frame bitmap =====================
  async _selectDefaultTemplate(id) {
    try {
      const { bitmap, size, placeholders } = await renderTemplate(id);
      closeBitmap(this.template);
      this.template = bitmap;
      this.templateSize = size;
      this.builtInTemplate = true;
      this.mode = 'png'; // transparent slots — same composite path as an uploaded PNG
      this.pickedColor = null;
      this.detection = { total: placeholders.length, valid: placeholders, rejected: [] };
      this._showConfirm();
    } catch (err) {
      this.ui.showToast(err.message);
    }
  }

  // === Step 3 (PNG): alpha detection =======================================
  async _runPngDetection() {
    try {
      const imageData = toImageData(this.template, this.workCanvas);
      this.detection = await detectPlaceholders(imageData, 'png');
      if (this._reportEmptyDetection()) return;
      this.ui.showToast('Template uploaded! ✨');
      this._showConfirm();
    } catch (err) {
      this.ui.showToast(`Detection failed: ${err.message}`);
    }
  }

  /**
   * Tell the user *immediately* if a freshly uploaded template has no usable
   * photo areas (or too many), instead of waiting for the "Start Taking
   * Photos" click. Returns true when detection is unusable (caller should not
   * advance to the preview).
   */
  _reportEmptyDetection() {
    const n = this.detection.valid.length;
    if (n < MIN_PHOTOS) {
      this.ui.showToast('No photo areas found — use a template with transparent (PNG) or solid-color (JPG) holes.', { persistent: true });
      return true;
    }
    if (n > MAX_PHOTOS) {
      this.ui.showToast(`Too many photo areas (${n}). Maximum is ${MAX_PHOTOS}.`, { persistent: true });
      return true;
    }
    return false;
  }

  // === Step 3 (JPG): color pick + detection ================================
  _setupJpgPick() {
    const { width, height } = this.templateSize;
    this.pickCtx = this.ui.renderPickCanvas(this.template, width, height);
    this.ui.setTolerance(this.tolerance);
    this.ui.el.rerunBtn.disabled = true;
    this.ui.el.pickHint.textContent = 'Click a placeholder color in the template.';
  }

  _canvasCoords(e) {
    const canvas = this.ui.el.pickCanvas;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
    return { x, y };
  }

  _onPickMove(e) {
    if (!this.pickCtx) return;
    const { x, y } = this._canvasCoords(e);
    this.ui.drawLoupe(this.pickCtx, x, y);
  }

  _onPickClick(e) {
    if (!this.pickCtx) return;
    const { x, y } = this._canvasCoords(e);
    const px = this.pickCtx.getImageData(x, y, 1, 1).data;
    this.pickedColor = [px[0], px[1], px[2]];
    this.ui.setPickedColor(this.pickedColor);
    this.ui.el.rerunBtn.disabled = false;
    this._runJpgDetection();
  }

  async _runJpgDetection() {
    if (!this.pickedColor) return;
    try {
      const imageData = toImageData(this.template, this.workCanvas);
      this.detection = await detectPlaceholders(imageData, 'jpg', {
        color: this.pickedColor,
        tolerance: this.tolerance,
      });
      if (this._reportEmptyDetection()) return;
      this._showConfirm();
    } catch (err) {
      this.ui.showToast(`Detection failed: ${err.message}`);
    }
  }

  // === Step 4-5: Confirm + count validation ================================
  _showConfirm() {
    const { width, height } = this.templateSize;
    this.ui.setConfirmMode(this.mode);
    this.ui.renderConfirm(this.template, width, height, this.detection);
    this._enter(State.CONFIRM);
  }

  _confirmDetection() {
    // Detection was already validated when the template was chosen/uploaded,
    // so reaching the preview guarantees a usable strip — just start.
    this._startSession();
  }

  // === Step 6: Prepare session (camera + mic + trigger) ====================
  async _startSession() {
    this.photos = new Array(this.detection.valid.length).fill(null);
    this.activeIndex = 0;
    this._enter(State.SESSION);
    this.ui.setProgress(1, this.detection.valid.length);

    this.camera = new Camera(this.ui.el.video);
    this.ui.setCameraStatus('requesting…', false);
    this.ui.setMicStatus('requesting…', false);

    // Request camera (required).
    try {
      await this.camera.start();
      this.ui.setCameraStatus('ready', true);
      const cams = await this.camera.listCameras();
      this.ui.populateCameras(cams, this.camera.deviceId);
    } catch (err) {
      this.ui.setCameraStatus('unavailable', false);
      this.ui.showToast(err.message);
      return;
    }

    // Request mic (optional) and pick a trigger mode.
    const micOk = await requestMicPermission();
    await this._chooseTriggerMode(micOk);

    // Draw guide overlay once the preview lays out.
    requestAnimationFrame(() => this._refreshOverlay());
    this._armCurrent();
  }

  /** Which trigger modes are usable right now. */
  _availability() {
    return {
      voice: !!(this._micOk && VoiceTrigger.supported),
      gesture: isOnline(),
      manual: true,
    };
  }

  /**
   * Pick a sensible default trigger, then let the user switch between any
   * available mode via the pills. Preference: voice → gesture → manual.
   */
  async _chooseTriggerMode(micOk) {
    this._micOk = micOk;
    this.ui.setTriggerHint('');
    const avail = this._availability();
    this.ui.setTriggerAvailability(avail);

    if (micOk && VoiceTrigger.supported) {
      this.ui.setMicStatus('ready', true);
    } else if (micOk && !VoiceTrigger.supported) {
      this.ui.setMicStatus('no speech engine', false);
      this.ui.setTriggerHint('Voice trigger needs Chrome or Edge.');
    } else {
      this.ui.setMicStatus('unavailable', false);
    }

    const preferred = avail.voice ? 'voice' : avail.gesture ? 'gesture' : 'manual';
    await this._startTrigger(preferred);
  }

  /**
   * Switch to a user-chosen trigger mode. Ignores unavailable modes.
   */
  async _setTriggerMode(mode) {
    if (this.state !== State.SESSION) return;
    if (!this._availability()[mode]) return;
    if (mode === this.triggerMode) return;
    const bannerShowing = !this.ui.el.stageReady.hidden;
    await this._startTrigger(mode);
    if (bannerShowing) this.ui.showStageReady(this._instructionFor(mode));
    this._armCurrent();
  }

  /** Ready-state instruction copy for a trigger mode — shared by the side
   * panel status line and the stage "get ready" banner between shots. */
  _instructionFor(mode) {
    if (mode === 'voice') return 'Say “Cheese”';
    if (mode === 'gesture') return 'Show a ✌️ hand sign to begin.';
    return 'Tap “Capture” to take each photo.';
  }

  /** Tear down the current trigger and start `mode`. */
  async _startTrigger(mode) {
    this._teardownTriggers();
    this.ui.showManualButton(mode === 'manual');
    this.triggerMode = mode;
    this.ui.setTriggerMode(mode);

    if (mode === 'voice') {
      this.voice = new VoiceTrigger(() => this._triggerCapture(), (s) => this.ui.setTriggerStatus(s));
      try {
        this.voice.start();
        this.ui.setTriggerStatus(this._instructionFor('voice'));
      } catch {
        this.voice = null;
        this.ui.setTriggerStatus('Voice unavailable — pick another mode.');
      }
    } else if (mode === 'gesture') {
      this.gesture = new GestureTrigger(
        this.ui.el.video,
        () => this._triggerCapture(),
        (s) => this.ui.setTriggerStatus(s)
      );
      try {
        this.ui.setTriggerStatus('Loading gesture engine…');
        await this.gesture.start();
        this.ui.setTriggerStatus(this._instructionFor('gesture'));
      } catch (err) {
        this.gesture?.stop();
        this.gesture = null;
        this.ui.setTriggerStatus(err.message);
      }
    } else {
      this.ui.setTriggerStatus(this._instructionFor('manual'));
    }
  }

  /** Re-evaluate gesture availability when connectivity changes mid-session. */
  _onConnectivityChange() {
    if (this.state !== State.SESSION) return;
    this.ui.setTriggerAvailability(this._availability());
    if (this.triggerMode === 'gesture' && !isOnline()) {
      // Lost network while relying on gesture → fall back to manual.
      this._startTrigger('manual').then(() => {
        this.ui.setTriggerStatus('Connection lost — gesture disabled. Tap “Capture”.');
        this._armCurrent();
      });
    }
  }

  _armCurrent() {
    if (this.triggerMode === 'voice') this.voice?.arm();
    else if (this.triggerMode === 'gesture') this.gesture?.arm();
  }

  _refreshOverlay() {
    if (this.state !== State.SESSION) return;
    this.ui.renderSessionOverlay(
      this.detection.valid,
      this.activeIndex,
      this.templateSize.width,
      this.templateSize.height
    );
    this.ui.renderStripPreview(
      this.template,
      this.templateSize.width,
      this.templateSize.height,
      this.detection.valid,
      this.activeIndex
    );
  }

  // === Step 7-9: Trigger -> countdown -> capture ===========================
  async _triggerCapture() {
    if (this.capturing || this.state !== State.SESSION) return;
    this.capturing = true;
    this.voice?.disarm();
    this.gesture?.disarm();

    try {
      await this.ui.playCountdown(COUNTDOWN_START, COUNTDOWN_TICK_MS, (s) => {
        if (s === 'CLICK!') this._shutterSound();
      });
      const frame = await this.camera.capture();
      this.photos[this.activeIndex] = frame;
    } catch (err) {
      this.ui.showToast(`Capture failed: ${err.message}`);
      this.capturing = false;
      return;
    }

    this.capturing = false;
    this._advance();
  }

  // === Step 10: Continue or finish =========================================
  _advance() {
    this.activeIndex++;
    if (this.activeIndex < this.detection.valid.length) {
      this.ui.setProgress(this.activeIndex + 1, this.detection.valid.length);
      this.ui.setTriggerStatus('Prepare for the next photo.');
      this.ui.showStageReady(this._instructionFor(this.triggerMode));
      this._refreshOverlay();
      this._armCurrent();
    } else {
      this._finish();
    }
  }

  // === Step 11-12: Processing + output =====================================
  async _finish() {
    this._teardownSession();
    this._enter(State.PROCESSING);
    this.ui.startProcessingCaptions();
    // Hold the screen visible for a minimum duration — compositing alone is
    // near-instant and would otherwise skip past "Great job!" unseen.
    const minDelay = new Promise((r) => setTimeout(r, PROCESSING_MIN_MS));
    try {
      const work = (async () => {
        const canvas = composite(
          this.template,
          this.mode,
          this.detection.valid,
          this.photos,
          this.workCanvas
        );
        // Built-in templates export at the display width so the downloaded
        // file matches the strip shown on screen.
        const out = this.builtInTemplate
          ? downscaleCanvas(canvas, OUTPUT_DISPLAY_WIDTH)
          : canvas;
        return exportPNG(out);
      })();
      const [blob] = await Promise.all([work, minDelay]);
      if (this.outputUrl) revokeObjectUrl(this.outputUrl);
      this.outputUrl = trackObjectUrl(URL.createObjectURL(blob));
      this.ui.setOutputImage(this.outputUrl);
      this.ui.stopProcessingCaptions();
      this._enter(State.OUTPUT);
      this.ui.burstConfetti();
    } catch (err) {
      this.ui.stopProcessingCaptions();
      this.ui.showToast(`Rendering failed: ${err.message}`);
    }
  }

  _copyLink() {
    const url = window.location.href;
    try {
      navigator.clipboard?.writeText(url);
    } catch {
      /* clipboard optional */
    }
    this.ui.showToast('Link copied! Share the fun! 🎉');
  }

  _download() {
    if (!this.outputUrl) return;
    const a = document.createElement('a');
    a.href = this.outputUrl;
    a.download = `paktyur-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // === Step 12: Reuse same template ========================================
  _retakeSameTemplate() {
    // Keep template + cached detection; clear captured photos only.
    this.photos.forEach(closeBitmap);
    this.photos = new Array(this.detection.valid.length).fill(null);
    this.activeIndex = 0;
    if (this.outputUrl) { revokeObjectUrl(this.outputUrl); this.outputUrl = null; }
    this._startSession();
  }

  // --- Camera switching -----------------------------------------------------
  async _switchCamera(deviceId) {
    if (!this.camera) return;
    try {
      await this.camera.switchTo(deviceId);
      this._refreshOverlay();
    } catch (err) {
      this.ui.showToast(err.message);
    }
  }

  // --- Shutter sound (WebAudio, no asset) ----------------------------------
  _shutterSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = (this._audioCtx ||= new Ctx());
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      /* audio is optional */
    }
  }

  // --- Teardown -------------------------------------------------------------
  _teardownTriggers() {
    if (this.voice) { this.voice.stop(); this.voice = null; }
    if (this.gesture) { this.gesture.stop(); this.gesture = null; }
  }

  _teardownSession() {
    this._teardownTriggers();
    if (this.camera) { this.camera.stop(); this.camera = null; }
    this.capturing = false;
  }
}

// Boot once the DOM is ready.
if (!features.getUserMedia) {
  // Still boot; camera errors surface later with a clear message.
  console.warn('getUserMedia not detected; camera features may be unavailable.');
}
window.addEventListener('DOMContentLoaded', () => {
  const footerYear = $('#footer-year');
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
  window.__app = new App();
});
