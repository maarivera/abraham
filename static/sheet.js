"use strict";

/* Draws a sheet from /api/songs/{id}/sheet/{stem} with VexFlow, one SVG per line of music,
   and exports those SVGs to PDF. The page stays black on white in every theme: it's paper. */

const BARS_PER_LINE = 4;
const LINE_WIDTH = 1000;
const LINE_INDENT = 70; // room for the clef, key and time signature
const LINE_MARGIN = 16; // room for the bracket
const TAB_GAP = 120; // from the top of the staff to the top of the tab
const PDF_MARGIN = 40;

function drawLine(host, sheet, bars, showNotes, showTab, isFirst, tie) {
  const VF = Vex.Flow;
  const box = document.createElement("div");
  box.className = "sheet-line";
  host.append(box);
  const renderer = new VF.Renderer(box, VF.Renderer.Backends.SVG);
  renderer.resize(LINE_WIDTH + LINE_MARGIN * 2, 420);
  const ctx = renderer.getContext();
  const barWidth = (LINE_WIDTH - LINE_INDENT) / bars.length;
  const restKey = sheet.clef === "bass" ? "d/3" : "b/4";
  const drawn = [];
  const pending = [];

  bars.forEach((bar, n) => {
    const x = LINE_MARGIN + (n ? LINE_INDENT + n * barWidth : 0);
    const width = n ? barWidth : LINE_INDENT + barWidth;
    let staff = null;
    let tab = null;
    if (showNotes) {
      staff = new VF.Stave(x, 40, width);
      if (!n) {
        staff.addClef(sheet.clef, "default", sheet.octave ? "8vb" : undefined).addKeySignature(sheet.signature);
        if (isFirst) staff.addTimeSignature("4/4");
      }
      staff.setContext(ctx);
    }
    if (showTab) {
      tab = new VF.TabStave(x, showNotes ? 40 + TAB_GAP : 40, width);
      if (!n) tab.addClef("tab");
      tab.setContext(ctx);
    }
    if (staff && tab) tab.setNoteStartX(staff.getNoteStartX());
    staff?.draw();
    tab?.draw();
    if (!n && staff && tab) {
      new VF.StaveConnector(staff, tab).setType("singleLeft").setContext(ctx).draw();
      new VF.StaveConnector(staff, tab).setType("bracket").setContext(ctx).draw();
    }

    const notes = [];
    const frets = [];
    for (const e of bar) {
      const duration = e.duration + "d".repeat(e.dots);
      if (showNotes) {
        const note = e.rest
          ? new VF.StaveNote({ keys: [restKey], duration: `${e.duration === "w" ? "w" : duration}r`, clef: sheet.clef, align_center: e.duration === "w" })
          : new VF.StaveNote({ keys: e.notes.map((p) => p.key), duration, clef: sheet.clef, auto_stem: true });
        if (e.dots) VF.Dot.buildAndAttach([note], { all: true });
        notes.push(note);
        if (!e.rest) {
          if (e.held && tie.note) pending.push([tie.note, note, tie.line]);
          tie.note = e.ties ? note : null;
          tie.line = drawn;
        }
      }
      if (showTab) {
        if (e.rest || e.held) {
          frets.push(new VF.GhostNote({ duration }));
        } else {
          const fret = new VF.TabNote(
            { positions: e.notes.map((p) => ({ str: p.string, fret: p.fret })), duration, stem_direction: -1 },
            !showNotes,
          );
          if (e.dots && !showNotes) VF.Dot.buildAndAttach([fret], { all: true });
          frets.push(fret);
        }
      }
    }
    const voices = [];
    const beams = [];
    const voice = (tickables) => new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT).addTickables(tickables);
    if (showNotes) {
      VF.Accidental.applyAccidentals([voice(notes)], sheet.signature);
      voices.push(voice(notes));
      beams.push(...VF.Beam.generateBeams(notes));
    }
    if (showTab) {
      voices.push(voice(frets));
      if (!showNotes) beams.push(...VF.Beam.generateBeams(frets.filter((f) => f instanceof VF.TabNote), { stem_direction: -1 }));
    }
    const formatter = new VF.Formatter();
    voices.forEach((v) => formatter.joinVoices([v]));
    formatter.format(voices, width - ((staff || tab).getNoteStartX() - x) - 14);
    if (staff) voices[0].draw(ctx, staff);
    if (tab) voices[voices.length - 1].draw(ctx, tab);
    beams.forEach((b) => b.setContext(ctx).draw());
  });

  for (const [first, last, line] of pending) {
    const indices = first.getKeys().map((_, i) => i);
    const same = line === drawn;
    if (same) {
      new VF.StaveTie({ first_note: first, last_note: last, first_indices: indices, last_indices: indices }).setContext(ctx).draw();
    } else {
      new VF.StaveTie({ last_note: last, last_indices: indices, first_indices: indices }).setContext(ctx).draw();
    }
  }

  const svg = box.querySelector("svg");
  const area = svg.getBBox();
  const pad = 6;
  svg.setAttribute("viewBox", `0 ${area.y - pad} ${LINE_WIDTH + LINE_MARGIN * 2} ${area.height + pad * 2}`);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.removeAttribute("style");
  // VexFlow leaves these to inherit, which neither the app's icon styles nor the PDF export respect.
  svg.setAttribute("font-size", "13"); // the PDF export can't read VexFlow's "10pt"
  svg.querySelectorAll("text").forEach((t) => t.setAttribute("fill", "#000"));
  svg.querySelectorAll('path[fill="none"]:not([stroke])').forEach((p) => p.setAttribute("stroke", "#000"));
}

function renderSheet(host, sheet, mode) {
  host.replaceChildren();
  const tie = { note: null, line: null };
  for (let i = 0; i < sheet.bars.length; i += BARS_PER_LINE) {
    drawLine(host, sheet, sheet.bars.slice(i, i + BARS_PER_LINE), mode !== "tab", mode !== "notes", i === 0, tie);
  }
}

async function saveSheetPdf(host, title, details, fileName) {
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - PDF_MARGIN * 2;
  doc.setFont("helvetica", "bold").setFontSize(18);
  const heading = doc.splitTextToSize(title, width);
  doc.text(heading, pageWidth / 2, PDF_MARGIN + 10, { align: "center" });
  let y = PDF_MARGIN + 10 + heading.length * 22;
  doc.setFont("helvetica", "normal").setFontSize(10);
  const lines = doc.splitTextToSize(details, width);
  doc.text(lines, pageWidth / 2, y, { align: "center" });
  y += lines.length * 13 + 14;
  for (const svg of host.querySelectorAll("svg")) {
    const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
    const height = (width * h) / w;
    if (y + height > pageHeight - PDF_MARGIN) {
      doc.addPage();
      y = PDF_MARGIN;
    }
    await doc.svg(svg, { x: PDF_MARGIN, y, width, height });
    y += height + 12;
  }
  doc.save(fileName);
}
