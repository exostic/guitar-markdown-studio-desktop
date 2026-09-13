import { buildScale, chordTones, fretsForPitchClasses, parseTuning, scalePosition } from "./theory.js";

const STRING_LETTERS = { e: 1, B: 2, G: 3, D: 4, A: 5, E: 6 };

// Colours for arpeggio tones, by chord degree. Roots reuse the highlight
// colour of the fretboard renderer; the others are chosen to stay readable
// with a white label inside the dot.
export const DEGREE_COLORS = {
  R: "#1f2937",
  3: "#e43b7d",
  b3: "#e43b7d",
  5: "#4c3584",
  b5: "#4c3584",
  "#5": "#4c3584",
  7: "#ff5211",
  b7: "#ff5211",
};
const EXTENSION_COLOR = "#9ca3af";

function parseRange(text) {
  const match = text.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) throw new Error(`Plage de frettes invalide « ${text.trim()} ».`);
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (to < from) throw new Error(`Plage de frettes invalide « ${text.trim()} ».`);
  return [from, to];
}

function parseNote(token) {
  const highlight = token.startsWith("[") && token.endsWith("]") && token.length > 2;
  const inner = highlight ? token.slice(1, -1) : token;
  if (!highlight && (inner.includes("[") || inner.includes("]"))) {
    throw new Error(`Frette invalide « ${token} ».`);
  }

  const match = inner.match(/^(\d+)(?:,(.+))?$/);
  if (!match || (match[2] !== undefined && !match[2].trim())) {
    throw new Error(`Frette invalide « ${token} ».`);
  }

  return { fret: Number(match[1]), label: match[2] ? match[2].trim() : null, highlight };
}

function parseNoteList(text) {
  return text.split("|").map(token => token.trim()).filter(Boolean).map(parseNote);
}

function removeNote(bucket, string, fret) {
  if (!bucket[string]) return;
  bucket[string] = bucket[string].filter(note => note.fret !== fret);
  if (!bucket[string].length) delete bucket[string];
}

function labelFor(mode, note, degree) {
  if (mode === "none") return null;
  if (mode === "degrees") return degree === "R" ? "R" : degree;
  return note;
}

function splitRootAndName(text) {
  const match = text.trim().match(/^(\S+)\s+(.+)$/);
  if (!match) throw new Error(`Gamme invalide « ${text.trim()} » : indiquez la note puis le nom (ex. A minor pentatonic).`);
  return [match[1], match[2]];
}

export function parseScale(source, options = {}) {
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Diagramme de gamme invalide : aucune ligne trouvée.");

  let fretRange = null;
  let scaleText = null;
  let arpeggioText = null;
  let position = null;
  let labels = null;
  let tuning = options.tuning ?? parseTuning("");
  const explicitLines = [];

  for (const line of lines) {
    const header = line.match(/^(frets|scale|gamme|arpeggio|arpege|arpège|position|labels|etiquettes|étiquettes|tuning|accordage)\s*:\s*(.+)$/i);
    if (header) {
      const key = header[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const value = header[2].trim();
      if (key === "frets") fretRange = parseRange(value);
      else if (key === "scale" || key === "gamme") scaleText = value;
      else if (key === "arpeggio" || key === "arpege") arpeggioText = value;
      else if (key === "position") {
        position = Number(value);
        if (!Number.isInteger(position) || position < 1) throw new Error(`Position invalide « ${value} ».`);
      } else if (key === "labels" || key === "etiquettes") {
        const mode = value.toLowerCase();
        if (mode === "notes" || mode === "degrees" || mode === "none") labels = mode;
        else if (mode === "degres" || mode === "degrés" || mode === "degré" || mode === "degre") labels = "degrees";
        else if (mode === "aucune" || mode === "aucun" || mode === "non") labels = "none";
        else throw new Error(`Étiquettes invalides « ${value} » : notes, degrees ou none.`);
      } else if (key === "tuning" || key === "accordage") {
        const parsed = parseTuning(value);
        if (!parsed) throw new Error(`Accordage inconnu « ${value} ».`);
        tuning = parsed;
      }
      continue;
    }

    const stringMatch = line.match(/^([eBGDAE])\s*:\s*(.+)$/);
    if (stringMatch) {
      explicitLines.push({ string: STRING_LETTERS[stringMatch[1]], notes: parseNoteList(stringMatch[2]) });
      continue;
    }

    throw new Error(`Ligne de diagramme invalide : « ${line} »`);
  }

  if (scaleText && arpeggioText) throw new Error("Utilisez soit scale:, soit arpeggio:, pas les deux.");

  const dim = {};
  const highlight = {};
  let meta = null;

  if (scaleText || arpeggioText) {
    let tones;
    if (scaleText) {
      const [root, name] = splitRootAndName(scaleText);
      const built = buildScale(root, name);
      tones = { kind: "scale", root: built.root, rootPc: built.rootPc, name: built.name, labelFr: built.labelFr, pcs: built.pcs, notes: built.notes, degrees: built.degrees.map(degree => (degree === "1" ? "R" : degree)) };
    } else {
      const chord = chordTones(arpeggioText);
      if (!chord) throw new Error(`Accord inconnu « ${arpeggioText} » pour arpeggio:.`);
      tones = { kind: "arpeggio", root: chord.root, rootPc: chord.rootPc, name: arpeggioText.trim(), labelFr: null, pcs: chord.pcs, notes: chord.notes, degrees: chord.degrees };
    }
    const labelMode = labels ?? (tones.kind === "scale" ? "notes" : "degrees");

    let positionRange = null;
    if (position !== null && !fretRange) {
      positionRange = scalePosition(tuning, tones, position);
      if (!positionRange) throw new Error(`Position ${position} introuvable : cette gamme a ${tones.pcs.length} positions.`);
    }
    const range = fretRange ?? positionRange ?? [0, 12];

    for (const found of fretsForPitchClasses(tuning, tones.pcs, range)) {
      const index = tones.pcs.indexOf(found.pc);
      const degree = tones.degrees[index];
      const note = { fret: found.fret, label: labelFor(labelMode, tones.notes[index], degree), degree };
      if (tones.kind === "arpeggio") note.color = DEGREE_COLORS[degree] ?? EXTENSION_COLOR;
      const bucket = found.pc === tones.rootPc ? highlight : dim;
      (bucket[found.string] ??= []).push(note);
    }
    fretRange = range;
    meta = {
      kind: tones.kind,
      root: tones.root,
      name: tones.name,
      labelFr: tones.labelFr,
      notes: tones.notes,
      degrees: tones.degrees,
      position: positionRange ? position : null,
      labels: labelMode,
      fretRange: range,
    };
  }

  for (const { string, notes } of explicitLines) {
    for (const note of notes) {
      removeNote(dim, string, note.fret);
      removeNote(highlight, string, note.fret);
      const bucket = note.highlight ? highlight : dim;
      (bucket[string] ??= []).push({ fret: note.fret, label: note.label });
    }
  }

  if (!fretRange) {
    const allFrets = [...Object.values(dim).flat(), ...Object.values(highlight).flat()].map(note => note.fret);
    if (!allFrets.length) throw new Error("Diagramme de gamme invalide : aucune frette trouvée.");
    fretRange = [Math.min(...allFrets), Math.max(...allFrets)];
  }

  const ast = { type: "scale", fretRange, dim, highlight };
  if (meta) ast.meta = meta;
  return ast;
}
