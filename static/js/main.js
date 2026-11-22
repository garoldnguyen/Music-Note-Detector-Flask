/* Entry point: theme, tabs, bottom bar, language links, then the two screens. */

import { $, reducedMotion } from './util.js';
import { initLive } from './live.js';
import { initUpload } from './upload.js';

// ---------- theme ----------
const root = document.documentElement;
const themeBtn = $('themeBtn');
function applyThemeLabel() {
  const dark = root.dataset.theme === 'dark';
  themeBtn.setAttribute('aria-label', dark ? themeBtn.dataset.toLight : themeBtn.dataset.toDark);
}
themeBtn.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('nd-theme', next); } catch (e) { /* private mode: the choice just is not remembered */ }
  applyThemeLabel();
});
applyThemeLabel();

// ---------- tabs (and the phone bottom bar) ----------
const tabs = { mic: $('tab-mic'), upload: $('tab-upload') };
const views = { mic: $('view-mic'), upload: $('view-upload') };
const bottom = [...document.querySelectorAll('.bottom [data-go]')];

function show(name, focus) {
  for (const key of Object.keys(tabs)) {
    const on = key === name;
    tabs[key].classList.toggle('on', on);
    tabs[key].setAttribute('aria-selected', String(on));
    tabs[key].tabIndex = on ? 0 : -1;
    views[key].hidden = !on;
  }
  bottom.forEach((b) => b.classList.toggle('on', b.dataset.go === name));
  if (focus) tabs[name].focus();
  history.replaceState(null, '', name === 'upload' ? '#upload' : location.pathname + location.search);
}
tabs.mic.addEventListener('click', () => show('mic'));
tabs.upload.addEventListener('click', () => show('upload'));
for (const key of Object.keys(tabs)) {
  tabs[key].addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(key === 'mic' ? 'upload' : 'mic', true); }
  });
}
bottom.forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.go === 'settings') {
    show('mic');
    $('settings').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    bottom.forEach((x) => x.classList.toggle('on', x === b));
  } else {
    show(b.dataset.go);
    window.scrollTo(0, 0);
  }
}));
if (location.hash === '#upload') show('upload');

// ---------- language links keep the open tab ----------
document.querySelectorAll('a[data-lang]').forEach((a) => a.addEventListener('click', (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  location.href = a.getAttribute('href') + (views.upload.hidden ? '' : '#upload');
}));

initLive();
initUpload();
