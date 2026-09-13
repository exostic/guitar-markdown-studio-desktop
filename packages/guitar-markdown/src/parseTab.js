const DEFAULT_TUNING = ["e", "B", "G", "D", "A", "E"];
const STRING_NUMBER_BY_LABEL = { e: 1, B: 2, G: 3, D: 4, A: 5, E: 6 };

function normalizeLines(source) {
  return source
    .split(/\r?\n/)
    .map(line => line.replace(/\t/g, "  "))
    .filter(line => line.trim().length > 0);
}

function findStringLines(lines) {
  const candidates = lines
    .map((line, sourceIndex) => {
      const match = line.match(/^\s*([eEBGDA])\s*\|(.+)$/);
      return match ? { label: match[1], body: match[2], sourceIndex } : null;
    })
    .filter(Boolean);

  if (candidates.length !== 6) {
    throw new Error("Une tablature doit contenir exactement 6 lignes de cordes (e, B, G, D, A, E).");
  }
  const labels = new Set(candidates.map(candidate => candidate.label));
  if (labels.size !== 6) {
    throw new Error("Chaque corde (e, B, G, D, A, E) doit apparaître exactement une fois dans la tablature.");
  }
  return candidates;
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

function parseMeasure(segments, measureIndex, chord = "", timeSignature = "4/4") {
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
      const position = { string: stringNumber, fret: token.value };
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

  return { index: measureIndex, chord, width, events, techniques, ornaments };
}

export function parseAsciiTab(source, options = {}) {
  const timeSignature = options.timeSignature ?? "4/4";
  const lines = normalizeLines(source);
  const stringLines = findStringLines(lines);
  const firstStringLineIndex = Math.min(...stringLines.map(line => line.sourceIndex));
  const chordLine = lines[firstStringLineIndex - 1] ?? "";
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

  const measures = Array.from({ length: measureCount }, (_, measureIndex) => {
    const segments = splitByString.map(line => ({
      label: line.label,
      segment: line.measures[measureIndex] ?? "",
    }));
    return parseMeasure(segments, measureIndex, chordLabels[measureIndex], timeSignature);
  });

  return {
    type: "tablature",
    tuning: options.tuning ?? DEFAULT_TUNING,
    timeSignature: options.timeSignature ?? "4/4",
    measures,
    source,
  };
}
