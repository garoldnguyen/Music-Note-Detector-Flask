/* The file screen: upload, analyze, then summary, waveform with playback, note timeline, results table and export. */

import { $, t, toast, parseNote, centsOff, midiLabel, fmtClock, fmtStamp, fmtBytes, signed, reducedMotion, chips } from './util.js';
import { drawWave, setWaveProgress, drawTimeline, setTimelineProgress } from './viz.js';

const MAX_BYTES = 50 * 1024 * 1024;
const EXTENSIONS = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'wma', 'mp4', 'aac', 'acc'];
const PAGE_SIZE = 10;
const HOP = { quick: 1.0, standard: 0.25, advanced: 0.1 };   // seconds between readings, from config.py
const FILE_EXT = { csv: 'csv', excel: 'xlsx', txt: 'txt' };

export function initUpload() {
  const el = {
    drop: $('dropZone'), input: $('audioFile'), info: $('fileInfo'), name: $('fileName'), meta: $('fileMeta'),
    analyze: $('analyzeBtn'), progress: $('progress'), progBar: $('progBar'), progVal: $('progVal'),
    results: $('results'), sumNotes: $('sumNotes'), sumRange: $('sumRange'), sumCommon: $('sumCommon'), sumConf: $('sumConf'),
    player: document.querySelector('.player'), play: $('playBtn'), playText: $('playText'), time: $('timeText'), playMsg: $('playMsg'),
    waveSvg: $('waveSvg'), seek: $('seek'), timeSvg: $('timeSvg'), yAxis: $('yAxis'), legend: $('legend'), timeEmpty: $('timeEmpty'),
    search: $('search'), prev: $('prevBtn'), next: $('nextBtn'), pageInfo: $('pageInfo'), rows: $('rows'),
  };

  const s = {
    file: null, upload: null, token: 0, run: 0, results: [], filtered: [], page: 1, mode: 'standard',
    audio: null, objectUrl: null, wave: null, timeline: null, duration: 0, waveSpan: 0, peaks: null, raf: 0,
  };

  // ---------- helpers ----------
  const mode = () => (document.querySelector('input[name="mode"]:checked') || {}).value || 'standard';
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function cleanupServerFile() {
    if (s.upload && navigator.sendBeacon) {
      navigator.sendBeacon('/cleanup', new Blob([JSON.stringify({ filename: s.upload.filename })], { type: 'application/json' }));
    }
  }

  function reset() {
    stopAudio();
    if (s.objectUrl) URL.revokeObjectURL(s.objectUrl);
    cleanupServerFile();
    s.token++; s.run++;
    Object.assign(s, { file: null, upload: null, results: [], filtered: [], page: 1, audio: null, objectUrl: null, wave: null, timeline: null, duration: 0, waveSpan: 0, peaks: null });
    el.results.hidden = true; el.progress.hidden = true;
    el.info.hidden = true; el.drop.hidden = false;
    el.analyze.disabled = true;
    el.input.value = '';
  }

  // ---------- choose and upload ----------
  async function choose(file) {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!EXTENSIONS.includes(ext) && !(file.type || '').startsWith('audio/')) { toast(t('err_type'), 'error'); return; }
    if (file.size > MAX_BYTES) { toast(t('err_size'), 'error'); return; }

    reset();
    const token = ++s.token;
    s.file = file;
    el.name.textContent = file.name;
    chips(el.meta, [fmtBytes(file.size), t('file_uploading')]);
    el.drop.hidden = true; el.info.hidden = false;

    const form = new FormData();
    form.append('file', file);
    let response, data = {};
    try {
      response = await fetch('/upload', { method: 'POST', body: form });
      data = await response.json().catch(() => ({}));
    } catch (error) {
      if (token === s.token) { toast(t('err_network'), 'error'); reset(); }
      return;
    }
    if (token !== s.token) {   // another file was chosen meanwhile
      if (data && data.filename) navigator.sendBeacon('/cleanup', new Blob([JSON.stringify({ filename: data.filename })], { type: 'application/json' }));
      return;
    }
    if (!response.ok || !data.success) {
      toast(response.status === 413 ? t('err_size') : t('err_upload') + (data.error ? ' ' + data.error : ''), 'error');
      reset();
      return;
    }
    s.upload = data;
    s.duration = data.duration || 0;
    chips(el.meta, [fmtClock(s.duration), fmtBytes(file.size), data.format]);
    el.analyze.disabled = false;
    prepareAudio();
  }

  // ---------- audio playback ----------
  function prepareAudio() {
    s.objectUrl = URL.createObjectURL(s.file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = s.objectUrl;
    audio.addEventListener('ended', () => { stopAudio(); setProgress(0); });
    audio.addEventListener('error', () => { el.playMsg.hidden = false; el.play.disabled = true; });
    s.audio = audio;
    el.playMsg.hidden = true; el.play.disabled = false;
  }

  function stopAudio() {
    if (s.audio) s.audio.pause();
    cancelAnimationFrame(s.raf);
    if (el.player) el.player.dataset.playing = 'false';
    el.playText.textContent = t('play');
  }

  function loop() {
    if (!s.audio || s.audio.paused) return;
    setProgress(s.audio.currentTime);
    s.raf = requestAnimationFrame(loop);
  }

  function setProgress(seconds) {
    const total = s.duration || (s.audio && s.audio.duration) || 0;
    const fraction = total ? Math.min(1, seconds / total) : 0;
    if (s.wave) setWaveProgress(s.wave, s.waveSpan ? Math.min(1, seconds / s.waveSpan) : 0);
    setTimelineProgress(s.timeline, fraction);
    el.time.textContent = fmtClock(seconds) + ' / ' + fmtClock(total);
    el.seek.value = Math.round(fraction * 1000);
  }

  async function togglePlay() {
    if (!s.audio) return;
    if (s.audio.paused) {
      try { await s.audio.play(); } catch (error) { el.playMsg.hidden = false; return; }
      el.player.dataset.playing = 'true';
      el.playText.textContent = t('pause');
      s.raf = requestAnimationFrame(loop);
    } else {
      stopAudio();
    }
  }

  function seekTo(seconds) {
    if (!s.audio) return;
    s.audio.currentTime = Math.max(0, Math.min(seconds, s.duration || seconds));
    setProgress(s.audio.currentTime);
  }
  const fractionOf = (event, svgEl) => { const r = svgEl.getBoundingClientRect(); return Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)); };

  // ---------- waveform peaks ----------
  async function getPeaks() {
    if (s.peaks) return s.peaks;
    const BARS = 35;
    const toPeaks = (data) => {
      const size = Math.max(1, Math.floor(data.length / BARS));
      const out = [];
      for (let i = 0; i < BARS; i++) {
        let max = 0;
        for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j++) max = Math.max(max, Math.abs(data[j]));
        out.push(max);
      }
      const top = Math.max(...out, 1e-6);
      return out.map((v) => Math.sqrt(v / top));
    };
    try {   // the whole file, decoded in the browser at a low sample rate (cheap)
      if (s.file.size > 40 * 1024 * 1024) throw new Error('too big to decode here');
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC({ sampleRate: 8000 });
      const decoded = await ctx.decodeAudioData(await s.file.arrayBuffer());
      ctx.close().catch(() => {});
      s.waveSpan = decoded.duration;
      s.peaks = toPeaks(decoded.getChannelData(0));
      return s.peaks;
    } catch (error) {   // formats the browser cannot decode: the server draws the first 30 seconds
      try {
        const response = await post('/visualize', { filename: s.upload.filename });
        const data = await response.json();
        if (data.success) {
          s.waveSpan = Math.min(s.duration || 30, 30);
          s.peaks = toPeaks(data.visualizations.waveform.y);
          return s.peaks;
        }
      } catch (inner) { /* no waveform, the bars stay flat */ }
    }
    return null;
  }

  // ---------- analyze ----------
  async function analyze() {
    if (!s.upload) return;
    const run = ++s.run;
    s.mode = mode();
    stopAudio();
    el.results.hidden = true;
    el.progress.hidden = false;
    el.analyze.disabled = true;
    el.progBar.parentElement.classList.add('indet');
    el.progBar.style.width = ''; el.progVal.textContent = '';
    const spin = el.progress.querySelector('.spin');
    const flip = reducedMotion() ? 0 : setInterval(() => spin.classList.toggle('flip'), 450);
    const poll = setInterval(async () => {
      try {
        const p = (await (await fetch('/progress/' + encodeURIComponent(s.upload.filename))).json()).progress;
        if (p > 0 && run === s.run) { el.progBar.parentElement.classList.remove('indet'); el.progBar.style.width = p + '%'; el.progVal.textContent = p + '%'; }
      } catch (error) { /* the next tick tries again */ }
    }, 800);

    const peaksPromise = getPeaks();
    let data = {}, ok = false;
    try {
      const response = await post('/analyze', { filename: s.upload.filename, mode: s.mode });
      data = await response.json().catch(() => ({}));
      ok = response.ok && data.success;
    } catch (error) { data = { error: t('err_network') }; }
    clearInterval(poll); clearInterval(flip);
    if (run !== s.run) return;
    el.progress.hidden = true;
    el.analyze.disabled = false;
    if (!ok) { toast(t('analysis_failed') + (data.error ? ': ' + data.error : ''), 'error'); return; }

    const peaks = await peaksPromise;
    if (run !== s.run) return;
    s.results = (data.results || [])
      .filter((r) => r.frequency > 0 && parseNote(r.note) !== null)
      .map((r) => { const midi = parseNote(r.note); return { ...r, midi, cents: Math.round(centsOff(r.frequency, midi, 440)) }; });
    render(peaks);
    toast(t('analysis_done'));
  }

  // ---------- results ----------
  function render(peaks) {
    el.results.hidden = false;
    const list = s.results;

    // summary
    el.sumNotes.textContent = String(list.length);
    if (list.length) {
      const midis = list.map((r) => r.midi);
      el.sumRange.textContent = midiLabel(Math.min(...midis)) + ' – ' + midiLabel(Math.max(...midis));
      const counts = new Map();
      list.forEach((r) => counts.set(r.note, (counts.get(r.note) || 0) + 1));
      const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      chips(el.sumCommon, [top, n + '×']);
      const avg = list.reduce((sum, r) => sum + (r.confidence <= 1 ? r.confidence : r.confidence / 100), 0) / list.length;
      el.sumConf.textContent = Math.round(avg * 100) + '%';
    } else {
      el.sumRange.textContent = el.sumCommon.textContent = el.sumConf.textContent = '—';
    }

    // waveform and timeline
    s.wave = drawWave(el.waveSvg, peaks);
    const hop = estimateHop(list);
    const duration = s.duration || (list.length ? list[list.length - 1].time + hop : 0);
    const blocks = mergeBlocks(list, hop);
    s.timeline = drawTimeline(el.timeSvg, el.yAxis, el.legend, blocks, duration);
    el.timeSvg.parentElement.hidden = !blocks.length;
    el.timeEmpty.hidden = blocks.length > 0;
    el.legend.hidden = !blocks.length;
    setProgress(0);

    // table
    el.search.value = '';
    s.filtered = list; s.page = 1;
    renderTable();
    el.results.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  function estimateHop(list) {
    const gaps = [];
    for (let i = 1; i < list.length; i++) { const d = list[i].time - list[i - 1].time; if (d > 0) gaps.push(d); }
    gaps.sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : HOP[s.mode] || 0.25;
  }

  function mergeBlocks(list, hop) {
    const blocks = [];
    for (const r of list) {
      const last = blocks[blocks.length - 1];
      if (last && last.midi === r.midi && r.time - last.end <= hop * 1.5) last.end = r.time + hop;
      else blocks.push({ midi: r.midi, start: r.time, end: r.time + hop });
    }
    return blocks;
  }

  function renderTable() {
    const total = Math.max(1, Math.ceil(s.filtered.length / PAGE_SIZE));
    s.page = Math.min(s.page, total);
    const slice = s.filtered.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
    el.rows.textContent = '';
    if (!slice.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5; td.className = 'none'; td.textContent = t('no_match');
      tr.appendChild(td); el.rows.appendChild(tr);
    }
    for (const r of slice) {
      const tr = document.createElement('tr');
      const cells = [
        [fmtStamp(r.time), ''], [r.note, 'n'], [r.frequency.toFixed(1) + ' Hz', ''],
        [signed(r.cents), ''], [Math.round((r.confidence <= 1 ? r.confidence : r.confidence / 100) * 100) + '%', ''],
      ];
      for (const [text, cls] of cells) { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); }
      el.rows.appendChild(tr);
    }
    el.pageInfo.textContent = t('page_of', { n: s.page, total });
    el.prev.disabled = s.page <= 1;
    el.next.disabled = s.page >= total;
  }

  async function exportAs(format, button) {
    if (!s.results.length) return;
    button.disabled = true;
    try {
      const base = s.file.name.replace(/\.[^.]+$/, '');
      const response = await post('/export/' + format, { results: s.results, filename: base });
      if (!response.ok) throw new Error('export');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'note_detection_' + base + '.' + FILE_EXT[format];
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      toast(t('export_saved'));
    } catch (error) {
      toast(t('export_failed'), 'error');
    } finally {
      button.disabled = false;
    }
  }

  // ---------- events ----------
  el.input.addEventListener('change', (e) => choose(e.target.files && e.target.files[0]));
  ['dragenter', 'dragover'].forEach((type) => el.drop.addEventListener(type, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((type) => el.drop.addEventListener(type, (e) => { e.preventDefault(); el.drop.classList.remove('over'); }));
  el.drop.addEventListener('drop', (e) => choose(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));
  el.analyze.addEventListener('click', analyze);
  el.play.addEventListener('click', togglePlay);
  el.seek.addEventListener('input', () => seekTo((el.seek.value / 1000) * (s.duration || 0)));
  el.waveSvg.addEventListener('click', (e) => seekTo(fractionOf(e, el.waveSvg) * (s.waveSpan || s.duration || 0)));
  el.timeSvg.addEventListener('click', (e) => seekTo(fractionOf(e, el.timeSvg) * (s.duration || 0)));
  el.search.addEventListener('input', () => {
    const q = el.search.value.trim().toLowerCase();
    s.filtered = q ? s.results.filter((r) => fmtStamp(r.time).includes(q) || r.note.toLowerCase().includes(q)) : s.results;
    s.page = 1; renderTable();
  });
  el.prev.addEventListener('click', () => { s.page--; renderTable(); });
  el.next.addEventListener('click', () => { s.page++; renderTable(); });
  document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export, b)));
  addEventListener('pagehide', () => { cleanupServerFile(); });
}
