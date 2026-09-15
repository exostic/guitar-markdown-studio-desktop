// Turns a parsed ASCII tablature into alphaTex, alphaTab's text notation, so
// the same block can be engraved by alphaTab. The ASCII stays the source of
// truth; this is a translation.
//
// alphaTex needs explicit rhythm, which ASCII columns only suggest. Each bar
// is fitted to the coarsest grid its note columns line up with (quarters,
// eighths, eighth triplets, sixteenths, thirty-seconds); a bar that fits no
// grid keeps its note order on a fine grid instead. `grid` forces the number
// of cells per bar. Notes last until the next note of the bar, with a rest
// before the first one when it does not start the bar.
//
// Techniques: h/p → {h} on the origin, taps also {tt} on the arrival, slides
// → {ss}, bends and releases fold into bend points on the note that starts
// them (`8b10r8` is one note with {b (0 4 0)}), vibrato → {v}, ghost → {g},
// harmonics → {nh}, muted → dead note.

const NOTE_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
// Cell sizes tried in order, in sixteenths: quarter, eighth, eighth
// triplet, sixteenth, thirty-second.
const CELL_CANDIDATES = [4, 2, 4 / 3, 1, 0.5];
const FINEST_CELL = 0.25;
const MAX_SNAP_ERROR = 0.3;
const CLEAN_SNAP_ERROR = 0.12;
const SHIFTS = [0, 0.5, 1, 1.5, 2];
const BEND_QUARTER_TONES = 4;
const INSTRUMENTS = { acoustic: 25, electric: 27, distortion: 30 };

// Plain durations (sixteenths → alphaTex duration and dots), longest first.
const DURATIONS = [
  { sixteenths: 16, base: 1, dots: 0 },
  { sixteenths: 12, base: 2, dots: 1 },
  { sixteenths: 8, base: 2, dots: 0 },
  { sixteenths: 6, base: 4, dots: 1 },
  { sixteenths: 4, base: 4, dots: 0 },
  { sixteenths: 3, base: 8, dots: 1 },
  { sixteenths: 2, base: 8, dots: 0 },
  { sixteenths: 1.5, base: 16, dots: 1 },
  { sixteenths: 1, base: 16, dots: 0 },
  { sixteenths: 0.75, base: 32, dots: 1 },
  { sixteenths: 0.5, base: 32, dots: 0 },
  { sixteenths: 0.25, base: 64, dots: 0 },
];

function tuningNote(midi) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function parseTimeSignature(timeSignature) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(timeSignature ?? "4/4");
  if (!match) return { beats: 4, unit: 4 };
  return { beats: Number(match[1]), unit: Number(match[2]) };
}

function nearlyInteger(value) {
  return Math.abs(value - Math.round(value)) < 1e-6;
}

function isTripletCell(cell) {
  return !nearlyInteger(cell * 4);
}

// Snap columns to `cells` slots, allowing the bar to start a little after
// the bar line (writers often pad with a dash). Null when the columns do
// not line up or two notes would land on the same slot.
function fitGrid(columns, width, cells) {
  let best = null;
  for (const shift of SHIFTS) {
    // Only padding that exists before the first note can be discounted.
    if (shift > columns[0]) break;
    const raw = columns.map(column => (Math.max(0, column - shift) / width) * cells);
    const slots = raw.map(Math.round);
    const increasing = slots.every((slot, index) => index === 0 || slot > slots[index - 1]);
    if (!increasing || slots[slots.length - 1] >= cells) continue;
    const error = Math.max(...raw.map((value, index) => Math.abs(value - slots[index])));
    if (!best || error < best.error) best = { slots, error };
  }
  return best && best.error <= MAX_SNAP_ERROR ? best : null;
}

// Order-preserving fallback: notes take their rounded slot on a fine grid,
// pushed forward when they collide; a bar too dense even for that spreads
// its notes evenly.
function sequenceSlots(columns, width, totalSixteenths) {
  let cell = 0.5;
  let cells = Math.round(totalSixteenths / cell);
  if (columns.length > cells) {
    cell = FINEST_CELL;
    cells = Math.round(totalSixteenths / cell);
  }
  const slots = [];
  for (const column of columns) {
    const slot = Math.max(Math.round((column / width) * cells), slots.length ? slots[slots.length - 1] + 1 : 0);
    slots.push(slot);
  }
  if (slots[slots.length - 1] >= cells) {
    if (columns.length <= cells) return { cell, cells, slots: columns.map((_, index) => Math.floor((index * cells) / columns.length)) };
    // More notes than the finest grid holds: one cell each, the bar overflows.
    return { cell, cells: columns.length, slots: columns.map((_, index) => index) };
  }
  return { cell, cells, slots };
}

// A forced grid keeps its cells even when the columns are off: notes take
// the nearest free cell in order.
function forcedSlots(columns, width, cells) {
  const slots = [];
  for (const column of columns) {
    const slot = Math.max(Math.round((column / width) * cells), slots.length ? slots[slots.length - 1] + 1 : 0);
    slots.push(Math.min(slot, cells - 1));
  }
  return slots.every((slot, index) => index === 0 || slot > slots[index - 1]) ? slots : null;
}

function chooseGrid(columns, width, totalSixteenths, explicitCells) {
  if (explicitCells) {
    const cell = totalSixteenths / explicitCells;
    const slots = fitGrid(columns, width, explicitCells)?.slots ?? forcedSlots(columns, width, explicitCells);
    if (slots) return { cell, cells: explicitCells, slots };
  }
  // The coarsest grid the columns sit on cleanly wins; failing that, the
  // grid they fit best (a triplet grid must earn its place, it is tried
  // after the eighths and would otherwise catch plain sixteenths).
  let best = null;
  for (const cell of CELL_CANDIDATES) {
    const cells = totalSixteenths / cell;
    if (!nearlyInteger(cells)) continue;
    const fit = fitGrid(columns, width, Math.round(cells));
    if (!fit) continue;
    if (fit.error <= CLEAN_SNAP_ERROR) return { cell, cells: Math.round(cells), slots: fit.slots };
    if (!best || fit.error < best.error) best = { cell, cells: Math.round(cells), slots: fit.slots, error: fit.error };
  }
  if (best) return best;
  return sequenceSlots(columns, width, totalSixteenths);
}

// Splits a span of cells into alphaTex durations (the first is the note,
// the rest are tied continuations).
function durationPieces(cellCount, cell) {
  const pieces = [];
  if (isTripletCell(cell)) {
    // Three cells make a plain note; 1, 2, 4 or 8 cells are tuplet notes
    // (eighth, quarter, half, whole of a triplet). Greedy, largest first.
    const groupSixteenths = cell * 3;
    let remaining = cellCount;
    while (remaining > 0) {
      const plain = Math.floor(remaining / 3) * 3;
      const tuplet = [8, 4, 2, 1].find(size => size <= remaining) ?? 0;
      if (plain >= tuplet && plain > 0) {
        pieces.push(...durationPieces((plain / 3) * groupSixteenths, 1));
        remaining -= plain;
      } else {
        pieces.push({ base: 16 / ((groupSixteenths / 2) * tuplet), dots: 0, tuplet: 3 });
        remaining -= tuplet;
      }
    }
    return pieces;
  }
  let remaining = cellCount * cell;
  while (remaining > 1e-6) {
    const piece = DURATIONS.find(entry => entry.sixteenths <= remaining + 1e-6) ?? DURATIONS[DURATIONS.length - 1];
    pieces.push({ base: piece.base, dots: piece.dots });
    remaining -= piece.sixteenths;
  }
  return pieces;
}

function beatSuffix(piece, extra = []) {
  const effects = [...extra];
  if (piece.dots === 1) effects.push("d");
  if (piece.dots === 2) effects.push("dd");
  if (piece.tuplet) effects.push(`tu ${piece.tuplet}`);
  return `.${piece.base}${effects.length ? `{${effects.join(" ")}}` : ""}`;
}

function restTokens(cellCount, cell) {
  return durationPieces(cellCount, cell).map(piece => `r${beatSuffix(piece)}`);
}

function key(eventIndex, string) {
  return `${eventIndex}:${string}`;
}

// Per measure: which notes fold into a bend on an earlier note, and the
// bend points / effects each remaining note carries.
function analyseMeasure(measure) {
  const outgoing = new Map();
  const incoming = new Map();
  for (const technique of measure.techniques ?? []) {
    outgoing.set(key(technique.fromEvent, technique.string), technique);
    incoming.set(key(technique.toEvent, technique.string), technique);
  }
  const ornaments = new Map();
  for (const ornament of measure.ornaments ?? []) {
    const id = key(ornament.event, ornament.string);
    if (!ornaments.has(id)) ornaments.set(id, new Set());
    ornaments.get(id).add(ornament.type);
  }
  const folded = new Set();
  const foldedInto = new Map(); // event index → event index of the note it folded into
  const heldThrough = new Map(); // "event:string" of a later beat → strings held by a tie there
  const noteEffects = new Map();
  const beatEffects = new Map();
  const fretAt = (eventIndex, string) => measure.events[eventIndex]?.positions.find(p => p.string === string);

  measure.events.forEach((event, eventIndex) => {
    for (const position of event.positions) {
      const id = key(eventIndex, position.string);
      if (folded.has(id) || position.fret === "x") continue;
      const effects = [];
      const types = new Set(ornaments.get(id) ?? []);
      const arrival = incoming.get(id);
      if (arrival?.type === "tap") beatEffects.set(eventIndex, [...(beatEffects.get(eventIndex) ?? []), "tt"]);

      // Follow bends/releases forward: they are one note with a bend curve.
      const points = [0];
      let cursor = eventIndex;
      let link = outgoing.get(id);
      while (link && (link.type === "bend" || link.type === "release")) {
        const target = fretAt(link.toEvent, position.string);
        if (!target || target.fret === "x") break;
        points.push((Number(target.fret) - Number(position.fret)) * 2);
        folded.add(key(link.toEvent, position.string));
        foldedInto.set(link.toEvent, eventIndex);
        for (const type of ornaments.get(key(link.toEvent, position.string)) ?? []) types.add(type);
        for (let held = cursor + 1; held <= link.toEvent; held += 1) {
          if (!heldThrough.has(held)) heldThrough.set(held, new Set());
          heldThrough.get(held).add(position.string);
        }
        cursor = link.toEvent;
        link = outgoing.get(key(cursor, position.string));
      }
      if (points.length > 1) effects.push(`b (${points.join(" ")})`);
      else if (types.has("bend-release")) effects.push(`b (0 ${BEND_QUARTER_TONES} 0)`);
      else if (types.has("bend")) effects.push(`b (0 ${BEND_QUARTER_TONES})`);

      if (link?.type === "hammer" || link?.type === "pull" || link?.type === "tap") effects.push("h");
      if (link?.type === "slide-up" || link?.type === "slide-down") effects.push("ss");
      if (types.has("vibrato")) effects.push("v");
      if (position.ghost) effects.push("g");
      if (position.harmonic) effects.push("nh");
      noteEffects.set(id, effects);
    }
  });
  return { folded, foldedInto, heldThrough, noteEffects, beatEffects };
}

// Frets beyond any guitar neck (two frets run together in the ASCII, such
// as "1012") would make alphaTab lay out a note far above the staff and
// crash the renderer: write them as dead notes instead.
const MAX_FRET = 30;

function noteToken(position, effects) {
  if (position.fret === "x" || Number(position.fret) > MAX_FRET) return `x.${position.string}`;
  return `${position.fret}.${position.string}${effects.length ? `{${effects.join(" ")}}` : ""}`;
}

function measureToAlphaTex(measure, { totalSixteenths, grid }) {
  const { folded, foldedInto, heldThrough, noteEffects, beatEffects } = analyseMeasure(measure);
  const beats = [];
  measure.events.forEach((event, eventIndex) => {
    const positions = event.positions.filter(position => !folded.has(key(eventIndex, position.string)));
    const held = [...(heldThrough.get(eventIndex) ?? [])].filter(string => !positions.some(p => p.string === string));
    if (!positions.length && !held.length) return;
    if (!positions.length) return; // only held strings: the earlier beat simply lasts longer
    beats.push({ eventIndex, column: event.column, positions, held, effects: beatEffects.get(eventIndex) ?? [] });
  });
  // beatByEvent[eventIndex] = index of the alphaTab beat (rests and tied
  // continuations count) that starts this ASCII event; an event that folded
  // into an earlier note (a bend's arrival or release) points at that note.
  const beatByEvent = measure.events.map(() => null);
  const resolveFolded = () => {
    measure.events.forEach((event, eventIndex) => {
      if (beatByEvent[eventIndex] === null && foldedInto.has(eventIndex)) beatByEvent[eventIndex] = beatByEvent[foldedInto.get(eventIndex)];
    });
  };
  if (!beats.length) return { tokens: ["r.1"], beatByEvent };

  const { cell, cells, slots } = chooseGrid(beats.map(beat => beat.column), measure.width, totalSixteenths, grid);
  const tokens = [];
  if (slots[0] > 0) tokens.push(...restTokens(slots[0], cell));
  beats.forEach((beat, index) => {
    const span = (index + 1 < beats.length ? slots[index + 1] : cells) - slots[index];
    const pieces = durationPieces(span, cell);
    const notes = beat.positions.map(position => noteToken(position, noteEffects.get(key(beat.eventIndex, position.string)) ?? []));
    beatByEvent[beat.eventIndex] = tokens.length;
    notes.push(...beat.held.map(string => `-.${string}`));
    const extra = [...beat.effects];
    if (index === 0 && measure.chord) extra.push(`ch "${measure.chord.replace(/"/g, "")}"`);
    pieces.forEach((piece, pieceIndex) => {
      const group = pieceIndex === 0
        ? notes
        : beat.positions.filter(position => position.fret !== "x").map(position => `-.${position.string}`).concat(beat.held.map(string => `-.${string}`));
      if (!group.length) {
        tokens.push(`r${beatSuffix(piece)}`);
        return;
      }
      const body = group.length === 1 ? group[0] : `(${group.join(" ")})`;
      tokens.push(`${body}${beatSuffix(piece, pieceIndex === 0 ? extra : [])}`);
    });
  });
  resolveFolded();
  return { tokens, beatByEvent };
}

// The alphaTex text plus, per bar, the alphaTab beat index each ASCII event
// became (so playback can highlight the note being played).
export function translateTab(ast, options = {}) {
  const timeSignature = options.timeSignature ?? ast.timeSignature ?? "4/4";
  const { beats, unit } = parseTimeSignature(timeSignature);
  const totalSixteenths = (beats * 16) / unit;
  const header = [];
  if (options.title) header.push(`\\title "${options.title.replace(/"/g, "")}"`);
  header.push(`\\tempo ${Number(options.tempo) > 0 ? Number(options.tempo) : 80}`);
  // A lesson does not need the default forte at the start of the piece.
  header.push("\\hidedynamics");
  if (options.tuning?.midi?.length === 6) header.push(`\\tuning ${[...options.tuning.midi].reverse().map(tuningNote).join(" ")}`);
  if (options.capo) header.push(`\\capo ${Number(options.capo)}`);
  const instrument = INSTRUMENTS[options.sound] ?? options.instrument;
  if (instrument !== undefined && instrument !== null) header.push(`\\instrument ${instrument}`);
  header.push(`\\track "${(options.trackName ?? "Guitare").replace(/"/g, "")}"`);
  header.push(`\\staff {${options.staff ?? "score"}}`);
  header.push(".");

  const grid = Number(options.grid) > 0 ? Math.round(Number(options.grid)) : null;
  const beatMap = [];
  const bars = ast.measures.map((measure, index) => {
    const { tokens, beatByEvent } = measureToAlphaTex(measure, { totalSixteenths, grid });
    beatMap.push(beatByEvent);
    return `${index === 0 ? `\\ts ${beats} ${unit} ` : ""}${tokens.join(" ")}`;
  });
  return { tex: `${header.join("\n")}\n${bars.join(" |\n")}\n`, beats: beatMap };
}

export function toAlphaTex(ast, options = {}) {
  return translateTab(ast, options).tex;
}
