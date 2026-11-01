"use strict";

const $ = (sel, el = document) => el.querySelector(sel);

const STEMS = {
  vocals: { label: "Vocals", color: "#ff5c8a", icon: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>' },
  drums: { label: "Drums", color: "#ff9f43", icon: '<ellipse cx="12" cy="9" rx="8" ry="3"/><path d="M4 9v6c0 1.7 3.6 3 8 3s8-1.3 8-3V9M8 3l3 5M16 3l-3 5"/>' },
  bass: { label: "Bass", color: "#a77bff", icon: '<path d="M20 4l-7 7M18 2l4 4"/><path d="M13 11c-2-2-5-1-6 1l-3 3c-1 2 0 5 3 5 2 0 3-1 4-2l2-1c2-1 2-4 0-6z"/><circle cx="9" cy="15" r="1"/>' },
  guitar: { label: "Guitar", color: "#3ddc84", icon: '<path d="M20 4l-6 6M18 2l4 4"/><path d="M14 10c-2-2-5-1.5-6 .5-.5 1-2 1.5-3 2-2 1-2 4 0 6s5 2 6 0c.5-1 1-2.5 2-3 2-1 2.5-4 1-5.5z"/><circle cx="10" cy="14" r="1.5"/>' },
  piano: { label: "Piano", color: "#ffd23f", icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v10M12 4v10M16 4v10M8 14v6M12 14v6M16 14v6"/>' },
  other: { label: "Other", color: "#4dabff", icon: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
};
const GUITAR_COLORS = ["#3ddc84", "#a3e635", "#2dd4bf", "#86efac"];
for (const [i, color] of GUITAR_COLORS.entries()) {
  STEMS[`guitar_${i + 1}`] = { label: `Guitar ${i + 1}`, color, icon: STEMS.guitar.icon };
}
STEMS.vocal_1 = { label: "Vocal 1", color: STEMS.vocals.color, icon: STEMS.vocals.icon };
STEMS.vocal_2 = { label: "Vocal 2", color: "#f472b6", icon: STEMS.vocals.icon };
const STEM_ORDER = ["vocals", "vocal_1", "vocal_2", "drums", "bass", "guitar", "guitar_1", "guitar_2", "guitar_3", "guitar_4", "piano", "other"];
const MODEL_INFO = {
  htdemucs_6s: { title: "Vocals, Drums, Bass, Guitar, Piano, Other", note: "6 tracks", stems: ["vocals", "drums", "bass", "guitar", "piano", "other"] },
  htdemucs_ft: { title: "Vocals, Drums, Bass, Other", note: "Hi-Fi · best quality, ~4× slower", stems: ["vocals", "drums", "bass", "other"] },
  htdemucs: { title: "Vocals, Drums, Bass, Other", note: "Fast", stems: ["vocals", "drums", "bass", "other"] },
  htdemucs_6s_guitars: { title: "Vocal 1–2, Drums, Bass, Guitar 1–4, Piano, Other", note: "Splits guitars and vocals by where they sit in the stereo mix", stems: ["vocal_1", "vocal_2", "drums", "bass", "guitar_1", "guitar_2", "piano", "other"] },
};

const sortStems = (names) => [...names].sort((a, b) => STEM_ORDER.indexOf(a) - STEM_ORDER.indexOf(b));
const stemMeta = (name) => STEMS[name] || { label: name, color: "#8a90a2", icon: STEMS.other.icon };
const MAX_SEMITONES = 12;
const TRIM_MIN = 0.05; // seconds a trimmed track keeps at least
const TRIM_STEP = 0.01;
const TRIM_KEY_STEP = 0.1;
const TRIM_FADE = 0.005; // seconds, so a cut doesn't click
const fmtKey = (n) => (n > 0 ? `+${n}` : String(n));
const stemUrl = (id, name, semitones) =>
  `/api/songs/${id}/stems/${encodeURIComponent(name)}${semitones ? `?semitones=${semitones}` : ""}`;
const NOTE_NAMES = {
  major: ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"],
  minor: ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"],
};
const keyName = (key, shift = 0) => `${NOTE_NAMES[key.mode][(((key.tonic + shift) % 12) + 12) % 12]} ${key.mode}`;
const icon = (paths) => `<svg viewBox="0 0 24 24">${paths}</svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return "–";
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(ts) {
  const d = new Date(ts * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function coverGradient(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 60) % 360} 70% 40%))`;
}

function setFill(range) {
  const pct = ((range.value - range.min) / (range.max - range.min)) * 100;
  range.style.setProperty("--fill", pct + "%");
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

/* =========================== Library =========================== */

let songs = [];
let info = null;

async function refreshSongs() {
  try {
    songs = await api("/api/songs");
    renderLibrary();
    if (!$("#study-view").classList.contains("hidden")) renderStudySongs();
  } catch (e) {
    console.error(e);
  }
}

function statusCell(song) {
  switch (song.status) {
    case "queued":
      return `<div class="status queued">In queue…</div>`;
    case "processing": {
      const pct = Math.round(song.progress * 100);
      return `<div class="status"><span>Separating… ${pct}%</span><div class="bar"><div style="width:${pct}%"></div></div></div>`;
    }
    case "error":
      return `<div class="status error" title="${esc(song.error || "")}">Failed</div>`;
    default:
      return `<div class="status"><div class="chips">${sortStems(song.stems)
        .map((s) => `<span class="chip-dot" style="background:${stemMeta(s).color}" title="${esc(stemMeta(s).label)}"></span>`)
        .join("")}</div></div>`;
  }
}

function renderLibrary() {
  const q = $("#search").value.trim().toLowerCase();
  const list = songs.filter((s) => s.title.toLowerCase().includes(q));
  $("#empty").classList.toggle("hidden", songs.length > 0);
  $(".song-table").classList.toggle("hidden", songs.length === 0);
  $("#song-list").innerHTML = list
    .map((s) => {
      const model = MODEL_INFO[s.model];
      return `<div class="song-row ${s.status}" data-id="${s.id}">
        <div class="cover" style="background:${coverGradient(s.id)}">${icon(STEMS.other.icon)}</div>
        <div class="song-title" title="${esc(s.title)}">${esc(s.title)}</div>
        <div class="sep">${esc([model ? model.note : s.model, s.key?.confidence && keyName(s.key)].filter(Boolean).join(" · "))}</div>
        <div class="muted">${fmtTime(s.duration)}</div>
        ${statusCell(s)}
        <div class="muted">${fmtDate(s.created)}</div>
        <button class="icon-btn row-delete" data-delete="${s.id}" title="Delete">${icon('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>')}</button>
      </div>`;
    })
    .join("");
}

$("#song-list").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-delete]");
  if (del) {
    e.stopPropagation();
    const song = songs.find((s) => s.id === del.dataset.delete);
    if (!confirm(`Delete "${song.title}" and its stems?`)) return;
    try {
      await api(`/api/songs/${song.id}`, { method: "DELETE" });
      refreshSongs();
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  const row = e.target.closest(".song-row");
  if (!row) return;
  const song = songs.find((s) => s.id === row.dataset.id);
  if (song.status === "ready") location.hash = `#/song/${song.id}`;
  else if (song.status === "error") toast(`Separation failed: ${song.error}`, true);
  else toast("Still separating, hang tight…");
});

$("#search").addEventListener("input", renderLibrary);

/* =========================== Upload =========================== */

let pendingFiles = [];
let selectedModel = null;

function openModal(files = []) {
  pendingFiles = [];
  addFiles(files);
  $("#upload-progress").classList.add("hidden");
  $("#modal").classList.remove("hidden");
}

function closeModal() {
  $("#modal").classList.add("hidden");
}

function addFiles(files) {
  for (const f of files) {
    if (f.type.startsWith("audio/") || /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?|wma|mp4)$/i.test(f.name)) pendingFiles.push(f);
  }
  $("#file-list").innerHTML = pendingFiles
    .map((f) => `<li><span>${esc(f.name)}</span><span class="muted">${(f.size / 1048576).toFixed(1)} MB</span></li>`)
    .join("");
  $("#submit-upload").disabled = pendingFiles.length === 0;
}

function renderModelOptions() {
  for (const [sel, name] of [["#model-options", "model"], ["#separate-options", "separate-model"]]) {
    $(sel).innerHTML = modelOptionsHtml(name);
  }
}

function modelOptionsHtml(name) {
  return info.models
    .map((m) => {
      const mi = MODEL_INFO[m.id] || { title: m.id, note: m.description, stems: [] };
      return `<label class="model-option ${m.id === selectedModel ? "selected" : ""}">
        <input type="radio" name="${name}" value="${m.id}" ${m.id === selectedModel ? "checked" : ""}>
        <div class="opt-text"><strong>${esc(mi.title)}</strong><span>${esc(mi.note)}</span></div>
        <div class="chips">${mi.stems.map((s) => `<span class="chip-dot" style="background:${stemMeta(s).color}"></span>`).join("")}</div>
      </label>`;
    })
    .join("");
}

for (const sel of ["#model-options", "#separate-options"]) {
  $(sel).addEventListener("change", (e) => {
    selectedModel = e.target.value;
    renderModelOptions();
  });
}

$("#file-input").addEventListener("change", (e) => {
  addFiles(e.target.files);
  e.target.value = "";
});

const dz = $("#dropzone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dz.classList.remove("over");
  addFiles(e.dataTransfer.files);
});

$("#submit-upload").addEventListener("click", () => {
  const form = new FormData();
  pendingFiles.forEach((f) => form.append("files", f));
  form.append("model", selectedModel);
  const bar = $("#upload-progress");
  bar.classList.remove("hidden");
  $("#submit-upload").disabled = true;

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/songs");
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) bar.firstElementChild.style.width = (e.loaded / e.total) * 100 + "%"; };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      closeModal();
      toast(`${pendingFiles.length} song(s) added to the queue`);
      if (location.hash === "#/study") JSON.parse(xhr.responseText).forEach((s) => studyUploads.add(s.id));
      else location.hash = "#/";
      refreshSongs();
    } else {
      let msg = "Upload failed";
      try { msg = JSON.parse(xhr.responseText).detail; } catch {}
      toast(msg, true);
      $("#submit-upload").disabled = false;
    }
  };
  xhr.onerror = () => { toast("Upload failed", true); $("#submit-upload").disabled = false; };
  xhr.send(form);
});

document.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "upload") openModal();
  if (action === "close-modal") closeModal();
  if (action === "close-separate") $("#separate-modal").classList.add("hidden");
});
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
$("#separate-modal").addEventListener("click", (e) => { if (e.target.id === "separate-modal") e.target.classList.add("hidden"); });

// Drop files anywhere on the page.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e) || !$("#modal").classList.contains("hidden")) return;
  dragDepth++;
  $("#drop-overlay").classList.remove("hidden");
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) { dragDepth = 0; $("#drop-overlay").classList.add("hidden"); }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").classList.add("hidden");
  if (e.dataTransfer.files.length && $("#modal").classList.contains("hidden")) openModal(e.dataTransfer.files);
});

/* =========================== Mixer =========================== */

class Mixer {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: 44100 });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.tracks = [];
    this.playing = false;
    this.offset = 0;
    this.startedAt = 0;
    this.loop = false;
    this.duration = 0;
  }

  addTrack(name, buffer) {
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    const track = { name, buffer, gain, volume: 1, muted: false, solo: false, source: null, semitones: 0, applied: 0, trim: null, trimmed: null };
    this.tracks.push(track);
    this.duration = Math.max(this.duration, buffer.duration);
    this.applyGains();
    return track;
  }

  get time() {
    if (!this.playing) return this.offset;
    let t = this.offset + Math.max(0, this.ctx.currentTime - this.startedAt);
    if (this.loop) t %= this.duration;
    return Math.min(t, this.duration);
  }

  play() {
    if (this.playing || !this.tracks.length) return;
    if (this.offset >= this.duration - 0.01) this.offset = 0;
    this.ctx.resume();
    const when = this.ctx.currentTime + 0.03;
    for (const t of this.tracks) {
      const src = this.ctx.createBufferSource();
      src.buffer = t.trimmed || t.buffer;
      src.loop = this.loop;
      src.connect(t.gain);
      src.start(when, this.offset);
      t.source = src;
    }
    this.startedAt = when;
    this.playing = true;
  }

  stopSources() {
    for (const t of this.tracks) {
      if (!t.source) continue;
      try { t.source.stop(); } catch {}
      t.source.disconnect();
      t.source = null;
    }
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time;
    this.stopSources();
    this.playing = false;
  }

  seek(t) {
    const wasPlaying = this.playing;
    this.pause();
    this.offset = Math.min(Math.max(0, t), this.duration);
    if (wasPlaying) this.play();
  }

  setLoop(on) {
    const wasPlaying = this.playing;
    this.pause();
    this.loop = on;
    if (wasPlaying) this.play();
  }

  audible(t) {
    const anySolo = this.tracks.some((x) => x.solo);
    return anySolo ? t.solo : !t.muted;
  }

  applyGains() {
    for (const t of this.tracks) {
      t.gain.gain.setTargetAtTime(this.audible(t) ? t.volume : 0, this.ctx.currentTime, 0.015);
    }
  }

  // Swap several tracks' audio at once, so they stay in sync through the change.
  swapBuffers(changes) {
    const wasPlaying = this.playing;
    this.pause();
    for (const { track, semitones, buffer } of changes) {
      Object.assign(track, { buffer, applied: semitones });
      track.trimmed = this.silenceOutsideTrim(track);
    }
    if (wasPlaying) this.play();
  }

  // Trims never touch the stem: the track plays a copy that's silent outside them, so it stays in sync.
  setTrim(track, start, end) {
    const wasPlaying = this.playing;
    this.pause();
    track.trim = start > 0 || end < track.buffer.duration - TRIM_STEP ? { start, end } : null;
    track.trimmed = this.silenceOutsideTrim(track);
    if (wasPlaying) this.play();
  }

  silenceOutsideTrim({ buffer, trim }) {
    if (!trim) return null;
    const rate = buffer.sampleRate;
    const first = Math.round(trim.start * rate);
    const last = Math.min(Math.round(trim.end * rate), buffer.length);
    const fade = Math.min(Math.round(TRIM_FADE * rate), Math.floor((last - first) / 2));
    const copy = this.ctx.createBuffer(buffer.numberOfChannels, buffer.length, rate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = copy.getChannelData(c);
      data.set(buffer.getChannelData(c).subarray(first, last), first);
      for (let i = 0; i < fade; i++) {
        data[first + i] *= i / fade;
        data[last - 1 - i] *= i / fade;
      }
    }
    return copy;
  }

  async renderMix() {
    const len = Math.max(...this.tracks.map((t) => t.buffer.length));
    const off = new OfflineAudioContext(2, len, this.tracks[0].buffer.sampleRate);
    for (const t of this.tracks) {
      const g = this.audible(t) ? t.volume * this.master.gain.value : 0;
      if (g === 0) continue;
      const src = off.createBufferSource();
      src.buffer = t.trimmed || t.buffer;
      const gain = off.createGain();
      gain.gain.value = g;
      src.connect(gain).connect(off.destination);
      src.start();
    }
    return encodeWav(await off.startRendering());
  }

  destroy() {
    this.stopSources();
    this.ctx.close();
  }
}

function encodeWav(buffer) {
  const ch = buffer.numberOfChannels, n = buffer.length, sr = buffer.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); out.setUint32(4, 36 + n * ch * 2, true); str(8, "WAVE");
  str(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, "data"); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

/* =========================== Player =========================== */

let mixer = null;
let current = null; // { song, peaks, rows: [{track, canvas, playhead, ...}] }
let rafId = null;
let loadToken = 0;
let waveOff = "#3a3f4f"; // silent track's bars; follows the theme
let waveDim = "59"; // hex alpha of bars not played yet; follows the theme

function drawWave(row) {
  const { canvas, peaks, track } = row;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; row.bars = null; }
  const barW = 2 * dpr, gap = 1 * dpr, step = barW + gap;
  if (!row.bars) {
    const n = Math.floor(w / step);
    row.bars = Array.from({ length: n }, (_, i) => {
      const a = Math.floor((i / n) * peaks.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * peaks.length));
      let m = 0;
      for (let j = a; j < b; j++) m = Math.max(m, peaks[j]);
      return m;
    });
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const color = stemMeta(track.name).color;
  const audible = mixer.audible(track) && track.volume > 0;
  const progress = mixer.duration ? mixer.time / mixer.duration : 0;
  const playedX = progress * w;
  const mid = h / 2, maxH = h * 0.8;
  row.bars.forEach((v, i) => {
    const x = i * step;
    const bh = Math.max(1.5 * dpr, Math.sqrt(v) * maxH);
    ctx.fillStyle = !audible ? waveOff : x < playedX ? color : color + waveDim;
    ctx.fillRect(x, mid - bh / 2, barW, bh);
  });
}

function updateTransport() {
  if (!mixer) return;
  const t = mixer.time;
  $("#time-cur").textContent = fmtTime(t);
  const pct = mixer.duration ? t / mixer.duration : 0;
  if (!seekDragging) {
    $("#seek").value = Math.round(pct * 1000);
    setFill($("#seek"));
  }
  for (const row of current.rows) {
    row.playhead.style.left = `calc(${pct * 100}% - 1px)`;
    drawWave(row);
  }
  if (mixer.playing && !mixer.loop && t >= mixer.duration) {
    mixer.pause();
    mixer.offset = 0;
  }
  $("#play").classList.toggle("playing", mixer.playing);
}

function tick() {
  updateTransport();
  rafId = requestAnimationFrame(tick);
}

function trackRowHtml(name, i) {
  const m = stemMeta(name);
  return `<div class="track" data-i="${i}" style="--c:${m.color}">
    <div class="track-controls">
      <div class="track-top">
        <div class="stem-icon">${icon(m.icon)}</div>
        <div class="track-name">${esc(m.label)}</div>
        <button class="ms mute" title="Mute">M</button>
        <button class="ms solo" title="Solo">S</button>
        <a class="icon-btn track-dl" title="Download ${esc(m.label)}" href="${stemUrl(current.song.id, name, 0)}" download>
          ${icon('<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>')}
        </a>
      </div>
      <div class="vol-row">
        <input class="range vol" type="range" min="0" max="100" value="100" style="--c:${m.color}">
        <span class="vol-val">100</span>
      </div>
      <div class="key">
        <span class="key-label">Key</span>
        <button class="ms key-down" title="Down a semitone">−</button>
        <span class="key-val">0</span>
        <button class="ms key-up" title="Up a semitone">+</button>
      </div>
    </div>
    <div class="wave">
      <canvas></canvas><div class="playhead"></div>
      <div class="trim-shade start"></div><div class="trim-shade end"></div>
      <button class="trim-handle start" title="Drag to trim the start. Double-click to undo." aria-label="Trim start of ${esc(m.label)}"></button>
      <button class="trim-handle end" title="Drag to trim the end. Double-click to undo." aria-label="Trim end of ${esc(m.label)}"></button>
      <span class="trim-time hidden"></span>
    </div>
  </div>`;
}

function refreshTrackStates() {
  for (const row of current.rows) {
    const t = row.track;
    row.el.querySelector(".mute").classList.toggle("on", t.muted);
    row.el.querySelector(".solo").classList.toggle("on", t.solo);
    row.el.classList.toggle("silent", !mixer.audible(t) || t.volume === 0);
    const vol = row.el.querySelector(".vol");
    vol.value = Math.round(t.volume * 100);
    setFill(vol);
    row.el.querySelector(".vol-val").textContent = vol.value;
    row.el.querySelector(".key .key-val").textContent = fmtKey(t.semitones ?? 0);
    row.el.querySelector(".key-down").disabled = t.semitones <= -MAX_SEMITONES;
    row.el.querySelector(".key-up").disabled = t.semitones >= MAX_SEMITONES;
    row.el.querySelector(".track-dl").href = stemUrl(current.song.id, t.name, t.semitones ?? 0);
    drawWave(row);
  }
  mixer.applyGains();
  const keys = new Set(mixer.tracks.map((t) => t.semitones));
  $("#song-key-val").textContent = keys.size > 1 ? "Mixed" : fmtKey([...keys][0] ?? 0);
  renderKey(keys.size > 1 ? null : [...keys][0] ?? 0);
  const shifted = mixer.tracks.filter((t) => t.semitones).map((t) => `${t.name}:${t.semitones}`);
  const trims = mixer.tracks.filter((t) => t.trim).map((t) => `${t.name}:${t.trim.start.toFixed(2)}-${t.trim.end.toFixed(2)}`);
  const query = new URLSearchParams();
  if (shifted.length) query.set("transpose", shifted.join(","));
  if (trims.length) query.set("trim", trims.join(","));
  $("#download-zip").href = `/api/songs/${current.song.id}/zip${query.size ? `?${query}` : ""}`;
}

/* ---------- Trim ---------- */

const trimKey = (id) => `abraham.trims.${id}`;
const trimEnd = (t) => t.trim?.end ?? mixer.duration;

function saveTrims() {
  const trims = Object.fromEntries(mixer.tracks.filter((t) => t.trim).map((t) => [t.name, t.trim]));
  try { localStorage.setItem(trimKey(current.song.id), JSON.stringify(trims)); } catch {}
}

function loadTrims() {
  let trims = {};
  try { trims = JSON.parse(localStorage.getItem(trimKey(current.song.id))) || {}; } catch {}
  for (const t of mixer.tracks) {
    if (trims[t.name]) mixer.setTrim(t, trims[t.name].start, trims[t.name].end);
  }
}

function placeTrim(row, start, end) {
  const left = (start / mixer.duration) * 100, right = (end / mixer.duration) * 100;
  row.el.querySelector(".trim-shade.start").style.width = `${left}%`;
  row.el.querySelector(".trim-shade.end").style.left = `${right}%`;
  row.el.querySelector(".trim-handle.start").style.left = `${left}%`;
  row.el.querySelector(".trim-handle.end").style.left = `${right}%`;
}

const fmtTrim = (t) => `${fmtTime(t)}.${Math.floor((t % 1) * 10)}`;

function applyTrim(row, start, end) {
  mixer.setTrim(row.track, start, end);
  placeTrim(row, start, end);
  saveTrims();
  refreshTrackStates();
}

function bindTrim(row) {
  const t = row.track;
  const wave = row.el.querySelector(".wave");
  const label = row.el.querySelector(".trim-time");
  const limited = (side, time) => (side === "start"
    ? Math.min(Math.max(time, 0), trimEnd(t) - TRIM_MIN)
    : Math.max(Math.min(time, mixer.duration), (t.trim?.start ?? 0) + TRIM_MIN));
  const place = (side, time) => placeTrim(row, side === "start" ? time : t.trim?.start ?? 0, side === "end" ? time : trimEnd(t));
  const commit = (side, time) => applyTrim(row, side === "start" ? time : t.trim?.start ?? 0, side === "end" ? time : trimEnd(t));

  for (const side of ["start", "end"]) {
    const handle = row.el.querySelector(`.trim-handle.${side}`);
    let held = null;
    const timeAt = (e) => {
      const r = wave.getBoundingClientRect();
      return limited(side, ((e.clientX - r.left) / r.width) * mixer.duration);
    };
    handle.onpointerdown = (e) => {
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      held = timeAt(e);
    };
    handle.onpointermove = (e) => {
      if (held === null) return;
      held = timeAt(e);
      place(side, held);
      label.textContent = fmtTrim(held);
      label.style.left = `${(held / mixer.duration) * 100}%`;
      label.classList.remove("hidden");
    };
    handle.onpointerup = () => {
      if (held === null) return;
      label.classList.add("hidden");
      commit(side, held);
      held = null;
    };
    handle.onpointercancel = handle.onpointerup;
    handle.ondblclick = () => commit(side, side === "start" ? 0 : mixer.duration);
    handle.onkeydown = (e) => {
      const step = (e.shiftKey ? 10 : 1) * TRIM_KEY_STEP;
      const by = { ArrowLeft: -step, ArrowRight: step }[e.code];
      if (!by) return;
      e.preventDefault();
      e.stopPropagation();
      commit(side, limited(side, (side === "start" ? t.trim?.start ?? 0 : trimEnd(t)) + by));
    };
  }

  row.el.querySelector(".track-dl").onclick = (e) => {
    if (!t.trimmed) return;
    e.preventDefault();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(encodeWav(t.trimmed));
    a.download = `${current.song.title} - ${t.name} trimmed.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  placeTrim(row, t.trim?.start ?? 0, trimEnd(t));
}

// Shows the detected key, and where a transposition has moved it. `shift` is null for mixed keys.
function renderKey(shift) {
  const el = $("#song-key-name"), key = current?.key;
  el.classList.toggle("hidden", !key?.confidence);
  if (!key?.confidence) return;
  const original = keyName(key);
  el.textContent = shift === null ? `Key: ${original} (tracks mixed)` : shift ? `Key: ${keyName(key, shift)} (was ${original})` : `Key: ${original}`;
  el.title = `Detected from the audio, ${Math.round(key.confidence * 100)}% match. Songs can also be heard in their relative major or minor.`;
}

/* Transposing happens on the server, so several quick clicks are gathered into one change. */

let transposeTimer;
let transposeRun = 0;

function setTransposing(on) {
  $("#song-key").classList.toggle("busy", on);
  $("#song-key .key-label").textContent = on ? "Transposing…" : "Song key";
  $("#export-mix").disabled = on;
}

function shiftTracks(tracks, by) {
  for (const t of tracks) t.semitones = Math.min(Math.max(t.semitones + by, -MAX_SEMITONES), MAX_SEMITONES);
  refreshTrackStates();
  scheduleTranspose();
}

function scheduleTranspose() {
  clearTimeout(transposeTimer);
  transposeRun++;
  setTransposing(true);
  transposeTimer = setTimeout(applyTranspose, 400);
}

async function applyTranspose() {
  const run = transposeRun, target = mixer, songId = current.song.id;
  const pending = target.tracks.filter((t) => t.semitones !== t.applied);
  try {
    const changes = await Promise.all(
      pending.map(async (track) => {
        const semitones = track.semitones;
        const res = await fetch(stemUrl(songId, track.name, semitones));
        if (!res.ok) throw new Error(`Couldn't transpose ${track.name}`);
        return { track, semitones, buffer: await target.ctx.decodeAudioData(await res.arrayBuffer()) };
      })
    );
    if (run !== transposeRun) return;
    target.swapBuffers(changes);
  } catch (e) {
    if (run !== transposeRun) return;
    pending.forEach((t) => { t.semitones = t.applied; });
    refreshTrackStates();
    toast(e.message, true);
  }
  setTransposing(false);
}

async function openPlayer(id) {
  closePlayer();
  const token = ++loadToken;
  $("#tracks").innerHTML = "";
  $("#player-title").textContent = "";
  $("#tracks-loading").classList.remove("hidden");
  $("#loading-text").textContent = "Loading song…";

  let song, peaks;
  try {
    song = await api(`/api/songs/${id}`);
    if (song.status !== "ready") throw new Error("This song isn't separated yet");
    peaks = await api(`/api/songs/${id}/peaks`);
  } catch (e) {
    toast(e.message, true);
    location.hash = "#/";
    return;
  }
  if (token !== loadToken) return;

  $("#player-title").textContent = song.title;
  $("#player-sub").textContent = `${(MODEL_INFO[song.model] || { title: song.model }).title} · ${fmtTime(song.duration)}`;
  $("#download-zip").href = `/api/songs/${id}/zip`;
  $("#time-total").textContent = fmtTime(song.duration);
  $("#time-cur").textContent = "0:00";

  const names = sortStems(song.stems);
  mixer = new Mixer();
  mixer.master.gain.value = $("#master").value / 100;
  mixer.duration = song.duration;
  $("#loop").classList.remove("on");
  current = { song, rows: [], key: song.key };
  renderKey(0);
  if (!song.key) {
    api(`/api/songs/${id}/key`).then((key) => { if (token === loadToken) { current.key = key; refreshTrackStates(); } }).catch(console.error);
  }
  $("#tracks").innerHTML = names.map(trackRowHtml).join("");

  // Show waveforms immediately from precomputed peaks; audio decodes in the background.
  const placeholders = names.map((name) => ({ name, volume: 1, muted: false, solo: false }));
  current.rows = names.map((name, i) => {
    const el = $(`.track[data-i="${i}"]`);
    return { el, track: placeholders[i], peaks: peaks[name] || [], canvas: el.querySelector("canvas"), playhead: el.querySelector(".playhead") };
  });
  current.rows.forEach(drawWave);

  let loaded = 0;
  $("#loading-text").textContent = `Loading stems 0/${names.length}…`;
  try {
    const buffers = await Promise.all(
      names.map(async (name) => {
        const res = await fetch(stemUrl(id, name, 0));
        if (!res.ok) throw new Error(`Couldn't load ${name}`);
        const buf = await mixer.ctx.decodeAudioData(await res.arrayBuffer());
        if (token === loadToken) $("#loading-text").textContent = `Loading stems ${++loaded}/${names.length}…`;
        return buf;
      })
    );
    if (token !== loadToken) return;
    mixer.duration = 0;
    current.rows.forEach((row, i) => { row.track = mixer.addTrack(names[i], buffers[i]); });
  } catch (e) {
    if (token === loadToken) toast(e.message, true);
    return;
  }
  $("#tracks-loading").classList.add("hidden");
  loadTrims();
  bindTrackControls();
  refreshTrackStates();
  tick();
}

function bindTrackControls() {
  for (const row of current.rows) {
    const t = row.track;
    row.el.querySelector(".mute").onclick = () => { t.muted = !t.muted; refreshTrackStates(); };
    row.el.querySelector(".solo").onclick = (e) => {
      // Shift+click adds to the solo set; a plain click soloes just this track.
      if (!e.shiftKey && !t.solo) mixer.tracks.forEach((x) => (x.solo = false));
      t.solo = !t.solo;
      refreshTrackStates();
    };
    row.el.querySelector(".vol").oninput = (e) => { t.volume = e.target.value / 100; refreshTrackStates(); };
    row.el.querySelector(".vol").ondblclick = () => { t.volume = 1; refreshTrackStates(); };
    row.el.querySelector(".key-down").onclick = () => shiftTracks([t], -1);
    row.el.querySelector(".key-up").onclick = () => shiftTracks([t], 1);

    const wave = row.el.querySelector(".wave");
    let dragging = false, resume = false;
    const timeAt = (e) => {
      const r = wave.getBoundingClientRect();
      return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * mixer.duration;
    };
    wave.onpointerdown = (e) => {
      dragging = true;
      resume = mixer.playing;
      mixer.pause();
      mixer.offset = timeAt(e);
      wave.setPointerCapture(e.pointerId);
    };
    wave.onpointermove = (e) => { if (dragging) mixer.offset = timeAt(e); };
    wave.onpointerup = () => {
      if (!dragging) return;
      dragging = false;
      if (resume) mixer.play();
    };
    bindTrim(row);
  }
}

function closePlayer() {
  loadToken++;
  transposeRun++;
  clearTimeout(transposeTimer);
  setTransposing(false);
  $("#song-key-val").textContent = "0";
  cancelAnimationFrame(rafId);
  if (mixer) mixer.destroy();
  mixer = null;
  current = null;
  $("#play").classList.remove("playing");
}

// Transport
const togglePlay = () => { if (!mixer?.tracks.length) return; mixer.playing ? mixer.pause() : mixer.play(); updateTransport(); };
$("#play").onclick = togglePlay;
$("#key-down").onclick = () => { if (mixer?.tracks.length) shiftTracks(mixer.tracks, -1); };
$("#key-up").onclick = () => { if (mixer?.tracks.length) shiftTracks(mixer.tracks, 1); };
$("#back5").onclick = () => mixer && mixer.seek(mixer.time - 5);
$("#fwd5").onclick = () => mixer && mixer.seek(mixer.time + 5);
$("#to-start").onclick = () => mixer && mixer.seek(0);
$("#loop").onclick = () => {
  if (!mixer) return;
  mixer.setLoop(!mixer.loop);
  $("#loop").classList.toggle("on", mixer.loop);
};

let seekDragging = false;
const seek = $("#seek");
seek.addEventListener("input", () => {
  seekDragging = true;
  setFill(seek);
  if (mixer) $("#time-cur").textContent = fmtTime((seek.value / 1000) * mixer.duration);
});
seek.addEventListener("change", () => {
  seekDragging = false;
  if (mixer) mixer.seek((seek.value / 1000) * mixer.duration);
});

const master = $("#master");
master.addEventListener("input", () => {
  setFill(master);
  if (mixer) mixer.master.gain.setTargetAtTime(master.value / 100, mixer.ctx.currentTime, 0.015);
});

$("#reset-mix").onclick = () => {
  if (!mixer) return;
  mixer.tracks.forEach((t) => {
    Object.assign(t, { volume: 1, muted: false, solo: false, semitones: 0 });
    mixer.setTrim(t, 0, mixer.duration);
  });
  current.rows.forEach((row) => placeTrim(row, 0, mixer.duration));
  saveTrims();
  refreshTrackStates();
  scheduleTranspose();
};

$("#export-mix").onclick = async () => {
  if (!mixer?.tracks.length) return;
  const btn = $("#export-mix");
  btn.disabled = true;
  toast("Rendering your mix…");
  try {
    const blob = await mixer.renderMix();
    const active = mixer.tracks.filter((t) => mixer.audible(t) && t.volume > 0).map((t) => t.name);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${current.song.title} - ${active.length === mixer.tracks.length ? "mix" : active.join("+")}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) {
    toast(`Export failed: ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
};

document.addEventListener("keydown", (e) => {
  if (!mixer || e.target.matches("input[type=search], input[type=text]") || !$("#modal").classList.contains("hidden")) return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.code === "ArrowLeft") mixer.seek(mixer.time - 5);
  else if (e.code === "ArrowRight") mixer.seek(mixer.time + 5);
  else if (e.code === "Home") mixer.seek(0);
  else if (e.code === "KeyL") $("#loop").click();
});

/* =========================== YouTube =========================== */

const ICONS = {
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  split: '<path d="M6 15V9M10 18V6M14 16V8M18 13v-2"/>',
};

let downloads = [];
let selectedQuality = null;
let separatingDownload = null;
const isActive = (d) => d.status === "queued" || d.status === "downloading";

const qualityLabel = (q) => (q === "wav" ? "WAV" : `${q} kbps`);

function renderQuality() {
  $("#yt-quality").innerHTML = info.qualities
    .map((q, i) => `<button type="button" role="radio" aria-checked="${q === selectedQuality}" data-index="${i}">${qualityLabel(q)}</button>`)
    .join("");
}

function downloadStatus(d) {
  if (d.status === "queued") return `<div class="status queued">In queue…</div>`;
  if (d.status === "error") return `<div class="status error">${esc(d.error || "Download failed")}</div>`;
  const pct = Math.round(d.progress * 100);
  return `<div class="status"><span>${pct < 90 ? `Downloading… ${pct}%` : "Converting…"}</span><div class="bar"><div style="width:${pct}%"></div></div></div>`;
}

function renderDownloads() {
  $("#yt-empty").classList.toggle("hidden", downloads.length > 0);
  $("#yt-list").innerHTML = downloads
    .map((d) => {
      const meta = [qualityLabel(d.quality), d.artist, d.duration ? fmtTime(d.duration) : ""].filter(Boolean).join(" · ");
      const ready = d.status === "ready";
      return `<div class="yt-row" data-id="${d.id}">
        <div class="yt-text">
          <div class="song-title" title="${esc(d.title)}">${esc(d.title)}</div>
          ${ready ? `<div class="muted">${esc(meta)}</div>` : downloadStatus(d)}
        </div>
        ${ready ? `<a class="btn ghost" href="/api/downloads/${d.id}/file" download>${icon(ICONS.download)} ${d.quality === "wav" ? "WAV" : "MP3"}</a>
          <button class="btn ghost" data-separate="${d.id}">${icon(ICONS.split)} Separate</button>` : ""}
        ${d.status === "downloading" ? "" : `<button class="icon-btn" data-remove="${d.id}" title="Delete">${icon(ICONS.trash)}</button>`}
      </div>`;
    })
    .join("");
}

async function refreshDownloads() {
  try {
    downloads = await api("/api/downloads");
    renderDownloads();
  } catch (e) {
    console.error(e);
  }
}

$("#yt-quality").addEventListener("click", (e) => {
  const index = e.target.closest("[data-index]")?.dataset.index;
  if (index === undefined) return;
  selectedQuality = info.qualities[index];
  renderQuality();
});

$("#yt-url").addEventListener("input", (e) => { $("#yt-submit").disabled = !e.target.value.trim(); });

$("#yt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#yt-url");
  try {
    await api("/api/downloads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: input.value, quality: selectedQuality }),
    });
    input.value = "";
    $("#yt-submit").disabled = true;
    refreshDownloads();
  } catch (err) {
    toast(err.message, true);
  }
});

$("#yt-list").addEventListener("click", async (e) => {
  const remove = e.target.closest("[data-remove]");
  const sep = e.target.closest("[data-separate]");
  if (remove) {
    const d = downloads.find((x) => x.id === remove.dataset.remove);
    if (!confirm(`Delete "${d.title}"?`)) return;
    try {
      await api(`/api/downloads/${d.id}`, { method: "DELETE" });
      refreshDownloads();
    } catch (err) {
      toast(err.message, true);
    }
  } else if (sep) {
    separatingDownload = downloads.find((x) => x.id === sep.dataset.separate);
    $("#separate-title").textContent = separatingDownload.title;
    $("#separate-modal").classList.remove("hidden");
  }
});

$("#submit-separate").addEventListener("click", async () => {
  try {
    await api(`/api/downloads/${separatingDownload.id}/separate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel }),
    });
    $("#separate-modal").classList.add("hidden");
    toast("Added to the queue");
    location.hash = "#/";
  } catch (err) {
    toast(err.message, true);
  }
});

/* =========================== Settings =========================== */

const THEMES = [
  { id: "abraham", label: "Abraham", desc: "The original dark teal" },
  { id: "pipboy", label: "Pip-Boy", desc: "Green phosphor CRT" },
  { id: "sakura", label: "Sakura", desc: "Pip-Boy in pink" },
  { id: "sky", label: "Sky", desc: "Light terminal in sky blue" },
  { id: "neon", label: "Neon", desc: "Synthwave grid" },
  { id: "paper", label: "Paper", desc: "Warm ruled notebook" },
  { id: "terminal", label: "Terminal", desc: "Black and orange monitor" },
  { id: "bright", label: "Bright", desc: "Light background for daytime" },
  { id: "pipboy-bw", label: "Pip-Boy B&W", desc: "Monochrome CRT" },
  { id: "palace", label: "Golden Palace", desc: "Gilded halls and drifting sparks" },
  { id: "goldleaf", label: "Gold Leaf", desc: "Ivory marble and brushed gold" },
  { id: "arcade", label: "Arcade", desc: "Pixel neon, straight from the 80s" },
];
const DEFAULT_THEME = "abraham";

let theme = document.documentElement.dataset.theme;
if (!THEMES.some((t) => t.id === theme)) theme = DEFAULT_THEME;

function applyTheme(id) {
  theme = id;
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem("abraham.theme", id); } catch {}
  const css = getComputedStyle(document.documentElement);
  waveOff = css.getPropertyValue("--wave-off").trim();
  waveDim = css.getPropertyValue("--wave-dim").trim();
  current?.rows.forEach(drawWave);
  renderThemes();
  tintFavicon(css.getPropertyValue("--accent").trim());
}

const faviconImage = new Image();
faviconImage.src = "/static/logo.svg";

function tintFavicon(color) {
  if (!faviconImage.complete) { faviconImage.onload = () => tintFavicon(color); return; }
  const canvas = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const ctx = canvas.getContext("2d");
  ctx.drawImage(faviconImage, 0, 0, 64, 64);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 64);
  $("link[rel=icon]").href = canvas.toDataURL();
}

function renderThemes() {
  $("#theme-grid").innerHTML = THEMES
    .map((t) => `<button class="theme-card" data-theme="${t.id}" role="radio" aria-checked="${t.id === theme}">
      <span class="theme-preview"><i></i><i></i><i></i></span>
      <b>${esc(t.label)}</b><span class="theme-desc">${esc(t.desc)}</span>
    </button>`)
    .join("");
}

$("#theme-grid").addEventListener("click", (e) => {
  const id = e.target.closest(".theme-card")?.dataset.theme;
  if (id) applyTheme(id);
});

window.addEventListener("resize", () => current?.rows.forEach((r) => { r.bars = null; if (mixer) drawWave(r); }));

/* =========================== Routing =========================== */

/* ---------- Study ---------- */

const SHEET_MODES = [
  { id: "notes", label: "Notation" },
  { id: "tab", label: "Tablature" },
  { id: "gp", label: "Guitar Pro" },
];
let studyMode = "gp";
let studyTuning = null;
let studySheet = null;
const studyUploads = new Set();  // uploaded from Study, and still to be announced there

function renderStudyChoices() {
  const buttons = (items, selected) => items
    .map((m) => `<button type="button" role="radio" aria-checked="${m.id === selected}" data-id="${m.id}">${esc(m.label)}</button>`)
    .join("");
  $("#study-mode").innerHTML = buttons(SHEET_MODES, studyMode);
  $("#study-tuning").innerHTML = buttons(info.tunings, studyTuning);
  $("#study-tuning-field").classList.toggle("hidden", studyMode === "notes");
}

function renderStudyStems() {
  const song = songs.find((s) => s.id === $("#study-song").value);
  const previous = $("#study-stem").value;
  const stems = sortStems(song?.stems || []).filter((s) => s !== "drums");
  $("#study-stem").innerHTML = stems.map((s) => `<option value="${esc(s)}">${esc(stemMeta(s).label)}</option>`).join("");
  $("#study-stem").value = stems.includes(previous) ? previous : stems.find((s) => s.startsWith("guitar")) || stems[0] || "";
}

function renderStudySongs() {
  const ready = songs.filter((s) => s.status === "ready");
  const separating = songs.filter((s) => s.status === "queued" || s.status === "processing");
  const select = $("#study-song");
  const previous = select.value;
  // This runs during every poll while a song separates; rebuilding would close an open list.
  if ([...select.options].map((o) => o.value).join() !== ready.map((s) => s.id).join()) {
    select.innerHTML = ready.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join("");
    if (ready.some((s) => s.id === previous)) select.value = previous;
  }
  for (const song of songs.filter((s) => studyUploads.has(s.id))) {
    if (song.status === "ready") {
      select.value = song.id;
      toast(`${song.title} is ready to study`);
    } else if (song.status === "error") {
      toast(`Separation failed: ${song.error}`, true);
    } else {
      continue;
    }
    studyUploads.delete(song.id);
  }
  $("#study-pending").innerHTML = separating
    .map((s) => `<div class="yt-row"><div class="yt-text">
        <div class="song-title" title="${esc(s.title)}">${esc(s.title)}</div>
        ${statusCell(s)}
      </div></div>`)
    .join("");
  $("#study-empty").classList.toggle("hidden", ready.length > 0 || separating.length > 0);
  $("#study-form").classList.toggle("hidden", !ready.length);
  if (!ready.length) $("#study-result").classList.add("hidden");
  renderStudyStems();
}

$("#study-song").addEventListener("change", renderStudyStems);

$("#study-mode").addEventListener("click", (e) => {
  const id = e.target.closest("[data-id]")?.dataset.id;
  if (!id) return;
  studyMode = id;
  renderStudyChoices();
});

$("#study-tuning").addEventListener("click", (e) => {
  const id = e.target.closest("[data-id]")?.dataset.id;
  if (!id) return;
  studyTuning = id;
  renderStudyChoices();
});

$("#study-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const song = songs.find((s) => s.id === $("#study-song").value);
  const stem = $("#study-stem").value;
  if (!song || !stem) return;
  const submit = $("#study-submit");
  submit.disabled = true;
  submit.textContent = "Listening…";
  try {
    const sheet = await api(`/api/songs/${song.id}/sheet/${encodeURIComponent(stem)}?tuning=${encodeURIComponent(studyTuning)}`);
    if (!sheet.bars.length) {
      $("#study-result").classList.add("hidden");
      closeGuitarPro();
      toast(`No clear notes found in ${stemMeta(stem).label}`, true);
      return;
    }
    const facts = [stemMeta(stem).label, `${sheet.tempo} BPM`, "4/4"];
    if (sheet.key) facts.push(keyName(sheet.key));
    if (studyMode !== "notes") facts.push(`Tuning: ${sheet.tuning.label} (${sheet.tuning.strings.slice().reverse().join(" ")})`);
    studySheet = { title: song.title, details: facts.join(" · "), file: `${song.title} - ${stemMeta(stem).label}.pdf` };
    $("#sheet-title").textContent = studySheet.title;
    $("#sheet-details").textContent = studySheet.details;
    $("#study-result").classList.remove("hidden");
    openGuitarPro(sheet, song.title, stemMeta(stem).label, stem, studyMode);
    renderSheet($("#sheet-music"), sheet, studyMode);
  } catch (err) {
    toast(err.message, true);
  } finally {
    submit.disabled = false;
    submit.textContent = "Generate";
  }
});

$("#study-print").addEventListener("click", () => window.print());

$("#study-pdf").addEventListener("click", async (e) => {
  e.currentTarget.disabled = true;
  try {
    await saveSheetPdf($("#sheet-music"), studySheet.title, studySheet.details, studySheet.file);
  } catch (err) {
    toast(`Couldn't make the PDF: ${err.message}`, true);
  } finally {
    $("#study-pdf").disabled = false;
  }
});

const PAGES = { "#/youtube": "#youtube-view", "#/study": "#study-view", "#/settings": "#settings-view" };

function showView(sel, navHash) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", `#${v.id}` !== sel));
  document.querySelectorAll(".nav-item").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === navHash));
}

function route() {
  const m = location.hash.match(/^#\/song\/(\w+)/);
  if (m) {
    showView("#player-view", "#/");
    pauseGuitarPro();
    openPlayer(m[1]);
    return;
  }
  closePlayer();
  pauseGuitarPro();
  const page = PAGES[location.hash];
  showView(page || "#library-view", page ? location.hash : "#/");
  if (page === "#youtube-view") refreshDownloads();
  if (!page || page === "#study-view") refreshSongs();
}

async function init() {
  info = await api("/api/info");
  selectedModel = info.default_model;
  selectedQuality = info.default_quality;
  renderModelOptions();
  renderQuality();
  studyTuning = info.default_tuning;
  renderStudyChoices();
  initGuitarPro();
  applyTheme(theme);
  $("#device").innerHTML = `Separating on<br><b>${esc(info.device)}</b>`;
  document.querySelectorAll(".range").forEach(setFill);
  window.addEventListener("hashchange", route);
  route();
  // Keep the library's progress bars live.
  setInterval(() => {
    if (!$("#library-view").classList.contains("hidden") || songs.some((s) => s.status === "queued" || s.status === "processing")) {
      refreshSongs();
    }
    if (!$("#youtube-view").classList.contains("hidden") && downloads.some(isActive)) refreshDownloads();
  }, 1500);
}

init();
