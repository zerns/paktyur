/**
 * gesture.js — ✌️ (peace sign) capture trigger using MediaPipe Tasks Vision
 * Hand Landmarker, loaded lazily from CDN.
 *
 * Gesture depends on the CDN, so it REQUIRES a network connection. When the
 * browser is offline (navigator.onLine === false) or the CDN/model fails to
 * load, gesture mode is disabled entirely and the app falls back to voice or
 * a manual capture button.
 */

const {
  MEDIAPIPE_VISION_URL,
  MEDIAPIPE_WASM_ROOT,
  HAND_LANDMARKER_MODEL_URL,
  GESTURE_STABLE_MS,
  GESTURE_COOLDOWN_MS,
  ZOOM_GESTURE_THROTTLE_MS,
} = await import('./config.js?v=2462fe3');
const { isOnline } = await import('./utils.js?v=9550596');

// MediaPipe hand landmark indices used for the peace-sign heuristic.
const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
};

/**
 * Classify a peace sign from 21 hand landmarks.
 * A finger is "extended" when its tip is above (smaller y) its PIP joint,
 * because image y grows downward. Thumb uses an x-distance test.
 */
function isPeaceSign(lm) {
  const indexUp = lm[LM.INDEX_TIP].y < lm[LM.INDEX_PIP].y;
  const middleUp = lm[LM.MIDDLE_TIP].y < lm[LM.MIDDLE_PIP].y;
  const ringDown = lm[LM.RING_TIP].y > lm[LM.RING_PIP].y;
  const pinkyDown = lm[LM.PINKY_TIP].y > lm[LM.PINKY_PIP].y;

  // Thumb: not extended sideways far from the index MCP.
  const thumbSpread = Math.abs(lm[LM.THUMB_TIP].x - lm[LM.INDEX_MCP].x);
  const handWidth = Math.abs(lm[LM.INDEX_MCP].x - lm[LM.PINKY_PIP].x) || 0.0001;
  const thumbFolded = thumbSpread < handWidth * 1.2;

  // Index and middle should be separated (the "V").
  const spread = Math.abs(lm[LM.INDEX_TIP].x - lm[LM.MIDDLE_TIP].x);
  const separated = spread > handWidth * 0.15;

  return indexUp && middleUp && ringDown && pinkyDown && thumbFolded && separated;
}

/**
 * Classify a closed fist — all four fingers curled and the thumb folded
 * across the palm (reuses the peace-sign thumb-fold heuristic).
 */
function isFist(lm) {
  const indexDown = lm[LM.INDEX_TIP].y > lm[LM.INDEX_PIP].y;
  const middleDown = lm[LM.MIDDLE_TIP].y > lm[LM.MIDDLE_PIP].y;
  const ringDown = lm[LM.RING_TIP].y > lm[LM.RING_PIP].y;
  const pinkyDown = lm[LM.PINKY_TIP].y > lm[LM.PINKY_PIP].y;

  const thumbSpread = Math.abs(lm[LM.THUMB_TIP].x - lm[LM.INDEX_MCP].x);
  const handWidth = Math.abs(lm[LM.INDEX_MCP].x - lm[LM.PINKY_PIP].x) || 0.0001;
  const thumbFolded = thumbSpread < handWidth * 1.2;

  return indexDown && middleDown && ringDown && pinkyDown && thumbFolded;
}

export class GestureTrigger {
  /**
   * @param {HTMLVideoElement} video
   * @param {() => void} onTrigger
   * @param {(status:string) => void} [onStatus]
   * @param {(dy:number) => void} [onZoom]  normalized vertical wrist delta while a fist is held (idle only)
   */
  constructor(video, onTrigger, onStatus = () => {}, onZoom = () => {}) {
    this.video = video;
    this.onTrigger = onTrigger;
    this.onStatus = onStatus;
    this.onZoom = onZoom;
    this.landmarker = null;
    this.running = false;
    this.armed = false;
    this.zoomActive = false;
    this.rafId = null;
    this.stableSince = 0;
    this.lastFireAt = 0;
    this._lastZoomEmit = 0;
    this._lastFistY = null;
  }

  /** Enable/disable continuous fist-drag zoom reporting (idle-session only). */
  setZoomEnabled(on) {
    this.zoomActive = on;
  }

  static get available() {
    return isOnline();
  }

  /**
   * Load MediaPipe from CDN and create the Hand Landmarker.
   * Throws (with a clear message) when offline or the CDN fails.
   */
  async load() {
    if (!isOnline()) {
      throw new Error('Gesture detection needs an internet connection (currently offline).');
    }
    if (this.landmarker) return;
    let vision;
    try {
      vision = await import(/* @vite-ignore */ MEDIAPIPE_VISION_URL);
    } catch {
      throw new Error('Could not load the gesture engine (MediaPipe) from the network.');
    }
    const { HandLandmarker, FilesetResolver } = vision;
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_URL, delegate },
      numHands: 1,
      runningMode: 'VIDEO',
    });
    try {
      // GPU is fastest but fails on devices/browsers without a usable WebGL
      // context (e.g. emscripten_webgl_create_context error). Fall back to CPU.
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  }

  /** Start the detection loop (loads the model on first call). */
  async start() {
    await this.load();
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  /** Arm so the next stable peace sign fires (called per photo). */
  arm() {
    this.armed = true;
    this.stableSince = 0;
    this.onStatus('Waiting for ✌️');
  }

  disarm() {
    this.armed = false;
    this.stableSince = 0;
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();

    // MediaPipe requires strictly-increasing timestamps, so detect at most
    // once per frame and share the single result between capture + zoom.
    if ((this.armed || this.zoomActive) && this.landmarker && this.video.readyState >= 2) {
      let result = null;
      try {
        result = this.landmarker.detectForVideo(this.video, now);
      } catch {
        /* transient detection error; keep looping */
      }
      const lm = result?.landmarks?.length === 1 ? result.landmarks[0] : null;

      // Capture trigger — held peace sign, only while armed.
      if (this.armed) {
        const detected = !!lm && isPeaceSign(lm);
        if (detected) {
          if (!this.stableSince) this.stableSince = now;
          if (
            now - this.stableSince >= GESTURE_STABLE_MS &&
            now - this.lastFireAt >= GESTURE_COOLDOWN_MS
          ) {
            this.lastFireAt = now;
            this.armed = false;
            this.stableSince = 0;
            this.onStatus('Gesture detected!');
            this.onTrigger();
          }
        } else {
          this.stableSince = 0;
        }
      }

      // Continuous zoom — fist held, moved vertically.
      if (this.zoomActive && lm && isFist(lm)) {
        const wristY = lm[LM.WRIST].y;
        if (this._lastFistY == null) {
          this._lastFistY = wristY;
        } else if (now - this._lastZoomEmit >= ZOOM_GESTURE_THROTTLE_MS) {
          this._lastZoomEmit = now;
          const dy = this._lastFistY - wristY; // moving up = positive = zoom in
          this._lastFistY = wristY;
          this.onZoom(dy);
        }
      } else if (this.zoomActive) {
        this._lastFistY = null;
      }
    }

    this.rafId = requestAnimationFrame(() => this._loop());
  }

  stop() {
    this.running = false;
    this.armed = false;
    this.zoomActive = false;
    this._lastZoomEmit = 0;
    this._lastFistY = null;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        /* ignore */
      }
      this.landmarker = null;
    }
  }
}
