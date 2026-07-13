/**
 * gesture.js — ✌️ (peace sign) capture trigger using MediaPipe Tasks Vision
 * Hand Landmarker, loaded lazily from CDN.
 *
 * Gesture depends on the CDN, so it REQUIRES a network connection. When the
 * browser is offline (navigator.onLine === false) or the CDN/model fails to
 * load, gesture mode is disabled entirely and the app falls back to voice or
 * a manual capture button.
 */

import {
  MEDIAPIPE_VISION_URL,
  MEDIAPIPE_WASM_ROOT,
  HAND_LANDMARKER_MODEL_URL,
  GESTURE_STABLE_MS,
  GESTURE_COOLDOWN_MS,
} from './config.js?v=bb46100c';
import { isOnline } from './utils.js?v=bb46100c';

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

export class GestureTrigger {
  /**
   * @param {HTMLVideoElement} video
   * @param {() => void} onTrigger
   * @param {(status:string) => void} [onStatus]
   */
  constructor(video, onTrigger, onStatus = () => {}) {
    this.video = video;
    this.onTrigger = onTrigger;
    this.onStatus = onStatus;
    this.landmarker = null;
    this.running = false;
    this.armed = false;
    this.rafId = null;
    this.stableSince = 0;
    this.lastFireAt = 0;
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
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_URL, delegate: 'GPU' },
      numHands: 1,
      runningMode: 'VIDEO',
    });
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

    if (this.armed && this.landmarker && this.video.readyState >= 2) {
      let detected = false;
      try {
        const result = this.landmarker.detectForVideo(this.video, now);
        if (result.landmarks && result.landmarks.length === 1) {
          detected = isPeaceSign(result.landmarks[0]);
        }
      } catch {
        /* transient detection error; keep looping */
      }

      if (detected) {
        if (!this.stableSince) this.stableSince = now;
        // Require the sign to be held, and respect cooldown.
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

    this.rafId = requestAnimationFrame(() => this._loop());
  }

  stop() {
    this.running = false;
    this.armed = false;
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
