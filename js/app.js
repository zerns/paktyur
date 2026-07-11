/**
 * app.js — Orchestrator. Implements the 12-step photo-booth flow as an
 * explicit state machine, wiring together the camera, voice, gesture,
 * detector, image processor, and UI modules. Owns all app state and manages
 * resource lifecycle (bitmaps, streams, object URLs, listeners).
 */

import {
  MIN_PHOTOS,
  MAX_PHOTOS,
  DEFAULT_COLOR_TOLERANCE,
  COUNTDOWN_START,
  COUNTDOWN_TICK_MS,
} from './config.js';
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
} from './utils.js';
import {
  decode,
  validateDimensions,
  toImageData,
  bitmapSize,
  composite,
  exportPNG,
  createCanvas,
} from './imageProcessor.js';
import { detectPlaceholders } from './placeholderDetector.js';
import { Camera } from './camera.js';
import { VoiceTrigger, requestMicPermission } from './microphone.js';
import { GestureTrigger } from './gesture.js';
import { UI } from './ui.js';

const State = {
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
    this._enter(State.UPLOAD);
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
    this.capturing = false;
    this.workCanvas = this.workCanvas || createCanvas(1, 1);

    if (!initial) {
      this._teardownSession();
      revokeAllObjectUrls();
    }
  }

  _bindGlobal() {
    const { el } = this.ui;
    // Upload.
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

    // Output.
    this.bag.add(on(el.downloadBtn, 'click', () => this._download()));
    this.bag.add(on(el.printBtn, 'click', () => window.print()));
    this.bag.add(on(el.againBtn, 'click', () => this._retakeSameTemplate()));
    this.bag.add(on(el.newTemplateBtn, 'click', () => this._enter(State.UPLOAD, { reset: true })));

    // Error banner.
    this.bag.add(on(el.errorDismiss, 'click', () => this.ui.hideError()));
    this.bag.add(on(el.errorRetry, 'click', () => {
      const h = this.ui._retryHandler;
      this.ui.hideError();
      if (h) h();
    }));

    // Offline/online: gesture depends on the network.
    this.bag.add(on(window, 'offline', () => this._onConnectivityChange()));
    this.bag.add(on(window, 'online', () => this._onConnectivityChange()));
  }

  // --- State transitions ----------------------------------------------------
  _enter(state, opts = {}) {
    if (opts.reset) this.reset(false);
    this.state = state;
    this.ui.show(state);
    if (state !== State.SESSION) this._teardownSession();
  }

  // === Step 1-2: Upload + validate =========================================
  async _onFile(file) {
    if (!file) return;
    this.ui.hideError();
    try {
      const mode = await validateTemplateFile(file); // 'png' | 'jpg'
      const bitmap = await decode(file);
      this.templateSize = validateDimensions(bitmap);
      closeBitmap(this.template);
      this.template = bitmap;
      this.mode = mode;

      if (mode === 'png') {
        await this._runPngDetection();
      } else {
        this.pickedColor = null;
        this.tolerance = DEFAULT_COLOR_TOLERANCE;
        this._enter(State.JPGPICK);
        this._setupJpgPick();
      }
    } catch (err) {
      this.ui.showError(err.message, () => this.ui.el.fileInput.click());
    }
  }

  // === Step 3 (PNG): alpha detection =======================================
  async _runPngDetection() {
    try {
      const imageData = toImageData(this.template, this.workCanvas);
      this.detection = await detectPlaceholders(imageData, 'png');
      this._showConfirm();
    } catch (err) {
      this.ui.showError(`Placeholder detection failed: ${err.message}`);
    }
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
      this._showConfirm();
    } catch (err) {
      this.ui.showError(`Placeholder detection failed: ${err.message}`);
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
    const n = this.detection.valid.length;
    if (n < MIN_PHOTOS || n > MAX_PHOTOS) {
      const reasons = this.detection.rejected.map((r) => `#${r.id + 1}: ${r.reason}`).join('; ');
      this.ui.showError(
        `Need between ${MIN_PHOTOS} and ${MAX_PHOTOS} placeholders, found ${n} valid ` +
        `(${this.detection.rejected.length} rejected${reasons ? ': ' + reasons : ''}).`
      );
      return;
    }
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
      this.ui.showError(err.message, () => this._startSession());
      return;
    }

    // Request mic (optional) and pick a trigger mode.
    const micOk = await requestMicPermission();
    await this._chooseTriggerMode(micOk);

    // Draw guide overlay once the preview lays out.
    requestAnimationFrame(() => this._refreshOverlay());
    this._armCurrent();
  }

  /**
   * Decide the trigger: voice if mic + SpeechRecognition; else gesture if
   * online + MediaPipe loads; else manual button. Gesture is disabled offline.
   */
  async _chooseTriggerMode(micOk) {
    this._teardownTriggers();

    if (micOk && VoiceTrigger.supported) {
      this.ui.setMicStatus('ready', true);
      this.voice = new VoiceTrigger(() => this._triggerCapture(), (s) => this.ui.setTriggerStatus(s));
      try {
        this.voice.start();
        this.triggerMode = 'voice';
        this.ui.showManualButton(false);
        this.ui.setTriggerStatus('Say “Cheese”');
        return;
      } catch {
        this.voice = null;
      }
    }
    this.ui.setMicStatus(micOk ? 'no speech engine' : 'unavailable', false);

    // Gesture fallback — needs the network.
    if (isOnline()) {
      this.gesture = new GestureTrigger(
        this.ui.el.video,
        () => this._triggerCapture(),
        (s) => this.ui.setTriggerStatus(s)
      );
      try {
        this.ui.setTriggerStatus('Loading gesture engine…');
        await this.gesture.start();
        this.triggerMode = 'gesture';
        this.ui.showManualButton(false);
        this.ui.setTriggerStatus('Show a ✌️ hand sign to begin.');
        return;
      } catch (err) {
        this.gesture?.stop();
        this.gesture = null;
        this.ui.setTriggerStatus(err.message);
      }
    } else {
      this.ui.setTriggerStatus('Gesture needs internet — offline.');
    }

    // Last resort: manual capture button.
    this.triggerMode = 'manual';
    this.ui.showManualButton(true);
    this.ui.setTriggerStatus('Tap “Capture” to take each photo.');
  }

  /** Re-evaluate gesture availability when connectivity changes mid-session. */
  _onConnectivityChange() {
    if (this.state !== State.SESSION) return;
    if (this.triggerMode === 'gesture' && !isOnline()) {
      // Lost network while relying on gesture → fall back to manual.
      this._teardownTriggers();
      this.triggerMode = 'manual';
      this.ui.showManualButton(true);
      this.ui.setTriggerStatus('Connection lost — gesture disabled. Tap “Capture”.');
    } else if (this.triggerMode === 'manual' && isOnline() && !this.voice) {
      // Network returned and we have no voice → try to (re)enable gesture.
      this._chooseTriggerMode(false);
      this._armCurrent();
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
      this.ui.showError(`Capture failed: ${err.message}`, () => { this.capturing = false; this._armCurrent(); });
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
    // Yield so the processing screen paints before heavy compositing.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const canvas = composite(
        this.template,
        this.mode,
        this.detection.valid,
        this.photos,
        this.workCanvas
      );
      const blob = await exportPNG(canvas);
      if (this.outputUrl) revokeObjectUrl(this.outputUrl);
      this.outputUrl = trackObjectUrl(URL.createObjectURL(blob));
      this.ui.setOutputImage(this.outputUrl);
      this._enter(State.OUTPUT);
    } catch (err) {
      this.ui.showError(`Rendering failed: ${err.message}`, () => this._finish());
    }
  }

  _download() {
    if (!this.outputUrl) return;
    const a = document.createElement('a');
    a.href = this.outputUrl;
    a.download = `photobooth-${Date.now()}.png`;
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
      this.ui.showError(err.message);
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
