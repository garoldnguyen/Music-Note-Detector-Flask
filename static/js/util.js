/* Small shared helpers: words, DOM, toasts, note maths. */

let words = {};
try { words = JSON.parse(document.getElementById('i18n').textContent) || {}; } catch (e) { words = {}; }

/** A word from i18n/<lang>.json, with {name} placeholders filled from vars. */
export function t(key, vars) {
  let s = typeof words[key] === 'string' ? words[key] : key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', vars[k]);
  return s;
}

export const $ = (id) => document.getElementById(id);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Create an SVG element with attributes and (optionally) append it to a parent. */
export function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

/** A small pixel message in the corner: kind is "info" or "error". */
export function toast(message, kind) {
  const box = $('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'error' ? ' error' : '');
  const tpl = $(kind === 'error' ? 'alertIcon' : 'checkIcon');
  if (tpl) el.appendChild(tpl.content.cloneNode(true));
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

// ---------- notes ----------
export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Frequency of a MIDI note for a reference pitch (A4 = ref Hz, MIDI 69). */
export const midiToFreq = (midi, ref = 440) => ref * Math.pow(2, (midi - 69) / 12);

export function midiLabel(midi) {
  return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/** "A4" or "C#5" to a MIDI number; null for anything else (for example "—"). */
export function parseNote(label) {
  const m = /^([A-G]#?)(-?\d+)$/.exec(String(label || '').trim());
  return m ? (parseInt(m[2], 10) + 1) * 12 + NAMES.indexOf(m[1]) : null;
}

/** Cents between a frequency and the nearest-note frequency of `midi` (positive is sharp). */
export const centsOff = (freq, midi, ref = 440) => 1200 * Math.log2(freq / midiToFreq(midi, ref));

export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
/** 75.25 seconds to "01:15.25" (the format of the results table and of the search box). */
export function fmtStamp(seconds) {
  const total = Math.max(0, seconds || 0);
  const m = Math.floor(total / 60), s = Math.floor(total % 60), c = Math.floor((total - Math.floor(total)) * 100);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0');
}
export function fmtBytes(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}
export const signed = (n) => (n > 0 ? '+' + n : String(n));

/** Fill an element with separate little boxes, one per piece of information, instead of one line split by dots.
 *  A hidden comma sits between them so a screen reader still reads them as one list. */
export function chips(el, parts) {
  el.textContent = '';
  el.classList.add('chips');
  parts.filter(Boolean).forEach((text, i) => {
    if (i > 0) {
      const gap = document.createElement('span');
      gap.className = 'sr';
      gap.textContent = ', ';
      el.appendChild(gap);
    }
    const box = document.createElement('span');
    box.className = 'chip plain';
    box.textContent = text;
    el.appendChild(box);
  });
}
