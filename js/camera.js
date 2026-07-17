/**
 * camera.js — Camera stream management: start/stop, device switching,
 * and still-frame capture. Wraps getUserMedia and cleans up tracks fully.
 */

const { CAMERA_CONSTRAINTS } = await import('./config.js?v=a762155');
const { features } = await import('./utils.js?v=55065fc');
const { frameFromVideo } = await import('./imageProcessor.js?v=a816397');

export class Camera {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.deviceId = null;
    this.zoomCaps = null; // {min,max,step} | null — MediaTrackCapabilities.zoom
    this.zoomCurrent = 1;
  }

  get isActive() {
    return !!this.stream;
  }

  get zoomSupported() {
    return !!this.zoomCaps;
  }

  /** Apply an absolute zoom value (clamped to capability range). */
  async setZoom(value) {
    if (!this.zoomSupported || !this.isActive) return null;
    const { min, max } = this.zoomCaps;
    const clamped = Math.min(max, Math.max(min, value));
    const track = this.stream.getVideoTracks()[0];
    await track.applyConstraints({ advanced: [{ zoom: clamped }] });
    this.zoomCurrent = clamped;
    return clamped;
  }

  /**
   * Start (or restart) the camera. Optionally targets a specific device.
   * @param {string} [deviceId]
   */
  async start(deviceId) {
    if (!features.getUserMedia) {
      throw new Error('This browser does not support camera access (getUserMedia).');
    }
    this.stop();
    this.zoomCaps = null;

    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { ...CAMERA_CONSTRAINTS.video },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      throw mapCameraError(err);
    }

    const track = this.stream.getVideoTracks()[0];
    this.deviceId = track?.getSettings().deviceId ?? deviceId ?? null;
    this.zoomCaps = track?.getCapabilities?.().zoom ?? null;
    if (this.zoomCaps) {
      const current = track.getSettings().zoom;
      this.zoomCurrent = typeof current === 'number' ? current : this.zoomCaps.min;
    }
    this.video.srcObject = this.stream;
    // Required for autoplay on iOS/Safari.
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play().catch(() => {
      /* play() can reject if interrupted; the stream is still live */
    });
    return this.stream;
  }

  /** List available video input devices (labels require prior permission). */
  async listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  /** Switch to a specific camera device. */
  async switchTo(deviceId) {
    return this.start(deviceId);
  }

  /** Capture the current preview frame as an ImageBitmap (or canvas fallback). */
  async capture() {
    if (!this.isActive) throw new Error('The camera is not running.');
    return frameFromVideo(this.video);
  }

  /** Stop all tracks and release the stream. */
  stop() {
    this.zoomCaps = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }
}

function mapCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new Error('Camera permission was denied. Please allow camera access and retry.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new Error('No suitable camera was found on this device.');
    case 'NotReadableError':
      return new Error('The camera is already in use by another application.');
    default:
      return new Error(`Camera error: ${err?.message || 'unknown error'}.`);
  }
}
