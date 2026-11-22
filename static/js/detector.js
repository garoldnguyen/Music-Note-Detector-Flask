/* Live pitch detection from the microphone.

   The algorithm is the one the app always had (normalised autocorrelation with a pre-emphasis filter, a sub-harmonic
   check and parabolic interpolation), now with a reference pitch, a sensitivity setting and a "stabiliser" that
   turns the raw readings into a steady note. No UI in here. */

import { midiLabel, midiToFreq, centsOff } from './util.js';

const CFG = {
  maxRms: 0.95, minZcr: 0.0, maxZcr: 0.4,
  minFreq: 65, maxFreq: 4500,
  correlationThreshold: 0.45,
  agreement: 0.4, minSamples: 4, noiseRejection: 0.1,
  historySize: 20, holdMs: 1000,
};

/** Sensitivity 0..100 (default 60) to the two thresholds the old code had fixed (0.01 and 0.35). */
export function thresholdsFor(sens) {
  const s = Math.min(100, Math.max(0, sens)) / 100;
  return { minRms: 0.03 * Math.pow(0.004 / 0.03, s), minConfidence: 0.5 - 0.25 * s };
}

/** Autocorrelation pitch of one buffer: { frequency, confidence } or { frequency: -1, confidence: 0 }. */
export function autoCorrelate(buffer, sampleRate, minRms) {
  const SIZE = buffer.length;
  let sumSq = 0, crossings = 0;
  for (let i = 0; i < SIZE; i++) {
    sumSq += buffer[i] * buffer[i];
    if (i > 0 && Math.sign(buffer[i]) !== Math.sign(buffer[i - 1])) crossings++;
  }
  const rms = Math.sqrt(sumSq / SIZE);
  if (rms < minRms || rms > CFG.maxRms) return { frequency: -1, confidence: 0 };
  const zcr = crossings / SIZE;
  if (zcr < CFG.minZcr || zcr > CFG.maxZcr) return { frequency: -1, confidence: 0 };

  const filtered = new Float32Array(SIZE);   // pre-emphasis
  filtered[0] = buffer[0];
  for (let i = 1; i < SIZE; i++) filtered[i] = buffer[i] - 0.97 * buffer[i - 1];

  const MIN = Math.floor(sampleRate / CFG.maxFreq);
  const MAX = Math.floor(sampleRate / CFG.minFreq);
  const corr = new Float32Array(MAX + 1);
  let maxCorr = 0;
  const prefix = new Float64Array(SIZE + 1);   // prefix[k] = energy of the first k samples: the normaliser for each offset
  for (let i = 0; i < SIZE; i++) prefix[i + 1] = prefix[i] + filtered[i] * filtered[i];
  for (let offset = MIN; offset < MAX; offset++) {
    let c = 0;
    for (let i = 0; i < SIZE - offset; i++) c += filtered[i] * filtered[i + offset];
    const norm = prefix[SIZE - offset];
    c = norm > 0 ? c / norm : 0;
    corr[offset] = c;
    if (c > maxCorr) maxCorr = c;
  }
  if (maxCorr < CFG.correlationThreshold) return { frequency: -1, confidence: 0 };

  // first strong local peak (the highest fundamental), not a sub-harmonic
  const threshold = maxCorr * 0.95;
  let best = -1, bestCorr = 0;
  for (let offset = MIN + 1; offset < MAX - 1; offset++) {
    if (corr[offset] >= threshold && corr[offset] > corr[offset - 1] && corr[offset] > corr[offset + 1]) { best = offset; bestCorr = corr[offset]; break; }
  }
  if (best === -1) {
    for (let offset = MIN; offset < MAX; offset++) if (corr[offset] === maxCorr) { best = offset; bestCorr = maxCorr; break; }
  }
  if (best === -1) return { frequency: -1, confidence: 0 };

  let refined = best;   // parabolic interpolation
  if (best > MIN && best < MAX - 1) {
    const y1 = corr[best - 1], y2 = corr[best], y3 = corr[best + 1];
    const a = (y1 - 2 * y2 + y3) / 2, b = (y3 - y1) / 2;
    if (a < 0) refined += -b / (2 * a);
  }
  const frequency = sampleRate / refined;
  if (frequency < CFG.minFreq || frequency > CFG.maxFreq) return { frequency: -1, confidence: 0 };
  return { frequency, confidence: Math.min(1, bestCorr * 2) };
}

/** Turns noisy readings into a steady note: majority vote over the last readings, a short hold after the sound stops. */
export class Stabilizer {
  constructor() { this.reset(); }
  reset() { this.midis = []; this.freqs = []; this.last = null; this.lastTime = 0; }

  /** Returns { kind: 'note' | 'hold' | 'none', ... } or null when nothing should change yet. */
  push(freq, confidence, ref, minConfidence) {
    const now = performance.now();
    if (freq > 0 && confidence > minConfidence) {
      const midi = Math.round(69 + 12 * Math.log2(freq / ref));
      this.midis.push(midi); this.freqs.push(freq);
      if (this.midis.length > CFG.historySize) { this.midis.shift(); this.freqs.shift(); }
      if (this.midis.length < CFG.minSamples) return null;

      const recent = this.midis.slice(-10);
      const counts = new Map();
      for (const m of recent) counts.set(m, (counts.get(m) || 0) + 1);
      let top = recent[0], topCount = 0;
      for (const [m, c] of counts) if (c > topCount) { top = m; topCount = c; }
      if (topCount < recent.length * CFG.agreement) return { kind: 'weak', confidence: confidence * 0.3 };

      const sorted = this.freqs.slice(-10).sort((x, y) => x - y);
      const freqMedian = sorted[Math.floor(sorted.length / 2)];
      const result = {
        kind: 'note', midi: top, label: midiLabel(top), freq: freqMedian,
        cents: Math.round(centsOff(freqMedian, top, ref)),
        confidence: confidence * 0.3 + (confidence * topCount / recent.length) * 0.7,
      };
      this.last = result; this.lastTime = now;
      return result;
    }
    if (confidence < CFG.noiseRejection) {
      for (let i = 0; i < Math.min(3, this.midis.length); i++) { this.midis.pop(); this.freqs.pop(); }
      if (this.midis.length === 0) {
        if (this.last && now - this.lastTime < CFG.holdMs) return { kind: 'hold', ...this.last };
        this.last = null;
        return { kind: 'none' };
      }
    }
    return { kind: 'quiet' };
  }
}

/** Opens the microphone and calls onFrame(result, level) about 30 times a second while running. */
export class Detector {
  constructor({ onFrame, onStop }) {
    this.onFrame = onFrame; this.onStop = onStop;
    this.running = false; this.ref = 440; this.thresholds = thresholdsFor(60);
    this.stab = new Stabilizer();
  }
  setReference(hz) { this.ref = hz; this.stab.reset(); }
  setSensitivity(v) { this.thresholds = thresholdsFor(v); }
  reset() { this.stab.reset(); }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const e = new Error('no mediaDevices'); e.name = 'NotSupportedError'; throw e;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, autoGainControl: true, noiseSuppression: true, channelCount: 1 },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});   // not awaited: it only settles after a user gesture, and the click that started us is one
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0.3;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.running = true;
    this.lastRun = 0;
    this.stab.reset();
    const tick = (time) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      if (time - this.lastRun < 33) return;
      this.lastRun = time;
      this.analyser.getFloatTimeDomainData(this.buffer);
      let sum = 0;
      for (let i = 0; i < this.buffer.length; i += 8) sum += this.buffer[i] * this.buffer[i];
      const level = Math.sqrt(sum / (this.buffer.length / 8));
      const { frequency, confidence } = autoCorrelate(this.buffer, this.ctx.sampleRate, this.thresholds.minRms);
      this.onFrame(this.stab.push(frequency, confidence, this.ref, this.thresholds.minConfidence), level, frequency > 0 ? confidence : 0);
    };
    this.raf = requestAnimationFrame(tick);
    // the stream can end by itself (device unplugged, permission revoked)
    this.stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => this.stop()));
  }

  stop() {
    if (!this.running && !this.stream) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    if (this.source) { try { this.source.disconnect(); } catch (e) { /* already gone */ } }
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close().catch(() => {});
    this.stream = this.source = this.analyser = this.ctx = null;
    this.stab.reset();
    if (this.onStop) this.onStop();
  }
}

export { midiToFreq };
