/* Sounds for the keyboard.

   "piano": a soft, clear piano-like note built from eight harmonics. Each harmonic starts with a quick hammer attack and fades
   at its own speed (the upper ones go first, so the note opens with a bright ping and settles into a pure ring), lower notes
   ring longer than higher ones, a tiny noise tick stands in for the hammer, and a light room reverb adds air. The first
   harmonic is exactly the pitch you asked for (the upper ones are only stretched by a trace, as on a real piano), so the
   pitch is always correct.
   "pure": a plain sine that holds as long as the key is held: the best sound for tuning by ear.

   buildVoice() works on any audio context, so the page and the tests share the same code. */

const PARTIALS = [1.0, 0.62, 0.38, 0.24, 0.15, 0.09, 0.05, 0.03];   // relative loudness of harmonics 1 to 8
const INHARMONICITY = 0.0001;                                         // piano strings are very slightly stretched

/** Starts one note on context `c`, sending its sound to `out`. Returns { stop() }, which releases it like a damper. */
export function buildVoice(c, out, freq, kind, when) {
  const t0 = when === undefined ? c.currentTime : when;
  const voice = c.createGain();
  voice.gain.value = 1;
  voice.connect(out);
  const sources = [];

  if (kind === 'pure') {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    osc.connect(gain).connect(voice);
    osc.start(t0);
    sources.push(osc);
  } else {
    const ring = 4.0 * Math.pow(261.63 / Math.max(freq, 130), 0.5);   // seconds: low notes ring longer than high ones
    const tone = c.createBiquadFilter();                               // takes the edge off the top, keeps it clear
    tone.type = 'lowpass';
    tone.frequency.value = Math.min(9000, Math.max(3500, freq * 14));
    tone.Q.value = 0.5;
    tone.connect(voice);
    PARTIALS.forEach((amp, i) => {
      const n = i + 1;
      const f = n * freq * Math.sqrt(1 + INHARMONICITY * (n * n - 1));   // n = 1 is exactly `freq`
      if (f > 11000) return;
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.12 * amp, t0 + 0.004 + 0.0008 * n);                 // hammer attack
      gain.gain.setTargetAtTime(0, t0 + 0.006, ring / (1 + 0.9 * (n - 1)));                   // higher harmonics fade sooner
      osc.connect(gain).connect(tone);
      osc.start(t0);
      sources.push(osc);
    });
    // a very soft hammer tick
    const len = Math.floor(c.sampleRate * 0.03);
    const noise = c.createBuffer(1, len, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const tick = c.createBufferSource();
    tick.buffer = noise;
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = Math.min(4000, freq * 6);
    band.Q.value = 0.8;
    const tickGain = c.createGain();
    tickGain.gain.value = 0.05;
    tick.connect(band).connect(tickGain).connect(voice);
    tick.start(t0);
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      const t = c.currentTime;
      voice.gain.cancelScheduledValues(t);
      voice.gain.setValueAtTime(voice.gain.value, t);
      voice.gain.setTargetAtTime(0, t, 0.09);                         // the damper: a quick, soft release
      sources.forEach((s) => { try { s.stop(t + 0.7); } catch (e) { /* already stopped */ } });
    },
  };
}

// ---------- the page's own audio chain: a light room reverb and a soft limiter ----------
let ctx = null;
let bus = null;

function impulse(c, seconds) {
  const rate = c.sampleRate;
  const len = Math.floor(rate * seconds);
  const buffer = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      prev = 0.55 * prev + 0.45 * (Math.random() * 2 - 1);            // a little dark, so the room is soft, not hissy
      data[i] = prev * Math.pow(1 - i / len, 3.2);
    }
  }
  return buffer;
}

function getBus() {
  if (bus && bus.ctx === ctx) return bus;
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0.17;
  const room = ctx.createConvolver();
  room.buffer = impulse(ctx, 1.7);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.ratio.value = 3;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  input.connect(dry); input.connect(room);
  room.connect(wet);
  dry.connect(master); wet.connect(master);
  master.connect(limiter).connect(ctx.destination);
  bus = { ctx, input };
  return bus;
}

/** Plays a note on the page. kind is "piano" (default) or "pure". Returns a function that releases it. */
export function playTone(freq, kind) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return () => {};
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});       // the click that called us is the user gesture it needs
  const voice = buildVoice(ctx, getBus().input, freq, kind === 'pure' ? 'pure' : 'piano');
  return () => voice.stop();
}
