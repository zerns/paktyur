/**
 * camera.js — Camera stream management: start/stop, device switching,
 * and still-frame capture. Wraps getUserMedia and cleans up tracks fully.
 */

import { CAMERA_CONSTRAINTS } from './config.js?v=cfbed35d';
import { features } from './utils.js?v=cfbed35d';
import { frameFromVideo } from './imageProcessor.js?v=cfbed35d';

export class Camera {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.deviceId = null;
  }

  get isActive() {
    return !!this.stream;
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

    this.deviceId = this.stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? null;
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
