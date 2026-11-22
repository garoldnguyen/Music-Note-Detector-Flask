/* The drawn parts: pitch meter, keyboard, level bars, waveform and note timeline.
   Everything is plain SVG built here, so there is no chart library and the pixels stay crisp. */

import { svg, midiLabel, t } from './util.js';

// ---------- pitch meter ----------
const METER_MID = 230;
export function buildMeter(el) {
  for (let i = 0; i < 22; i++) svg('rect', { class: 'm-seg', x: 10 + i * 20, y: 22, width: 16, height: 18 }, el);
  svg('rect', { class: 'm-mid-line', x: METER_MID - 1, y: 18, width: 2, height: 26, fill: 'currentColor', opacity: '.35' }, el);
  const mark = svg('g', { class: 'm-markg', visibility: 'hidden' }, el);
  svg('rect', { class: 'm-mark', x: -8, y: 18, width: 16, height: 26 }, mark);
  svg('rect', { class: 'm-pin', x: -2, y: 4, width: 4, height: 12 }, mark);
  return mark;
}
/** cents in -50..50, or null to hide the marker */
export function setMeter(mark, cents) {
  if (cents === null) { mark.setAttribute('visibility', 'hidden'); return; }
  const c = Math.max(-50, Math.min(50, cents));
  mark.setAttribute('transform', 'translate(' + Math.round(METER_MID + c * 4.4) + ' 0)');
  mark.setAttribute('visibility', 'visible');
}

// ---------- keyboard (C4 to B5) ----------
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK = [[1, 29], [3, 71], [6, 155], [8, 197], [10, 239]];   // semitone in the octave, x of the first octave
export function buildKeys(el) {
  const keys = new Map();
  let x = 1;
  for (let octave = 0; octave < 2; octave++) {
    for (const off of WHITE_OFFSETS) {
      const midi = 60 + octave * 12 + off;
      const rect = svg('rect', { class: 'k-w', x, y: 1, width: octave === 1 && off === 11 ? 40 : 42, height: 108, 'data-midi': midi, role: 'button', tabindex: midi === 60 ? '0' : '-1', 'aria-label': midiLabel(midi) }, el);
      keys.set(midi, { rect, cx: x + 21, ty: 100 });
      x += 42;
    }
  }
  for (let octave = 0; octave < 2; octave++) {
    for (const [off, bx] of BLACK) {
      const midi = 60 + octave * 12 + off;
      const rect = svg('rect', { class: 'k-b', x: bx + octave * 294, y: 1, width: 28, height: 66, 'data-midi': midi, role: 'button', tabindex: '-1', 'aria-label': midiLabel(midi) }, el);
      keys.set(midi, { rect, cx: bx + octave * 294 + 14, ty: 58 });
    }
  }
  const lowC = svg('text', { class: 'k-t', x: 22, y: 100, opacity: '.7' }, el); lowC.textContent = 'C4';
  const highC = svg('text', { class: 'k-t', x: 316, y: 100, opacity: '.7' }, el); highC.textContent = 'C5';
  const active = svg('text', { class: 'k-t', x: 0, y: 100 }, el);
  return { keys, active, lowC, highC, current: null };
}
export function setKey(state, midi) {
  if (state.current) { state.current.rect.classList.remove('on'); state.current = null; }
  state.active.textContent = '';
  state.lowC.style.display = state.highC.style.display = '';
  const key = midi === null ? null : state.keys.get(midi);
  if (!key) return false;
  key.rect.classList.add('on');
  state.current = key;
  state.active.setAttribute('x', key.cx);
  state.active.setAttribute('y', key.ty);
  state.active.textContent = midiLabel(midi);
  if (Math.abs(key.cx - 22) < 22) state.lowC.style.display = 'none';
  if (Math.abs(key.cx - 316) < 22) state.highC.style.display = 'none';
  return true;
}

// ---------- input level ----------
export function buildLevel(el) {
  const bars = [];
  for (let i = 0; i < 10; i++) bars.push(svg('rect', { class: 'l-bar idle', x: i * 12, y: 34, width: 8, height: 6 }, el));
  return bars;
}
/** values: ten numbers in 0..1 */
export function setLevel(bars, values) {
  let peak = 0;
  values.forEach((v, i) => { if (v > values[peak]) peak = i; });
  bars.forEach((bar, i) => {
    const h = Math.max(6, Math.round(Math.min(1, values[i]) * 38));
    bar.setAttribute('y', 40 - h);
    bar.setAttribute('height', h);
    bar.setAttribute('class', 'l-bar' + (values[i] <= 0.02 ? ' idle' : i === peak && values[i] > 0.4 ? ' peak' : ''));
  });
}

// ---------- waveform ----------
const WAVE_BARS = 35;
export function drawWave(el, peaks) {
  el.textContent = '';
  const bars = [];
  const list = peaks && peaks.length ? peaks : new Array(WAVE_BARS).fill(0.05);
  list.forEach((p, i) => {
    const half = Math.max(2, Math.round(p * 38));
    bars.push(svg('rect', { class: 'w-off', x: i * 24, y: 40 - half, width: 14, height: half * 2 }, el));
  });
  const head = svg('rect', { class: 'w-head', x: 0, y: 0, width: 3, height: 80 }, el);
  return { bars, head, step: 24, width: 844 };
}
/** fraction 0..1 of the waveform that has been played */
export function setWaveProgress(wave, fraction) {
  const x = Math.round(fraction * wave.width);
  wave.head.setAttribute('x', Math.min(x, wave.width - 3));
  wave.bars.forEach((bar, i) => {
    const on = (i * wave.step + 7) <= x;
    const cls = on ? 'w-on' : 'w-off';
    if (bar.getAttribute('class') !== cls) bar.setAttribute('class', cls);
  });
}

// ---------- note timeline ----------
const octaveClass = (octave) => (octave <= 2 ? 'oct-lo' : octave >= 6 ? 'oct-hi6' : 'oct-' + octave);
const octaveText = (octave) => (octave <= 2 ? '≤2' : octave >= 6 ? '≥6' : String(octave));
const OCT_ORDER = ['oct-lo', 'oct-3', 'oct-4', 'oct-5', 'oct-hi6'];

/** blocks: [{ midi, start, end }] in seconds; returns { head, width, height } for the playhead */
export function drawTimeline(el, axis, legend, blocks, duration) {
  el.textContent = ''; axis.textContent = ''; legend.textContent = '';
  const W = 840;
  if (!blocks.length || !duration) { el.setAttribute('viewBox', '0 0 840 120'); return null; }

  let lo = Math.min(...blocks.map((b) => b.midi)) - 1;
  let hi = Math.max(...blocks.map((b) => b.midi)) + 1;
  while (hi - lo + 1 < 12) { if ((hi - lo) % 2) hi++; else lo--; }
  const rows = hi - lo + 1;
  const rowH = Math.max(6, Math.min(20, Math.floor(240 / rows)));
  const H = rows * rowH;
  el.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

  const labelAll = rows <= 16;
  for (let i = 0; i < rows; i++) {
    const midi = hi - i;
    const span = document.createElement('span');
    const name = midiLabel(midi);
    const natural = !name.includes('#');
    const isC = natural && name.startsWith('C');
    // C rows carry the octave ("C4"); with a small range every natural note is named, otherwise only the C rows
    span.textContent = isC ? name : (natural && labelAll ? name.replace(/\d+$/, '') : '');
    axis.appendChild(span);
    if (isC) svg('rect', { class: 't-grid', x: 0, y: (i + 1) * rowH - 1, width: W, height: 1 }, el);
  }

  const seen = new Set();
  for (const b of blocks) {
    const octave = Math.floor(b.midi / 12) - 1;
    const cls = octaveClass(octave);
    seen.add(cls + '|' + octaveText(octave));
    const x = Math.round((b.start / duration) * W);
    const w = Math.max(4, Math.round(((b.end - b.start) / duration) * W) - 1);
    svg('rect', { class: 't-block ' + cls, x, y: (hi - b.midi) * rowH + 1, width: Math.min(w, W - x), height: Math.max(rowH - 2, 3) }, el);
  }
  const head = svg('rect', { class: 'w-head', x: 0, y: 0, width: 3, height: H }, el);

  const entries = [...seen].map((s) => s.split('|')).sort((a, b) => OCT_ORDER.indexOf(a[0]) - OCT_ORDER.indexOf(b[0]));
  for (const [cls, text] of entries) {
    const item = document.createElement('span');
    const sw = document.createElement('i');
    sw.className = cls;
    sw.style.background = 'var(--' + (cls === 'oct-lo' ? 'lilac' : cls === 'oct-3' ? 'mint' : cls === 'oct-4' ? 'gold' : cls === 'oct-5' ? 'salmon' : 'coral') + ')';
    item.appendChild(sw);
    item.appendChild(document.createTextNode(t('octave') + ' ' + text));
    legend.appendChild(item);
  }
  return { head, width: W };
}
export function setTimelineProgress(tl, fraction) {
  if (tl) tl.head.setAttribute('x', Math.min(Math.round(fraction * tl.width), tl.width - 3));
}
