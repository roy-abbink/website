// Audio: afspelen van Franse spraak (normaal en langzaam, apart gegenereerd) en microfoonopname.
// De audio wordt alleen in het geheugen van deze pagina bewaard en bij een nieuwe sessie opgeruimd.

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export class AudioPlayer {
  constructor(api) {
    this.api = api;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.cache = new Map(); // "style|tekst" → Promise<objectURL>
    this.token = 0;
    this.failures = 0;
    this.disabledReason = '';
  }

  /** Aanroepen vanuit een klik (“Begin met oefenen”), zodat Safari/iPadOS later afspelen toestaat. */
  unlock() {
    try {
      this.el.src = SILENT_WAV;
      const p = this.el.play();
      if (p) p.catch(() => {});
    } catch { /* niets */ }
  }

  get available() { return !this.disabledReason; }

  load(text, style = 'normal') {
    const key = style + '|' + text;
    if (!this.cache.has(key)) {
      const p = this.api.tts(text, style).then((blob) => URL.createObjectURL(blob));
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return this.cache.get(key);
  }

  prefetch(text) {
    if (this.available) this.load(text, 'normal').catch(() => {});
  }

  /**
   * Speelt Franse tekst af. Resultaat: 'played', 'blocked' (browser blokkeert automatisch afspelen),
   * 'failed' (audio kon niet worden gemaakt) of 'cancelled' (intussen iets anders gestart).
   */
  async play(text, style = 'normal') {
    if (!this.available) return 'failed';
    const my = ++this.token;
    this.stop(false);
    let url;
    try {
      url = await this.load(text, style);
      this.failures = 0;
    } catch (e) {
      this.failures++;
      if (e && (e.code === 'not_configured' || e.code === 'no_voice')) this.disabledReason = e.message;
      else if (this.failures >= 3) this.disabledReason = 'De audio werkt nu niet.';
      return 'failed';
    }
    if (my !== this.token) return 'cancelled';
    this.el.src = url;
    try {
      await this.el.play();
      return 'played';
    } catch (e) {
      if (my !== this.token) return 'cancelled';
      return e && e.name === 'NotAllowedError' ? 'blocked' : 'failed';
    }
  }

  stop(bumpToken = true) {
    if (bumpToken) this.token++;
    try { this.el.pause(); } catch { /* niets */ }
  }

  reset() {
    this.stop();
    for (const p of this.cache.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    this.cache.clear();
    this.failures = 0;
    this.disabledReason = '';
  }
}

export const MAX_RECORD_SECONDS = 6;

export class Recorder {
  constructor() {
    this.stream = null;
    this.rec = null;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  /** Start een opname. Vraagt pas op dit moment om microfoontoestemming. */
  async start(onTick) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.done = new Promise((resolve) => {
      this.rec.onstop = () => {
        this.release();
        resolve(new Blob(this.chunks, { type: this.rec.mimeType || mimeType || 'audio/webm' }));
      };
    });
    this.rec.start();
    const started = Date.now();
    this.timer = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      if (onTick) onTick(s);
      if (s >= MAX_RECORD_SECONDS) this.stop();
    }, 200);
    return this.done;
  }

  stop() {
    clearInterval(this.timer);
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
  }

  release() {
    clearInterval(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
