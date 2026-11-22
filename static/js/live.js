/* The microphone screen: start/stop, the big note, the pitch meter, the keyboard, level bars, recent notes. */

import { $, t, signed, midiLabel, midiToFreq, toast, chips } from './util.js';
import { playTone } from './tone.js';
import { Detector } from './detector.js';
import { buildMeter, setMeter, buildKeys, setKey, buildLevel, setLevel } from './viz.js';

const RECENT_MAX = 8;

export function initLive() {
  const page = document.querySelector('.page');
  const meter = buildMeter($('meter'));
  const keys = buildKeys($('keys'));
  const levelBars = buildLevel($('level'));
  const levelHistory = new Array(10).fill(0);

  const el = {
    status: $('statusText'), badge: $('badge'), noteBox: $('noteBox'), name: $('noteName'), oct: $('noteOct'),
    hz: $('hz'), cents: $('cents'), conf: $('confBar'), confVal: $('confVal'), tile: $('micTile'),
    title: $('micTitle'), hint: $('micHint'), start: $('startBtn'), reset: $('resetBtn'), msg: $('micMsg'),
    recent: $('recent'), sr: $('srNote'), keysSvg: $('keys'),
  };

  let shownMidi = null;       // the note on screen
  let lastRecent = null;      // the last note put into "recent notes"

  function showNone() {
    shownMidi = null;
    el.name.textContent = '—'; el.oct.textContent = ''; el.name.classList.add('none');
    el.hz.textContent = '— Hz'; el.cents.textContent = '';
    el.badge.hidden = true; el.noteBox.classList.remove('hold');
    setMeter(meter, null); setKey(keys, null);
    el.keysSvg.setAttribute('aria-label', t('keyboard_label'));
  }

  function showNote(r, holding) {
    const name = r.label.replace(/\d+$/, '');
    el.name.textContent = name; el.name.classList.remove('none');
    el.oct.textContent = r.label.slice(name.length);
    el.hz.textContent = r.freq.toFixed(1) + ' Hz';
    el.cents.textContent = signed(r.cents) + ' ' + t('cents_unit');
    el.noteBox.classList.toggle('hold', !!holding);
    el.badge.hidden = false;
    const inTune = Math.abs(r.cents) <= 5;
    el.badge.className = 'chip badge' + (inTune ? '' : ' off');
    el.badge.textContent = inTune ? t('badge_in_tune') : r.cents > 0 ? t('badge_sharp') : t('badge_flat');
    setMeter(meter, r.cents);
    setKey(keys, r.midi);
    el.keysSvg.setAttribute('aria-label', t('keyboard_label') + ', ' + r.label);
    if (r.midi !== shownMidi) {
      shownMidi = r.midi;
      el.sr.textContent = r.label + ', ' + (inTune ? t('badge_in_tune') : Math.abs(r.cents) + ' ' + t('cents_unit') + ' ' + (r.cents > 0 ? t('badge_sharp') : t('badge_flat')));
    }
    if (!holding && r.midi !== lastRecent) { lastRecent = r.midi; pushRecent(r.label); }
  }

  function pushRecent(label) {
    const empty = el.recent.querySelector('.empty');
    if (empty) empty.remove();
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = label;
    el.recent.prepend(chip);
    while (el.recent.children.length > RECENT_MAX) el.recent.lastElementChild.remove();
  }

  const emptyNode = el.recent.querySelector('.empty').cloneNode(true);   // "the notes you sing will appear here", with its sprite
  function clearRecent() {
    el.recent.textContent = '';
    el.recent.appendChild(emptyNode.cloneNode(true));
    lastRecent = null;
  }

  function setState(state) {
    page.dataset.live = state === 'on' ? 'on' : 'off';
    el.tile.dataset.state = state;
    el.start.disabled = state === 'asking';
    el.start.textContent = state === 'on' ? t('btn_stop') : t('btn_start');
    el.start.classList.toggle('p', state !== 'on');
    el.status.textContent = state === 'on' ? t('status_listening') : state === 'asking' ? t('status_asking') : t('status_ready');
    el.title.textContent = el.status.textContent;
    el.hint.textContent = state === 'on' ? t('mic_hint_listening') : t('mic_hint_idle');
  }

  const detector = new Detector({
    onFrame(result, level, confidence) {
      levelHistory.push(Math.min(1, Math.sqrt(level) * 2.2)); levelHistory.shift();
      setLevel(levelBars, levelHistory);
      if (result) {
        if (result.kind === 'note') {
          showNote(result, false);
          el.conf.style.width = Math.round(result.confidence * 100) + '%';
          el.confVal.textContent = Math.round(result.confidence * 100) + '%';
        } else if (result.kind === 'hold') {
          showNote(result, true);
        } else if (result.kind === 'none') {
          showNone();
          el.conf.style.width = '0%'; el.confVal.textContent = '0%';
        } else if (result.kind === 'weak') {
          el.conf.style.width = Math.round(result.confidence * 100) + '%';
        }
      }
      if (!result || result.kind === 'quiet') {
        el.conf.style.width = Math.round(confidence * 30) + '%';
      }
    },
    onStop() {
      setState('idle');
      setLevel(levelBars, new Array(10).fill(0));
      levelHistory.fill(0);
      showNone();
      el.conf.style.width = '0%'; el.confVal.textContent = '0%';
    },
  });

  async function start() {
    el.msg.hidden = true;
    setState('asking');
    try {
      await detector.start();
      setState('on');
      toast(t('mic_connected'));
    } catch (error) {
      const name = error && error.name;
      setState('idle');
      el.tile.dataset.state = 'off';
      el.msg.textContent = name === 'NotAllowedError' || name === 'SecurityError' ? t('mic_denied')
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? t('mic_missing') : t('mic_error');
      el.msg.hidden = false;
    }
  }

  el.start.addEventListener('click', () => { if (detector.running) detector.stop(); else start(); });
  el.reset.addEventListener('click', () => { detector.reset(); showNone(); clearRecent(); el.sr.textContent = ''; });

  $('refPitch').addEventListener('change', (e) => { detector.setReference(parseFloat(e.target.value)); showNone(); });
  $('sens').addEventListener('input', (e) => detector.setSensitivity(parseFloat(e.target.value)));

  // ---------- the keyboard is playable: click, tap or press Enter or Space on a key to hear that note ----------
  const soundSel = $('keySound');
  try { const saved = localStorage.getItem('nd-keysound'); if (saved === 'piano' || saved === 'pure') soundSel.value = saved; } catch (e) { /* not remembered */ }
  soundSel.addEventListener('change', () => { try { localStorage.setItem('nd-keysound', soundSel.value); } catch (e) { /* not remembered */ } });
  const keyHint = $('keyHint');
  const hintIdle = keyHint.textContent;
  let held = null;
  const refHz = () => parseFloat($('refPitch').value) || 440;
  function pressKey(midi) {
    releaseKey();
    const key = keys.keys.get(midi);
    if (!key) return;
    const freq = midiToFreq(midi, refHz());
    held = { midi, stop: playTone(freq, $('keySound').value) };
    key.rect.classList.add('press');
    chips(keyHint, [midiLabel(midi), freq.toFixed(2) + ' Hz']);   // two decimals, so it can be compared with a frequency table
  }
  function releaseKey() {
    if (!held) return;
    held.stop();
    const key = keys.keys.get(held.midi);
    if (key) key.rect.classList.remove('press');
    held = null;
    keyHint.classList.remove('chips');
    keyHint.textContent = hintIdle;
  }
  const midiOf = (target) => { const r = target.closest && target.closest('[data-midi]'); return r ? parseInt(r.dataset.midi, 10) : null; };
  el.keysSvg.addEventListener('pointerdown', (e) => { const m = midiOf(e.target); if (m === null) return; e.preventDefault(); pressKey(m); });
  el.keysSvg.addEventListener('pointerover', (e) => { if (e.buttons !== 1 || !held) return; const m = midiOf(e.target); if (m !== null && m !== held.midi) pressKey(m); });   // slide across the keys
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => el.keysSvg.addEventListener(type, releaseKey));
  addEventListener('blur', releaseKey);
  el.keysSvg.addEventListener('keydown', (e) => {
    const m = midiOf(e.target);
    if (m === null) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) pressKey(m); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = keys.keys.get(m + (e.key === 'ArrowRight' ? 1 : -1));
      if (next) { keys.keys.get(m).rect.setAttribute('tabindex', '-1'); next.rect.setAttribute('tabindex', '0'); next.rect.focus(); }
    }
  });
  el.keysSvg.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') releaseKey(); });

  // free the microphone when the page goes away
  addEventListener('pagehide', () => detector.stop());

  setState('idle');
  showNone();
  setLevel(levelBars, levelHistory);
}
