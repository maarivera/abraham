"use strict";

/* The live score behind every Study view: writes a sheet as alphaTex for alphaTab, which draws the score, plays it
   and exports it as a .gp file. */

const ALPHATAB = new URL("/static/vendor/alphatab/", location.href).href; // its worker can't use relative paths
const GP_PROGRAMS = { bass: 33, piano: 0, vocals: 54, vocal_1: 54, vocal_2: 54 }; // General MIDI; anything else is a steel guitar
const GP_GUITAR = 25;
const GP_STAVES = { notes: "Score", tab: "Tab", gp: "ScoreTab" };
const GP_MIN_ZOOM = 0.6;
const GP_MAX_ZOOM = 2;
const GP_SCROLL_MARGIN = -140; // keeps the line above the cursor in view

let gpApi = null;
let gpFile = "";
let gpZoom = 1;

const texString = (text) => `"${text.replace(/["\\]/g, "")}"`;

function texPitch(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function texBeat(event) {
  const duration = { w: 1, h: 2, q: 4, 8: 8, 16: 16 }[event.duration];
  const dots = event.dots ? "{d}" : "";
  if (event.rest) return `r.${duration}${dots}`;
  const notes = event.notes.map((n) => `${event.held ? "-" : n.fret}.${n.string}`);
  return `${notes.length > 1 ? `(${notes.join(" ")})` : notes[0]}.${duration}${dots}`;
}

function sheetToTex(sheet, title, trackName, stem) {
  const program = GP_PROGRAMS[stem] ?? GP_GUITAR;
  return [
    `\\title ${texString(title)}`,
    `\\subtitle ${texString(trackName)}`,
    `\\tempo ${sheet.tempo}`,
    ".",
    `\\track ${texString(trackName)}`,
    `\\instrument ${program}`,
    "\\staff {score tabs}",
    `\\tuning (${sheet.tuning.midi.map(texPitch).join(" ")})`,
    `\\ts 4 4 \\ks ${sheet.signature}`,
    sheet.bars.map((bar) => bar.map(texBeat).join(" ")).join(" | "),
  ].join("\n");
}

function closeGuitarPro() {
  gpApi?.destroy();
  gpApi = null;
  $("#gp-render").replaceChildren();
}

const pauseGuitarPro = () => gpApi?.pause();

function openGuitarPro(sheet, title, trackName, stem, mode) {
  closeGuitarPro();
  const status = (text) => { $("#gp-status").textContent = text; };
  gpFile = `${title} - ${trackName}.gp`;
  status("Loading…");
  $("#gp-time").textContent = "0:00 / 0:00";
  $("#gp-play").textContent = "Play";

  const api = new alphaTab.AlphaTabApi($("#gp-render"), {
    core: { fontDirectory: `${ALPHATAB}font/`, scriptFile: `${ALPHATAB}alphaTab.min.js` },
    display: { scale: gpZoom, layoutMode: "page", staveProfile: alphaTab.StaveProfile[GP_STAVES[mode]] },
    notation: { rhythmMode: alphaTab.TabRhythmMode[mode === "tab" ? "ShowWithBars" : "Hidden"] },
    player: {
      playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
      soundFont: `${ALPHATAB}soundfont/sonivox.sf3`,
      scrollElement: $("#gp-score"),
      scrollOffsetY: GP_SCROLL_MARGIN,
      enableCursor: true,
      enableUserInteraction: true,
    },
  });
  gpApi = api;
  api.playbackSpeed = Number($("#gp-speed").value);
  api.metronomeVolume = $("#gp-metronome").getAttribute("aria-pressed") === "true" ? 1 : 0;
  api.countInVolume = $("#gp-count-in").getAttribute("aria-pressed") === "true" ? 1 : 0;
  api.isLooping = $("#gp-loop").getAttribute("aria-pressed") === "true";
  api.soundFontLoad.on((e) => status(`Loading sounds… ${Math.round((e.loaded / e.total) * 100) || 0}%`));
  api.playerReady.on(() => status(""));
  api.renderFinished.on(() => { if (api.isReadyForPlayback) status(""); });
  api.playerStateChanged.on((e) => { $("#gp-play").textContent = e.state === 1 ? "Pause" : "Play"; });
  api.playerPositionChanged.on((e) => {
    $("#gp-time").textContent = `${fmtTime(e.currentTime / 1000)} / ${fmtTime(e.endTime / 1000)}`;
  });
  api.error.on((e) => status(`Error: ${e?.message || e}`));
  api.tex(sheetToTex(sheet, title, trackName, stem));
}

function toggleGpOption(button, apply) {
  const on = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(on));
  if (gpApi) apply(on);
}

function zoomGuitarPro(step) {
  gpZoom = Math.min(GP_MAX_ZOOM, Math.max(GP_MIN_ZOOM, Math.round((gpZoom + step) * 10) / 10));
  if (!gpApi) return;
  gpApi.settings.display.scale = gpZoom;
  gpApi.updateSettings();
  gpApi.render();
}

function saveGuitarPro() {
  const bytes = new alphaTab.exporter.Gp7Exporter().export(gpApi.score, gpApi.settings);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  link.download = gpFile;
  link.click();
  URL.revokeObjectURL(link.href);
}

function initGuitarPro() {
  $("#gp-play").addEventListener("click", () => gpApi?.playPause());
  $("#gp-stop").addEventListener("click", () => gpApi?.stop());
  $("#gp-speed").addEventListener("change", (e) => { if (gpApi) gpApi.playbackSpeed = Number(e.target.value); });
  $("#gp-metronome").addEventListener("click", (e) => toggleGpOption(e.currentTarget, (on) => { gpApi.metronomeVolume = on ? 1 : 0; }));
  $("#gp-count-in").addEventListener("click", (e) => toggleGpOption(e.currentTarget, (on) => { gpApi.countInVolume = on ? 1 : 0; }));
  $("#gp-loop").addEventListener("click", (e) => toggleGpOption(e.currentTarget, (on) => { gpApi.isLooping = on; }));
  $("#gp-zoom-out").addEventListener("click", () => zoomGuitarPro(-0.1));
  $("#gp-zoom-in").addEventListener("click", () => zoomGuitarPro(0.1));
  $("#gp-save").addEventListener("click", saveGuitarPro);
}
