import {
  Annotation,
  Beam,
  Bend,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  TabNote,
  TabSlide,
  TabStave,
  TabTie,
  Tuning,
  Vibrato,
  Voice,
} from "vexflow";

const SVG_NS = "http://www.w3.org/2000/svg";
const STANDARD_TUNING = new Tuning("standard");

// The row's canvas height is sized generously upfront to leave room for the
// tallest possible content (e.g. hammer-on/pull-off connector curves arcing
// above the stave) — for a plain row with none of that, most of that height
// goes unused, showing up as an oversized gap before the next row. Shrink
// the canvas down to what was actually drawn (never grow it, and only ever
// shrink — a missed edge case here should waste space, not clip content).
function shrinkSvgToContent(container, verticalPadding = 6) {
  const svg = container.querySelector("svg");
  if (!svg) return;
  let maxBottom = 0;
  for (const el of svg.querySelectorAll("*")) {
    if (typeof el.getBBox !== "function") continue;
    // The clef glyph (e.g. "TAB") is drawn from a music font whose declared
    // em-box is much taller than the glyph actually looks — getBBox reports
    // that full font metric, not the visible shape, which would otherwise
    // make every row look like it needs far more height than it really does.
    if (el.closest(".vf-clef")) continue;
    let bbox;
    try {
      bbox = el.getBBox();
    } catch {
      continue;
    }
    if (bbox.width === 0 && bbox.height === 0) continue;
    maxBottom = Math.max(maxBottom, bbox.y + bbox.height);
  }
  if (maxBottom <= 0) return;
  const currentHeight = Number(svg.getAttribute("height"));
  const tightHeight = Math.min(currentHeight, Math.ceil(maxBottom + verticalPadding));
  if (tightHeight >= currentHeight) return;
  svg.setAttribute("height", String(tightHeight));
  const viewBox = svg.getAttribute("viewBox");
  if (!viewBox) return;
  const [x, y, width] = viewBox.split(/\s+/).map(Number);
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${tightHeight}`);
}

function parseTimeSignature(timeSignature) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(timeSignature ?? "4/4");
  if (!match) return { numBeats: 4, beatValue: 4 };
  return { numBeats: Number(match[1]), beatValue: Number(match[2]) };
}

function addChordAnnotation(note, chord) {
  if (!chord) return;
  note.addModifier(
    new Annotation(chord)
      .setVerticalJustification(Annotation.VerticalJustify.TOP)
      .setFont("Arial", 13, "bold"),
    0,
  );
}

function addSingleNoteModifiers(note, event, measure, eventIndex) {
  const outgoing = measure.techniques.filter(technique => technique.fromEvent === eventIndex);
  if (outgoing.some(technique => technique.type === "bend")) {
    note.addModifier(new Bend([{ type: Bend.UP, text: "Full" }]), 0);
  }
  if (outgoing.some(technique => technique.type === "vibrato")) {
    note.addModifier(new Vibrato(), 0);
  }
}

function connectorForTechnique(technique, notes) {
  const firstNote = notes[technique.fromEvent];
  const lastNote = notes[technique.toEvent];
  if (!firstNote || !lastNote) return null;
  const firstIndex = firstNote.getPositions().findIndex(position => position.str === technique.string);
  const lastIndex = lastNote.getPositions().findIndex(position => position.str === technique.string);
  if (firstIndex < 0 || lastIndex < 0) return null;

  const tieOptions = {
    firstNote,
    lastNote,
    firstIndexes: [firstIndex],
    lastIndexes: [lastIndex],
  };

  if (technique.type === "hammer") return new TabTie(tieOptions, "H");
  if (technique.type === "pull") return new TabTie(tieOptions, "P");
  if (technique.type === "slide-up") return TabSlide.createSlideUp(tieOptions);
  if (technique.type === "slide-down") return TabSlide.createSlideDown(tieOptions);
  return null;
}

function createMeasureNotes(measure, { annotateChord = true } = {}) {
  return measure.events.map((event, eventIndex) => {
    const note = new TabNote({
      positions: event.positions.map(position => ({
        str: position.string,
        fret: position.fret,
      })),
      duration: event.duration,
    });
    if (eventIndex === 0 && annotateChord) addChordAnnotation(note, measure.chord);
    addSingleNoteModifiers(note, event, measure, eventIndex);
    return note;
  });
}

function pitchForPosition(position) {
  return STANDARD_TUNING.getNoteForFret(position.fret, position.string);
}

function createStandardNotes(measure) {
  return measure.events.map((event, eventIndex) => {
    const pitches = event.positions.filter(position => position.fret !== "x").map(pitchForPosition);
    const note = pitches.length
      ? new StaveNote({ keys: pitches, duration: event.duration, clef: "treble", auto_stem: true })
      : new StaveNote({ keys: ["b/4"], duration: `${event.duration}r`, clef: "treble" });
    if (eventIndex === 0) addChordAnnotation(note, measure.chord);
    return note;
  });
}

function measureClefOverhead(makeStave) {
  const bare = makeStave();
  bare.format();
  const bareNoteStartX = bare.getNoteStartX();
  const withClef = makeStave();
  withClef.addClef("tab");
  withClef.format();
  return withClef.getNoteStartX() - bareNoteStartX;
}

// Horizontal room a single note event needs so that dense measures (runs of
// sixteenth notes, long licks written as one bar…) are not squeezed until the
// notes spill past the end of the stave. Tuned so an ordinary bar of eight
// events still fits the base measure width exactly and keeps the usual
// measures-per-row layout; only busier bars grow.
const MIN_EVENT_WIDTH = 24;
const MEASURE_PADDING = 24;

export function measureNaturalWidth(measure, measureWidth) {
  return Math.max(measureWidth, MEASURE_PADDING + measure.events.length * MIN_EVENT_WIDTH);
}

function computeMeasureWidths(measures, measureWidth, firstMeasureOverhead) {
  return measures.map((measure, index) => measureNaturalWidth(measure, measureWidth) + (index === 0 ? firstMeasureOverhead : 0));
}

// Every row's canvas is at least as wide as a full row of base-width measures
// (options.measuresPerRow of them), so a shorter last row is not scaled up by
// the CSS max-width fit and its notation stays the same size as fuller rows.
// A row holding wider-than-base measures simply extends beyond that and is
// scaled down to fit, like any other overflowing row.
function rowCanvasWidth(widths, options, measureWidth, clefOverhead) {
  const contentWidth = widths.reduce((sum, width) => sum + width, 0);
  const fullRowWidth = (options.measuresPerRow ?? widths.length) * measureWidth + clefOverhead;
  return Math.max(contentWidth, fullRowWidth);
}

// Wraps each measure's drawing in a <g data-measure="…"> with a transparent
// background rect spanning the stave(s), so playback can tint the measure
// being played (CSS: [data-measure].playing .measure-bg).
function addMeasureBackground(group, topStave, bottomStave) {
  const top = topStave.getBoundingBox();
  const bottom = bottomStave.getBoundingBox();
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("class", "measure-bg");
  rect.setAttribute("x", String(top.getX()));
  rect.setAttribute("y", String(top.getY()));
  rect.setAttribute("width", String(top.getW()));
  rect.setAttribute("height", String(bottom.getY() + bottom.getH() - top.getY()));
  rect.setAttribute("fill", "transparent");
  // VexFlow copies its drawing attributes (stroke="black", …) onto every group
  // it opens, and the rect would inherit them and draw a frame around the
  // measure — so opt out of the stroke explicitly.
  rect.setAttribute("stroke", "none");
  group.prepend(rect);
}

function renderRow(container, measures, options) {
  const measureWidth = options.measureWidth;
  const height = options.height;
  const { numBeats, beatValue } = parseTimeSignature(options.timeSignature);
  const clefOverhead = measureClefOverhead(() => new TabStave(0, 0, measureWidth, { spaceAboveStaffLn: 2 }));
  const widths = computeMeasureWidths(measures, measureWidth, clefOverhead);
  const totalWidth = rowCanvasWidth(widths, options, measureWidth, clefOverhead);

  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(totalWidth, height);
  const context = renderer.getContext();

  let cursorX = 0;
  measures.forEach((measure, index) => {
    const width = widths[index];
    const group = context.openGroup("measure");
    group.setAttribute("data-measure", String(measure.index));
    const stave = new TabStave(cursorX, 8, width, {
      spaceAboveStaffLn: 2,
      leftBar: index === 0,
    });
    cursorX += width;
    if (index === 0) stave.addClef("tab");
    stave.setContext(context).draw();
    addMeasureBackground(group, stave, stave);

    const notes = createMeasureNotes(measure);
    if (!notes.length) {
      context.closeGroup();
      return;
    }

    const voice = new Voice({ numBeats, beatValue }).setMode(Voice.Mode.SOFT);
    voice.addTickables(notes);
    new Formatter().joinVoices([voice]).formatToStave([voice], stave);
    voice.draw(context, stave);

    for (const technique of measure.techniques) {
      const connector = connectorForTechnique(technique, notes);
      connector?.setContext(context).draw();
    }
    context.closeGroup();
  });
  shrinkSvgToContent(container);
}

function measureScoreClefOverhead(measureWidth, numBeats, beatValue) {
  const bareNotation = new Stave(0, 0, measureWidth);
  const bareTab = new TabStave(0, 0, measureWidth, { spaceAboveStaffLn: 2 });
  Stave.formatBegModifiers([bareNotation, bareTab]);
  const bareNoteStartX = bareNotation.getNoteStartX();

  const clefNotation = new Stave(0, 0, measureWidth).addClef("treble").addTimeSignature(`${numBeats}/${beatValue}`);
  const clefTab = new TabStave(0, 0, measureWidth, { spaceAboveStaffLn: 2 }).addClef("tab");
  Stave.formatBegModifiers([clefNotation, clefTab]);
  return clefNotation.getNoteStartX() - bareNoteStartX;
}

function renderScoreRow(container, measures, options) {
  const measureWidth = options.measureWidth;
  const notationHeight = 90;
  const tabHeight = options.height;
  const { numBeats, beatValue } = parseTimeSignature(options.timeSignature);
  const clefOverhead = measureScoreClefOverhead(measureWidth, numBeats, beatValue);
  const widths = computeMeasureWidths(measures, measureWidth, clefOverhead);
  const totalWidth = rowCanvasWidth(widths, options, measureWidth, clefOverhead);

  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(totalWidth, notationHeight + tabHeight);
  const context = renderer.getContext();

  let firstNotationStave = null;
  let firstTabStave = null;
  let cursorX = 0;

  measures.forEach((measure, index) => {
    const width = widths[index];
    const x = cursorX;
    cursorX += width;
    const group = context.openGroup("measure");
    group.setAttribute("data-measure", String(measure.index));
    const notationStave = new Stave(x, 0, width, { leftBar: index === 0 });
    const tabStave = new TabStave(x, notationHeight, width, {
      spaceAboveStaffLn: 2,
      leftBar: index === 0,
    });
    if (index === 0) {
      notationStave.addClef("treble").addTimeSignature(`${numBeats}/${beatValue}`);
      tabStave.addClef("tab");
      firstNotationStave = notationStave;
      firstTabStave = tabStave;
    }
    Stave.formatBegModifiers([notationStave, tabStave]);
    notationStave.setContext(context).draw();
    tabStave.setContext(context).draw();
    addMeasureBackground(group, notationStave, tabStave);

    const tabNotes = createMeasureNotes(measure, { annotateChord: false });
    const standardNotes = createStandardNotes(measure);
    if (!tabNotes.length) {
      context.closeGroup();
      return;
    }

    const tabVoice = new Voice({ numBeats, beatValue }).setMode(Voice.Mode.SOFT);
    tabVoice.addTickables(tabNotes);
    const standardVoice = new Voice({ numBeats, beatValue }).setMode(Voice.Mode.SOFT);
    standardVoice.addTickables(standardNotes);

    new Formatter()
      .joinVoices([standardVoice])
      .joinVoices([tabVoice])
      .formatToStave([standardVoice, tabVoice], notationStave);

    const beams = Beam.applyAndGetBeams(standardVoice);
    standardVoice.draw(context, notationStave);
    beams.forEach(beam => beam.setContext(context).draw());
    tabVoice.draw(context, tabStave);

    for (const technique of measure.techniques) {
      const connector = connectorForTechnique(technique, tabNotes);
      connector?.setContext(context).draw();
    }
    context.closeGroup();
  });

  if (firstNotationStave && firstTabStave) {
    new StaveConnector(firstNotationStave, firstTabStave).setType("singleLeft").setContext(context).draw();
  }
  shrinkSvgToContent(container);
}

// Packs measures into rows by width rather than by a fixed count: a row holds
// measuresPerRow base-width measures, and a dense measure that needs more room
// takes the space of several ordinary ones (or a whole row on its own).
export function packMeasureRows(measures, measureWidth, measuresPerRow) {
  const rowBudget = Math.max(1, measuresPerRow) * measureWidth;
  const rows = [];
  let row = [];
  let rowWidth = 0;
  for (const measure of measures) {
    const width = measureNaturalWidth(measure, measureWidth);
    if (row.length && rowWidth + width > rowBudget) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    row.push(measure);
    rowWidth += width;
  }
  if (row.length) rows.push(row);
  return rows;
}

function renderMeasureRows(ast, target, options, className, drawRow) {
  target.replaceChildren();
  target.classList.add(className);

  const rows = packMeasureRows(ast.measures, options.measureWidth, options.measuresPerRow);
  let start = 0;
  rows.forEach((rowMeasures, rowIndex) => {
    const rowHost = document.createElement("div");
    rowHost.className = className === "vex-tab-score" ? "vex-tab-row" : "vex-score-row";
    rowHost.dataset.row = String(rowIndex + 1);
    target.append(rowHost);
    try {
      drawRow(rowHost, rowMeasures, options);
    } catch (error) {
      rowHost.classList.add("render-error");
      rowHost.textContent = `Mesures ${start + 1}–${start + rowMeasures.length} : ${error.message}`;
    }
    start += rowMeasures.length;
  });

  return target;
}

export function renderTablatureSvg(ast, target, options = {}) {
  const settings = {
    measureWidth: options.measureWidth ?? 200,
    height: options.height ?? 130,
    measuresPerRow: options.measuresPerRow ?? ast.measures.length,
    timeSignature: ast.timeSignature,
  };
  return renderMeasureRows(ast, target, settings, "vex-tab-score", renderRow);
}

export function renderScoreSvg(ast, target, options = {}) {
  const settings = {
    measureWidth: options.measureWidth ?? 220,
    height: options.height ?? 130,
    measuresPerRow: options.measuresPerRow ?? ast.measures.length,
    timeSignature: ast.timeSignature,
  };
  return renderMeasureRows(ast, target, settings, "vex-score-score", renderScoreRow);
}

export function serializeTablatureSvg(target) {
  const wrapper = document.createElementNS(SVG_NS, "svg");
  wrapper.setAttribute("xmlns", SVG_NS);
  wrapper.setAttribute("width", "100%");
  wrapper.setAttribute("height", "auto");
  return target.querySelectorAll("svg").length === 1
    ? new XMLSerializer().serializeToString(target.querySelector("svg"))
    : null;
}
