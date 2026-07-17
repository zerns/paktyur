/**
 * microphone.js — Microphone permission + voice ("Cheese") capture trigger
 * using the Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 *
 * Continuous, case-insensitive keyword matching with a silence timeout and
 * automatic retry. Reports availability so the app can fall back to gesture
 * mode when the mic or speech recognition is unavailable.
 */

const {
  VOICE_KEYWORDS,
  VOICE_TIMEOUT_MS,
  VOICE_MAX_RETRIES,
  VOICE_PROMPT_DELAY_MS,
  PROMPT_SOUND_URL,
  STT_LAG_MARGIN_MS,
  EXTRA_MATCH_WINDOW_MS,
  ZOOM_VOICE_KEYWORDS,
} = await import('./config.js?v=a762155');
const { features } = await import('./utils.js?v=55065fc');

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
  constructor(onTrigger, onStatus = () => {}, onZoom = () => {}) {
    this.onTrigger = onTrigger;
    this.onStatus = onStatus;
    this.onZoom = onZoom;
    this.zoomActive = false; // recognize zoom commands only during idle session
    this.recognition = null;
    this.listening = false;
    this.retries = 0;
    this.silenceTimer = null;
    this.promptTimer = null;
    this.suppressed = false; // true while the cue itself is playing — ignore results
    this.firedAt = 0; // timestamp of the match that started the current capture
    this.extraMatchPending = false; // a stray duplicate "cheese" was heard mid-capture
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
      if (this.suppressed) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase();
        if (this.zoomActive) {
          if (ZOOM_VOICE_KEYWORDS.reset.some((kw) => transcript.includes(kw))) {
            this.onZoom('reset');
            return;
          }
          if (ZOOM_VOICE_KEYWORDS.in.some((kw) => transcript.includes(kw))) {
            this.onZoom('in');
            return;
          }
          if (ZOOM_VOICE_KEYWORDS.out.some((kw) => transcript.includes(kw))) {
            this.onZoom('out');
            return;
          }
        }
        if (VOICE_KEYWORDS.some((kw) => transcript.includes(kw))) {
          if (this.armed) {
            this._resetSilence();
            this._clearPrompt();
            this.armed = false; // debounce until re-armed
            this.firedAt = Date.now();
            this.extraMatchPending = false;
            this.onTrigger();
          } else if (Date.now() - this.firedAt < EXTRA_MATCH_WINDOW_MS) {
            // A stray duplicate "cheese" said before this photo finished
            // capturing — remember it so the next arm() doesn't auto-fire
            // from a late-arriving recognition result for this utterance.
            this.extraMatchPending = true;
          }
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
    this._startPrompt();
    if (this.extraMatchPending) {
      // A leftover "cheese" from the previous photo may still be in flight
      // through recognition — swallow results briefly so it can't fire this
      // new arm before the user says it again on purpose.
      this.extraMatchPending = false;
      this.suppressed = true;
      setTimeout(() => {
        this.suppressed = false;
      }, STT_LAG_MARGIN_MS);
    }
  }

  disarm() {
    this.armed = false;
    this.suppressed = false;
    this.extraMatchPending = false;
    this._clearPrompt();
  }

  /** Enable/disable zoom voice commands (idle-session only). */
  setZoomEnabled(on) {
    this.zoomActive = on;
  }

  /** Speak "Say cheese" once if the user stays silent after arming. */
  _startPrompt() {
    this._clearPrompt();
    this.promptTimer = setTimeout(() => {
      if (this.armed) this._speakPrompt();
    }, VOICE_PROMPT_DELAY_MS);
  }

  _clearPrompt() {
    if (this.promptTimer) clearTimeout(this.promptTimer);
    this.promptTimer = null;
  }

  /**
   * Play the recorded "Say cheese" cue through WebAudio — the same output
   * path as the shutter beep, which is proven audible during a session.
   * (Both speechSynthesis and a plain <audio> element stayed silent while
   * SpeechRecognition holds the mic.)
   */
  async _speakPrompt() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = (VoiceTrigger._audioCtx ||= new Ctx());
      if (ctx.state === 'suspended') await ctx.resume();
      // Fetch + decode once, then reuse the buffer for every prompt.
      if (!VoiceTrigger._promptBuffer) {
        const res = await fetch(PROMPT_SOUND_URL);
        const data = await res.arrayBuffer();
        VoiceTrigger._promptBuffer = await ctx.decodeAudioData(data);
      }
      const buffer = VoiceTrigger._promptBuffer;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);

      // The mic can pick up the cue's own "cheese" and self-trigger a
      // capture. SpeechRecognition results lag noticeably behind the audio
      // that produced them (cloud STT round-trip), so unsuppressing right
      // when playback ends isn't enough — keep ignoring results for a bit
      // after the cue finishes too.
      this.suppressed = true;
      setTimeout(() => {
        this.suppressed = false;
      }, buffer.duration * 1000 + STT_LAG_MARGIN_MS);

      src.start();
    } catch {
      /* audio cue is optional */
    }
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
    this.zoomActive = false;
    this.suppressed = false;
    this.extraMatchPending = false;
    this._clearPrompt();
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
