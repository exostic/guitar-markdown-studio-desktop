const DEFAULT_TUNING = ["e", "B", "G", "D", "A", "E"];
const STRING_NUMBER_BY_LABEL = { e: 1, B: 2, G: 3, D: 4, A: 5, E: 6 };

// Non-blank lines with their line number in the source, so a note can be
// traced back to where it is written.
function normalizeLines(source) {
  return source
    .split(/\r?\n/)
    .map((text, line) => ({ text: text.replace(/\t/g, "  "), line }))
    .filter(entry => entry.text.trim().length > 0);
}

// A block holds one or more systems: groups of the six string lines, read
// one after the other as consecutive bars (a long song wraps every few
// bars for readability). A label seen again starts the next system.
function findSystems(lines) {
  const candidates = lines
    .map((entry, sourceIndex) => {
      const match = entry.text.match(/^\s*([eEBGDA])\s*\|(.+)$/);
      // `prefix`: characters before the music ("e|", spaces included).
      return match ? { label: match[1], body: match[2], sourceIndex, line: entry.line, prefix: entry.text.length - match[2].length } : null;
    })
    .filter(Boolean);
  if (!candidates.length) {
    throw new Error("Une tablature doit contenir exactement 6 lignes de cordes (e, B, G, D, A, E).");
  }
  const systems = [];
  let current = [];
  for (const candidate of candidates) {
    if (current.some(line => line.label === candidate.label)) {
      systems.push(current);
      current = [];
    }
    current.push(candidate);
  }
  systems.push(current);
  for (const system of systems) {
    if (system.length !== 6) {
      throw new Error(systems.length > 1
        ? "Chaque groupe de lignes d'une tablature doit contenir les 6 cordes (e, B, G, D, A, E)."
        : "Une tablature doit contenir exactement 6 lignes de cordes (e, B, G, D, A, E).");
    }
  }
  return systems;
}

function splitMeasures(body) {
  const cleaned = body.endsWith("|") ? body.slice(0, -1) : body;
  return cleaned.split("|");
}

// A note token is a fret number or `x` (muted), optionally wrapped: `(8)` is
// a ghost/tied note played softly, `<12>` a natural harmonic.
function readTokenAt(segment, index) {
  const rest = segment.slice(index);
  const match = rest.match(/^(?:\((\d+)\)|<(\d+)>|(\d+|x))/i);
  if (!match) return null;
  const token = { value: (match[1] ?? match[2] ?? match[3]).toLowerCase(), length: match[0].length };
  if (match[1] !== undefined) token.ghost = true;
  if (match[2] !== undefined) token.harmonic = true;
  return token;
}

// Parenthesised words such as `(hold)` are performance notes: drop them so
// their letters are not mistaken for techniques.
function cleanTechniqueText(text) {
  return text.replace(/\([a-z]+\)/gi, "");
}

// Links join two notes on one string: the second note is reached without a
// new pick (hammer, pull, tap), by sliding, by bending straight into it
// (`8b10`) or by releasing a bend onto it (`10r8`, `8b---r8`).
function linkBetween(segment, fromEnd, toStart) {
  const text = cleanTechniqueText(segment.slice(fromEnd, toStart));
  if (/h/i.test(text)) return "hammer";
  if (/p/i.test(text)) return "pull";
  if (/t/i.test(text)) return "tap";
  if (/\//.test(text)) return "slide-up";
  if (/\\/.test(text)) return "slide-down";
  if (/^b$/i.test(text)) return "bend";
  if (/r$/i.test(text) && !/^br/i.test(text)) return "release";
  return null;
}

// Ornaments belong to one note and are read from the text that follows it,
// up to the next note or the end of the bar: `8b---` a full bend with no
// written target, `8br` a bend released on the same note, `7~~` vibrato.
function ornamentsAfter(segment, fromEnd, toStart) {
  const text = cleanTechniqueText(segment.slice(fromEnd, toStart));
  const found = [];
  if (/^br/i.test(text)) found.push("bend-release");
  else if (/^b/i.test(text) && !/^b$/i.test(text)) found.push("bend");
  if (/~/.test(text)) found.push("vibrato");
  return found;
}

const DURATION_TABLE = [
  { sixteenths: 24, duration: "hd" },
  { sixteenths: 16, duration: "w" },
  { sixteenths: 12, duration: "qd" },
  { sixteenths: 8, duration: "h" },
  { sixteenths: 6, duration: "8d" },
  { sixteenths: 4, duration: "q" },
  { sixteenths: 3, duration: "16d" },
  { sixteenths: 2, duration: "8" },
  { sixteenths: 1, duration: "16" },
];

function quantizeDuration(sixteenths) {
  const rounded = Math.max(1, Math.round(sixteenths));
  let closest = DURATION_TABLE[DURATION_TABLE.length - 1];
  let bestDiff = Infinity;
  for (const entry of DURATION_TABLE) {
    const diff = Math.abs(entry.sixteenths - rounded);
    if (diff < bestDiff) {
      bestDiff = diff;
      closest = entry;
    }
  }
  return closest.duration;
}

function parseTimeSignature(timeSignature) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(timeSignature ?? "4/4");
  if (!match) return { beatsPerMeasure: 4, beatUnit: 4 };
  return { beatsPerMeasure: Number(match[1]), beatUnit: Number(match[2]) };
}

function parseMeasure(segments, measureIndex, chord = "", timeSignature = "4/4", sources = {}) {
  const width = Math.max(...segments.map(({ segment }) => segment.length), 1);
  const { beatsPerMeasure, beatUnit } = parseTimeSignature(timeSignature);
  const totalSixteenths = beatsPerMeasure * (16 / beatUnit);
  const eventMap = new Map();
  const perStringNotes = [];

  segments.forEach(({ label, segment }) => {
    const stringNumber = STRING_NUMBER_BY_LABEL[label] ?? STRING_NUMBER_BY_LABEL[label.toUpperCase()];
    const notes = [];
    for (let column = 0; column < segment.length;) {
      const token = readTokenAt(segment, column);
      if (!token) {
        column += 1;
        continue;
      }
      const note = {
        string: stringNumber,
        fret: token.value,
        column,
        endColumn: column + token.length,
      };
      notes.push(note);
      const position = { string: stringNumber, fret: token.value, column, length: token.length };
      if (token.ghost) position.ghost = true;
      if (token.harmonic) position.harmonic = true;
      if (!eventMap.has(column)) eventMap.set(column, []);
      eventMap.get(column).push(position);
      column += token.length;
    }
    perStringNotes.push({ string: stringNumber, segment, notes });
  });

  const sortedColumns = [...eventMap.keys()].sort((a, b) => a - b);
  const events = sortedColumns.map((column, eventIndex) => {
    const nextColumn = sortedColumns[eventIndex + 1] ?? width;
    const sixteenths = ((nextColumn - column) / width) * totalSixteenths;
    return {
      id: `m${measureIndex}-e${eventIndex}`,
      column,
      offset: column / width,
      duration: quantizeDuration(sixteenths),
      positions: eventMap.get(column).sort((a, b) => a.string - b.string),
    };
  });

  const techniques = [];
  const ornaments = [];
  for (const row of perStringNotes) {
    row.notes.forEach((current, i) => {
      const next = row.notes[i + 1];
      const eventIndex = events.findIndex(event => event.column === current.column);
      if (eventIndex < 0) return;
      for (const type of ornamentsAfter(row.segment, current.endColumn, next?.column ?? row.segment.length)) {
        ornaments.push({ type, string: row.string, event: eventIndex });
      }
      if (!next) return;
      const type = linkBetween(row.segment, current.endColumn, next.column);
      const toEvent = events.findIndex(event => event.column === next.column);
      if (type && toEvent >= 0) techniques.push({ type, string: row.string, fromEvent: eventIndex, toEvent });
    });
  }

  // `sources[string]` = { line, column }: where this bar starts on that
  // string's line of the source (line: 0-based in the block, column: 0-based).
  return { index: measureIndex, chord, width, events, techniques, ornaments, sources };
}

// One system: its bars, with the chord names read from the line above it.
function parseSystem(lines, stringLines, timeSignature, firstMeasureIndex) {
  const firstStringLineIndex = Math.min(...stringLines.map(line => line.sourceIndex));
  const above = lines[firstStringLineIndex - 1]?.text ?? "";
  const chordLine = /^\s*[eEBGDA]\s*\|/.test(above) ? "" : above;
  const splitByString = stringLines.map(line => ({ ...line, measures: splitMeasures(line.body) }));
  const measureCount = Math.max(...splitByString.map(line => line.measures.length));

  const measureWidths = Array.from({ length: measureCount }, (_, index) =>
    Math.max(...splitByString.map(line => (line.measures[index] ?? "").length), 1)
  );
  let cursor = 0;
  const chordLabels = measureWidths.map(width => {
    const label = chordLine.slice(cursor, cursor + width + 1).trim();
    cursor += width + 1;
    return label;
  });

  return Array.from({ length: measureCount }, (_, index) => {
    const segments = splitByString.map(line => ({
      label: line.label,
      segment: line.measures[index] ?? "",
    }));
    const sources = {};
    for (const line of splitByString) {
      const string = STRING_NUMBER_BY_LABEL[line.label] ?? STRING_NUMBER_BY_LABEL[line.label.toUpperCase()];
      const before = line.measures.slice(0, index).reduce((total, segment) => total + segment.length + 1, 0);
      sources[string] = { line: line.line, column: line.prefix + before };
    }
    return parseMeasure(segments, firstMeasureIndex + index, chordLabels[index], timeSignature, sources);
  });
}

export function parseAsciiTab(source, options = {}) {
  const timeSignature = options.timeSignature ?? "4/4";
  const lines = normalizeLines(source);
  const measures = [];
  for (const system of findSystems(lines)) {
    measures.push(...parseSystem(lines, system, timeSignature, measures.length));
  }

  return {
    type: "tablature",
    tuning: options.tuning ?? DEFAULT_TUNING,
    timeSignature: options.timeSignature ?? "4/4",
    measures,
    source,
  };
}
