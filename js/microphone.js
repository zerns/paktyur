/**
 * microphone.js — Microphone permission + voice ("Cheese") capture trigger
 * using the Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 *
 * Continuous, case-insensitive keyword matching with a silence timeout and
 * automatic retry. Reports availability so the app can fall back to gesture
 * mode when the mic or speech recognition is unavailable.
 */

import { VOICE_KEYWORDS, VOICE_TIMEOUT_MS, VOICE_MAX_RETRIES } from './config.js';
import { features } from './utils.js';

/**
 * Request microphone permission. Returns true if granted.
 * The stream is stopped immediately — we only need the permission grant;
 * SpeechRecognition opens its own audio internally.
 */
export async function requestMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export class VoiceTrigger {
  /**
   * @param {() => void} onTrigger  fired when a keyword is recognized
   * @param {(status:string) => void} [onStatus]  optional status updates
   */
  constructor(onTrigger, onStatus = () => {}) {
    this.onTrigger = onTrigger;
    this.onStatus = onStatus;
    this.recognition = null;
    this.listening = false;
    this.retries = 0;
    this.silenceTimer = null;
    this.armed = false; // only fire when armed for the current photo
  }

  static get supported() {
    return features.speechRecognition;
  }

  /** Begin listening. Idempotent. */
  start() {
    if (!VoiceTrigger.supported) throw new Error('Speech recognition is not supported.');
    if (this.listening) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event) => {
      if (!this.armed) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase();
        if (VOICE_KEYWORDS.some((kw) => transcript.includes(kw))) {
          this._resetSilence();
          this.armed = false; // debounce until re-armed
          this.onTrigger();
          return;
        }
      }
      this._resetSilence();
    };

    rec.onerror = (event) => {
      // 'no-speech' / 'aborted' are recoverable; restart quietly.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.onStatus('Microphone permission denied.');
        this.stop();
      }
    };

    rec.onend = () => {
      // Auto-restart while we still intend to listen.
      if (this.listening && this.retries < VOICE_MAX_RETRIES) {
        this.retries++;
        try {
          rec.start();
        } catch {
          /* start() throws if already starting; ignore */
        }
      }
    };

    this.recognition = rec;
    this.listening = true;
    this.retries = 0;
    try {
      rec.start();
    } catch {
      /* ignore double-start */
    }
    this._resetSilence();
  }

  /** Arm the trigger so the next keyword fires (called per photo). */
  arm() {
    this.armed = true;
    this.retries = 0;
    this._resetSilence();
    this.onStatus('Say “Cheese”');
  }

  disarm() {
    this.armed = false;
  }

  _resetSilence() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      // Restart recognition after prolonged silence to keep it healthy.
      if (this.listening && this.recognition) {
        try {
          this.recognition.stop();
        } catch {
          /* onend will restart */
        }
      }
    }, VOICE_TIMEOUT_MS);
  }

  stop() {
    this.listening = false;
    this.armed = false;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      try {
        this.recognition.stop();
      } catch {
        /* already stopped */
      }
      this.recognition = null;
    }
  }
}
