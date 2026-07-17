/**
 * config.js — Central configuration for the photo booth app.
 * All tunable limits and constants live here so behaviour can be adjusted
 * in one place. See README for what each value controls.
 */

// --- Template dimension limits ---------------------------------------------
export const MAX_WIDTH = 4000;
export const MAX_HEIGHT = 4000;

// Built-in templates export at the on-screen display width so the downloaded
// file matches the strip shown in the UI (#confirm-canvas / .output-image are
// capped at 220px in styles.css).
export const OUTPUT_DISPLAY_WIDTH = 220;

// Reject empty / absurd files early.
export const MAX_FILE_BYTES = 30 * 1024 * 1024; // 30 MB

// --- Placeholder size / area limits ----------------------------------------
export const MIN_PLACEHOLDER_WIDTH = 150;
export const MIN_PLACEHOLDER_HEIGHT = 150;
export const MIN_PLACEHOLDER_AREA = 25000;

export const MAX_PLACEHOLDER_WIDTH = 1500;
export const MAX_PLACEHOLDER_HEIGHT = 1500;
export const MAX_PLACEHOLDER_AREA = 600000;

// --- Placeholder count limits ----------------------------------------------
export const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 8;

// --- PNG detection ----------------------------------------------------------
// Alpha <= this value counts as "transparent" (a candidate placeholder pixel).
export const ALPHA_TRANSPARENT_THRESHOLD = 16;

// --- JPG detection ----------------------------------------------------------
// Default per-request tolerance for matching the user-picked placeholder color.
// Interpreted as a Euclidean distance in RGB space (0-441).
export const DEFAULT_COLOR_TOLERANCE = 15;
export const MAX_COLOR_TOLERANCE = 120;

// --- Voice trigger ----------------------------------------------------------
export const VOICE_KEYWORDS = ['cheese', 'cheeze', 'cheers'];
export const VOICE_TIMEOUT_MS = 15000; // restart recognition if silent this long
export const VOICE_MAX_RETRIES = 5;
export const VOICE_PROMPT_DELAY_MS = 1000; // speak "Say cheese" if countdown hasn't begun
export const PROMPT_SOUND_URL = 'assets/say-cheese.mp3?v=bb46100c'; // recorded voice cue
export const STT_LAG_MARGIN_MS = 1800; // ignore recognition results this long after the cue ends (cloud STT round-trip lag)
export const EXTRA_MATCH_WINDOW_MS = 6000; // how long a stray duplicate "cheese" is remembered

// --- Gesture trigger --------------------------------------------------------
export const GESTURE_STABLE_MS = 1000; // hold ✌️ this long to fire
export const GESTURE_COOLDOWN_MS = 3000; // ignore re-triggers for this long
// MediaPipe assets (CDN). Requires network; gesture is disabled when offline.
export const MEDIAPIPE_VISION_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
export const MEDIAPIPE_WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
export const HAND_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// --- Countdown --------------------------------------------------------------
export const COUNTDOWN_START = 3; // counts 3,2,1 then CLICK!
export const COUNTDOWN_TICK_MS = 800;

// --- Camera -----------------------------------------------------------------
// Preferred front-facing HD camera; ideal (not exact) so it degrades cleanly.
export const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

// --- Zoom -------------------------------------------------------------------
export const ZOOM_STEP = 0.2; // manual button / voice-command step (fraction of zoom range)
export const ZOOM_PINCH_MIN = 0.03; // normalized thumb-index span mapped to min zoom
export const ZOOM_PINCH_MAX = 0.35; // normalized thumb-index span mapped to max zoom
export const ZOOM_GESTURE_THROTTLE_MS = 80; // min ms between gesture-driven zoom updates
export const ZOOM_VOICE_KEYWORDS = {
  in: ['zoom in'],
  out: ['zoom out'],
  reset: ['reset zoom', 'zoom reset'],
};

// --- Overlay colors (cycled per placeholder) --------------------------------
export const OVERLAY_COLORS = [
  '#FF6B6B', '#6FE7DD', '#BFA2FF', '#FFD93D',
  '#FF9A5A', '#7C5CE0', '#4FC3B5', '#FF5A7A',
];

// --- Copy: rotating processing captions & decorative emoji pool ------------
export const PROCESSING_MESSAGES = [
  'Developing your masterpiece…',
  'Adding the magic…',
  'Making everyone look amazing…',
  'Almost ready…',
];
export const PROCESSING_TICK_MS = 900;
export const PROCESSING_MIN_MS = 1800; // minimum time the Processing screen stays visible

export const DECO_EMOJI = [
  '🌈', '✨', '💖', '⭐', '🎈', '🌟', '🎀', '🍭',
  '🥳', '🫶', '😎', '🌸', '🍬', '💫', '🎉', '🧁',
];
export const DECO_COUNT_MIN = 4;
export const DECO_COUNT_MAX = 7;
export const DECO_VISIBLE_MS_MIN = 3000;
export const DECO_VISIBLE_MS_MAX = 8000;
export const DECO_GAP_MS_MIN = 800;
export const DECO_GAP_MS_MAX = 2000;
export const DECO_FADE_MS = 600;
