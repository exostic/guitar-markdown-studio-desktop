// Music theory helpers shared by the scale, key, grid, circle, transpose and
// audio modules. Pure functions, no DOM. Nothing here throws except
// `buildScale` (unknown scale name), so callers can feed it arbitrary user
// text (lyrics, odd chord spellings) without guarding.

export const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SOLFEGE = { do: "C", re: "D", mi: "E", fa: "F", sol: "G", la: "A", si: "B" };
const SOLFEGE_NAMES = { C: "Do", D: "Ré", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };

function stripAccents(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeAccidental(text) {
  return text.replace(/♯/g, "#").replace(/♭/g, "b");
}

function mod12(value) {
  return ((value % 12) + 12) % 12;
}

// ---------------------------------------------------------------------------
// Notes

const NOTE_PATTERN = /^\s*([A-Ga-g]|do|r[eé]|mi|fa|sol|la|si)\s*([#b♯♭]?)\s*(-?\d)?\s*$/i;

export function parseNote(text) {
  if (typeof text !== "string") return null;
  const match = NOTE_PATTERN.exec(text);
  if (!match) return null;
  const rawLetter = match[1];
  const solfegeKey = stripAccents(rawLetter.toLowerCase());
  const letter = rawLetter.length === 1 ? rawLetter.toUpperCase() : SOLFEGE[solfegeKey];
  if (!letter) return null;
  const accidental = normalizeAccidental(match[2] ?? "");
  const pc = mod12(LETTER_PC[letter] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0));
  const octave = match[3] !== undefined ? Number(match[3]) : null;
  const midi = octave === null ? null : (octave + 1) * 12 + LETTER_PC[letter] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
  return { letter, accidental, name: letter + accidental, pc, octave, midi };
}

export function noteName(pc, prefer = "sharp") {
  return (prefer === "flat" ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[mod12(pc)];
}

export function solfegeName(noteText) {
  const note = parseNote(noteText);
  return note ? SOLFEGE_NAMES[note.letter] + note.accidental : null;
}

export function noteToMidi(text) {
  return parseNote(text)?.midi ?? null;
}

export function midiToNoteName(midi, prefer = "sharp") {
  return `${noteName(midi, prefer)}${Math.floor(midi / 12) - 1}`;
}

export function midiToFrequency(midi, a4 = 440) {
  return a4 * 2 ** ((midi - 69) / 12);
}

function preferFromAccidental(accidental, fallback = "sharp") {
  if (accidental === "b") return "flat";
  if (accidental === "#") return "sharp";
  return fallback;
}

export function transposeNote(text, semitones, prefer = "auto") {
  const note = parseNote(text);
  if (!note) return text;
  const spelling = prefer === "auto" ? preferFromAccidental(note.accidental) : prefer;
  if (note.midi === null) return noteName(note.pc + semitones, spelling);
  return midiToNoteName(note.midi + semitones, spelling);
}

// Spells a scale/chord degree from the root letter so that diatonic material
// keeps one letter per degree (F major → Bb, G major → F#). Falls back to the
// plain sharp/flat table whenever that would produce a double accidental or
// one of the "theoretical" names (E#, B#, Cb, Fb) that only confuse learners.
function spellDegree(rootLetter, degreeNumber, pc, prefer) {
  const letter = LETTERS[(LETTERS.indexOf(rootLetter) + degreeNumber - 1) % 7];
  const diff = mod12(pc - LETTER_PC[letter] + 6) - 6;
  if (diff === 0) return letter;
  if (diff === 1 && letter !== "E" && letter !== "B") return `${letter}#`;
  if (diff === -1 && letter !== "C" && letter !== "F") return `${letter}b`;
  return noteName(pc, prefer);
}

function degreeNumberOf(degreeLabel) {
  const digits = Number(String(degreeLabel).replace(/[^0-9]/g, ""));
  if (!digits) return 1;
  if (digits > 7) return ((digits - 1) % 7) + 1;
  return digits;
}

// ---------------------------------------------------------------------------
// Keys

const MODE_WORDS = /^(.+?)\s*(major|majeure|majeur|maj|minor|mineure|mineur|min|m|M|ionian|ionien|aeolian|eolien)?$/;
const MINOR_MODES = new Set(["minor", "mineure", "mineur", "min", "m", "aeolian", "eolien"]);

export const KEY_FUNCTIONS_FR = ["Tonique", "Sus-tonique", "Médiante", "Sous-dominante", "Dominante", "Sus-dominante", "Sensible"];

function keyPreference(note, mode) {
  if (note.accidental) return preferFromAccidental(note.accidental);
  if (mode === "major") return note.letter === "F" ? "flat" : "sharp";
  return ["D", "G", "C", "F"].includes(note.letter) ? "flat" : "sharp";
}

export function parseKey(text) {
  if (typeof text !== "string") return null;
  const cleaned = normalizeAccidental(text.trim());
  const match = MODE_WORDS.exec(cleaned);
  if (!match) return null;
  const note = parseNote(match[1]);
  if (!note || note.octave !== null) return null;
  const modeWord = match[2] ? stripAccents(match[2]) : "";
  const mode = MINOR_MODES.has(modeWord) ? "minor" : "major";
  const prefer = keyPreference(note, mode);
  const majorPc = mode === "major" ? note.pc : mod12(note.pc + 3);
  const sharps = mod12(majorPc * 7);
  const useFlats = prefer === "flat" && sharps !== 0;
  const accidentals = useFlats ? { count: 12 - sharps, kind: "flat" } : { count: sharps, kind: sharps ? "sharp" : null };
  const relativePc = mode === "major" ? mod12(note.pc - 3) : mod12(note.pc + 3);
  const relative = mode === "major" ? `${noteName(relativePc, prefer)}m` : noteName(relativePc, prefer);
  return {
    tonic: note.name,
    tonicPc: note.pc,
    mode,
    prefer,
    accidentals,
    relative,
    name: mode === "major" ? note.name : `${note.name}m`,
    label: `${note.name} ${mode === "major" ? "majeur" : "mineur"}`,
    solfege: `${SOLFEGE_NAMES[note.letter]}${note.accidental} ${mode === "major" ? "majeur" : "mineur"}`,
  };
}

export function preferAccidentals(keyText) {
  return parseKey(keyText ?? "")?.prefer ?? "sharp";
}

// ---------------------------------------------------------------------------
// Scales

function scale(intervals, degrees, labelFr, aliases, minorLike = false) {
  return { intervals, degrees, labelFr, aliases, minorLike };
}

export const SCALES = {
  major: scale([0, 2, 4, 5, 7, 9, 11], ["1", "2", "3", "4", "5", "6", "7"], "majeure", ["major", "majeure", "majeur", "maj", "ionian", "ionien"]),
  minor: scale([0, 2, 3, 5, 7, 8, 10], ["1", "2", "b3", "4", "5", "b6", "b7"], "mineure naturelle", ["minor", "natural minor", "mineure", "mineur", "mineure naturelle", "min", "aeolian", "eolien"], true),
  "harmonic minor": scale([0, 2, 3, 5, 7, 8, 11], ["1", "2", "b3", "4", "5", "b6", "7"], "mineure harmonique", ["harmonic minor", "minor harmonic", "mineure harmonique"], true),
  "melodic minor": scale([0, 2, 3, 5, 7, 9, 11], ["1", "2", "b3", "4", "5", "6", "7"], "mineure mélodique", ["melodic minor", "minor melodic", "mineure melodique"], true),
  "major pentatonic": scale([0, 2, 4, 7, 9], ["1", "2", "3", "5", "6"], "pentatonique majeure", ["major pentatonic", "pentatonic major", "pentatonique majeure", "majeure pentatonique", "penta majeure", "maj pent"]),
  "minor pentatonic": scale([0, 3, 5, 7, 10], ["1", "b3", "4", "5", "b7"], "pentatonique mineure", ["minor pentatonic", "pentatonic minor", "pentatonique mineure", "mineure pentatonique", "penta mineure", "min pent"], true),
  blues: scale([0, 3, 5, 6, 7, 10], ["1", "b3", "4", "b5", "5", "b7"], "blues", ["blues", "minor blues", "blues mineure", "blues mineur"], true),
  "major blues": scale([0, 2, 3, 4, 7, 9], ["1", "2", "b3", "3", "5", "6"], "blues majeure", ["major blues", "blues majeure", "blues majeur"]),
  dorian: scale([0, 2, 3, 5, 7, 9, 10], ["1", "2", "b3", "4", "5", "6", "b7"], "dorien", ["dorian", "dorien"], true),
  phrygian: scale([0, 1, 3, 5, 7, 8, 10], ["1", "b2", "b3", "4", "5", "b6", "b7"], "phrygien", ["phrygian", "phrygien"], true),
  lydian: scale([0, 2, 4, 6, 7, 9, 11], ["1", "2", "3", "#4", "5", "6", "7"], "lydien", ["lydian", "lydien"]),
  mixolydian: scale([0, 2, 4, 5, 7, 9, 10], ["1", "2", "3", "4", "5", "6", "b7"], "mixolydien", ["mixolydian", "mixolydien"]),
  locrian: scale([0, 1, 3, 5, 6, 8, 10], ["1", "b2", "b3", "4", "b5", "b6", "b7"], "locrien", ["locrian", "locrien"], true),
  chromatic: scale([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"], "chromatique", ["chromatic", "chromatique"]),
  "whole tone": scale([0, 2, 4, 6, 8, 10], ["1", "2", "3", "#4", "#5", "b7"], "par tons", ["whole tone", "wholetone", "tons entiers", "par tons"]),
};

const SCALE_ALIASES = new Map();
for (const [name, definition] of Object.entries(SCALES)) {
  for (const alias of definition.aliases) SCALE_ALIASES.set(stripAccents(alias.toLowerCase()), name);
}

export function scaleNames() {
  return Object.keys(SCALES);
}

export function resolveScaleName(text) {
  if (typeof text !== "string") return null;
  const key = stripAccents(text.trim().toLowerCase()).replace(/\s+/g, " ");
  return SCALE_ALIASES.get(key) ?? null;
}

export function buildScale(rootText, scaleText) {
  const root = parseNote(rootText ?? "");
  if (!root) throw new Error(`Note fondamentale inconnue « ${rootText} ».`);
  const name = resolveScaleName(scaleText ?? "");
  if (!name) {
    throw new Error(`Gamme inconnue « ${scaleText} ». Gammes acceptées : ${scaleNames().join(", ")}.`);
  }
  const definition = SCALES[name];
  const prefer = keyPreference(root, definition.minorLike ? "minor" : "major");
  const pcs = definition.intervals.map(interval => mod12(root.pc + interval));
  const notes = name === "chromatic"
    ? pcs.map(pc => noteName(pc, prefer))
    : pcs.map((pc, index) => spellDegree(root.letter, degreeNumberOf(definition.degrees[index]), pc, prefer));
  return {
    root: root.name,
    rootPc: root.pc,
    name,
    labelFr: definition.labelFr,
    prefer,
    intervals: [...definition.intervals],
    pcs,
    notes,
    degrees: [...definition.degrees],
  };
}

// ---------------------------------------------------------------------------
// Chords

export const CHORD_QUALITIES = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  5: [0, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  9: [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  mMaj7: [0, 3, 7, 11],
  11: [0, 4, 7, 10, 14, 17],
  13: [0, 4, 7, 10, 14, 21],
  "6/9": [0, 4, 7, 9, 14],
  "7b9": [0, 4, 7, 10, 13],
  "7#9": [0, 4, 7, 10, 15],
  "7b5": [0, 4, 6, 10],
  "7#5": [0, 4, 8, 10],
};

const QUALITY_ALIASES = {
  maj: "", M: "", major: "", majeur: "",
  min: "m", "-": "m", minor: "m", mineur: "m",
  "°": "dim", o: "dim", "°7": "dim7", o7: "dim7",
  "ø": "m7b5", "ø7": "m7b5", "m7(b5)": "m7b5", "min7b5": "m7b5", "-7b5": "m7b5",
  "+": "aug", "#5": "aug",
  M7: "maj7", "Δ": "maj7", "Δ7": "maj7", "maj7": "maj7", "major7": "maj7", "M9": "maj9",
  min7: "m7", "-7": "m7", minor7: "m7", min9: "m9", "-9": "m9",
  "mM7": "mMaj7", "mmaj7": "mMaj7", "m(maj7)": "mMaj7", "minmaj7": "mMaj7", "-Δ7": "mMaj7",
  sus: "sus4", "7sus": "7sus4", dom7: "7",
  "add2": "add9", "(add9)": "add9", "2": "add9",
};

const DEGREE_BY_INTERVAL = {
  0: "R", 1: "b2", 2: "2", 3: "b3", 4: "3", 5: "4", 6: "b5", 7: "5", 8: "#5", 9: "6", 10: "b7", 11: "7",
  13: "b9", 14: "9", 15: "#9", 17: "11", 18: "#11", 20: "b13", 21: "13",
};

const CHORD_PATTERN = /^([A-G])([#b♯♭]?)([^/\s]*)(?:\/([A-Ga-g][#b♯♭]?))?$/;

export function parseChord(text) {
  if (typeof text !== "string") return null;
  const match = CHORD_PATTERN.exec(text.trim());
  if (!match) return null;
  const root = parseNote(match[1] + normalizeAccidental(match[2]));
  const bass = match[4] ? parseNote(normalizeAccidental(match[4])) : null;
  if (!root || (match[4] && !bass)) return null;
  return {
    root: root.name,
    rootPc: root.pc,
    rootAccidental: root.accidental,
    suffix: match[3],
    bass: bass ? bass.name : null,
    bassPc: bass ? bass.pc : null,
    bassAccidental: bass ? bass.accidental : null,
  };
}

function normalizeQuality(suffix) {
  if (suffix in CHORD_QUALITIES) return suffix;
  if (suffix in QUALITY_ALIASES) return QUALITY_ALIASES[suffix];
  const lowered = suffix.toLowerCase();
  if (lowered in CHORD_QUALITIES) return lowered;
  if (lowered in QUALITY_ALIASES) return QUALITY_ALIASES[lowered];
  return null;
}

export function chordTones(text) {
  const chord = parseChord(text);
  if (!chord) return null;
  const quality = normalizeQuality(chord.suffix);
  if (quality === null) return null;
  const intervals = CHORD_QUALITIES[quality];
  const root = parseNote(chord.root);
  const prefer = keyPreference(root, quality.startsWith("m") || quality.startsWith("dim") ? "minor" : "major");
  const degrees = intervals.map(interval => DEGREE_BY_INTERVAL[interval] ?? String(interval));
  const pcs = intervals.map(interval => mod12(root.pc + interval));
  const notes = pcs.map((pc, index) => spellDegree(root.letter, degreeNumberOf(degrees[index] === "R" ? "1" : degrees[index]), pc, prefer));
  return { ...chord, quality, intervals: [...intervals], pcs, notes, degrees };
}

export function transposeChord(text, semitones, prefer = "auto") {
  const chord = parseChord(text);
  if (!chord) return text;
  const step = Number(semitones) || 0;
  if (step === 0 && prefer === "auto") return text;
  const rootSpelling = prefer === "auto" ? preferFromAccidental(chord.rootAccidental) : prefer;
  const root = noteName(chord.rootPc + step, rootSpelling);
  if (!chord.bass) return root + chord.suffix;
  const bassSpelling = prefer === "auto" ? preferFromAccidental(chord.bassAccidental) : prefer;
  return `${root}${chord.suffix}/${noteName(chord.bassPc + step, bassSpelling)}`;
}

const MAJOR_TRIADS = ["", "m", "m", "", "", "m", "dim"];
const MAJOR_SEVENTHS = ["maj7", "m7", "m7", "maj7", "7", "m7", "m7b5"];
const MAJOR_NUMERALS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const MINOR_TRIADS = ["m", "dim", "", "m", "m", "", ""];
const MINOR_SEVENTHS = ["m7", "m7b5", "maj7", "m7", "m7", "maj7", "7"];
const MINOR_NUMERALS = ["i", "ii°", "III", "iv", "v", "VI", "VII"];

export function diatonicChords(keyText, { sevenths = false } = {}) {
  const key = parseKey(keyText);
  if (!key) return null;
  const scaleNotes = buildScale(key.tonic, key.mode === "major" ? "major" : "minor");
  const triads = key.mode === "major" ? MAJOR_TRIADS : MINOR_TRIADS;
  const sevenths7 = key.mode === "major" ? MAJOR_SEVENTHS : MINOR_SEVENTHS;
  const numerals = key.mode === "major" ? MAJOR_NUMERALS : MINOR_NUMERALS;
  const chords = scaleNotes.notes.map((note, index) => {
    const pick = offset => scaleNotes.notes[(index + offset) % 7];
    const functionFr = key.mode === "minor" && index === 6 ? "Sous-tonique" : KEY_FUNCTIONS_FR[index];
    return {
      degree: index + 1,
      numeral: numerals[index],
      chord: `${note}${triads[index]}`,
      seventh: `${note}${sevenths7[index]}`,
      notes: sevenths ? [pick(0), pick(2), pick(4), pick(6)] : [pick(0), pick(2), pick(4)],
      functionFr,
    };
  });
  const harmonicDominant = key.mode === "minor" ? `${scaleNotes.notes[4]}7` : null;
  return { key, sevenths, chords, harmonicDominant };
}

const ROMAN_PATTERN = /^([b#♭♯]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(°|º|o|ø|\+|dim|aug)?(.*)$/;
const ROMAN_DEGREE = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

export function isRomanNumeral(text) {
  if (typeof text !== "string") return false;
  const match = ROMAN_PATTERN.exec(text.trim());
  if (!match) return false;
  return /^(?:maj|min|sus|add|M|Δ)?\d{0,2}(?:\([^)]*\))?$/i.test(match[4]);
}

export function romanToChord(numeralText, keyText) {
  const key = parseKey(keyText);
  if (!key || !isRomanNumeral(numeralText)) return null;
  const match = ROMAN_PATTERN.exec(numeralText.trim());
  const accidental = normalizeAccidental(match[1]);
  const numeral = match[2];
  const symbol = match[3] ?? "";
  const suffix = match[4] ?? "";
  const degree = ROMAN_DEGREE[numeral.toLowerCase()];
  const scaleNotes = buildScale(key.tonic, key.mode === "major" ? "major" : "minor");
  let root = scaleNotes.notes[degree - 1];
  if (accidental === "b") root = transposeNote(root, -1, "flat");
  if (accidental === "#") root = transposeNote(root, 1, "sharp");
  const isLower = numeral === numeral.toLowerCase();
  let quality;
  if (symbol === "°" || symbol === "º" || symbol === "o" || symbol === "dim") quality = "dim";
  else if (symbol === "ø") quality = "m7b5";
  else if (symbol === "+" || symbol === "aug") quality = "aug";
  else quality = isLower ? "m" : "";
  let name = root + quality + suffix;
  if (quality === "m7b5" && suffix === "7") name = `${root}m7b5`;
  return name;
}

// ---------------------------------------------------------------------------
// Circle of fifths

export function circleOfFifths() {
  return Array.from({ length: 12 }, (_, index) => {
    const majorPc = mod12(index * 7);
    const minorPc = mod12(majorPc - 3);
    const useFlats = index > 6;
    const both = index === 6;
    const sharps = index <= 6 ? index : 0;
    const flats = index >= 6 ? 12 - index : 0;
    return {
      index,
      majorPc,
      minorPc,
      major: both ? "F#/Gb" : noteName(majorPc, useFlats ? "flat" : "sharp"),
      minor: both ? "Ebm" : `${noteName(minorPc, useFlats ? "flat" : "sharp")}m`,
      sharps,
      flats,
    };
  });
}

export function circleIndexOfKey(keyText) {
  const key = parseKey(keyText);
  if (!key) return null;
  const majorPc = key.mode === "major" ? key.tonicPc : mod12(key.tonicPc + 3);
  return mod12(majorPc * 7);
}

// ---------------------------------------------------------------------------
// Tunings and fretboard geometry

function tuning(label, notes, aliases) {
  return { label, notes, aliases };
}

export const TUNINGS = {
  standard: tuning("Standard", ["E2", "A2", "D3", "G3", "B3", "E4"], ["standard", "std", "eadgbe", "e a d g b e", "normal"]),
  "drop d": tuning("Drop D", ["D2", "A2", "D3", "G3", "B3", "E4"], ["drop d", "dropd", "dadgbe"]),
  "drop c": tuning("Drop C", ["C2", "G2", "C3", "F3", "A3", "D4"], ["drop c", "dropc"]),
  dadgad: tuning("DADGAD", ["D2", "A2", "D3", "G3", "A3", "D4"], ["dadgad", "d a d g a d", "celtic"]),
  "open g": tuning("Open G", ["D2", "G2", "D3", "G3", "B3", "D4"], ["open g", "openg", "sol ouvert"]),
  "open d": tuning("Open D", ["D2", "A2", "D3", "F#3", "A3", "D4"], ["open d", "opend", "re ouvert"]),
  "open e": tuning("Open E", ["E2", "B2", "E3", "G#3", "B3", "E4"], ["open e", "opene", "mi ouvert"]),
  "eb standard": tuning("Eb standard", ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"], ["eb standard", "eb", "e flat", "half step down", "demi-ton", "demi ton", "mi bemol", "d# standard"]),
};

const TUNING_ALIASES = new Map();
for (const [name, definition] of Object.entries(TUNINGS)) {
  for (const alias of definition.aliases) TUNING_ALIASES.set(stripAccents(alias.toLowerCase()).replace(/\s+/g, " "), name);
}

function tuningFromNotes(name, label, noteNames) {
  const midi = noteNames.map(noteToMidi);
  return { name, label, notes: [...noteNames], midi };
}

export function parseTuning(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return tuningFromNotes("standard", TUNINGS.standard.label, TUNINGS.standard.notes);
  const aliasKey = stripAccents(raw.toLowerCase()).replace(/[()]/g, "").replace(/\s+/g, " ").trim();
  const named = TUNING_ALIASES.get(aliasKey);
  if (named) return tuningFromNotes(named, TUNINGS[named].label, TUNINGS[named].notes);

  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  if (tokens.length !== 6) return null;
  const parsed = tokens.map(parseNote);
  if (parsed.some(note => !note)) return null;
  const notes = [];
  let previous = null;
  for (const note of parsed) {
    let midi;
    if (note.midi !== null) midi = note.midi;
    else if (previous === null) midi = 36 + note.pc;
    else {
      midi = previous + 1;
      while (mod12(midi) !== note.pc) midi += 1;
    }
    previous = midi;
    notes.push(midiToNoteName(midi, preferFromAccidental(note.accidental)));
  }
  const label = parsed.map(note => note.name).join(" ");
  return tuningFromNotes(null, label, notes);
}

// Natural harmonic nodes: the fret touched and the interval above the open
// string that rings. Unknown positions fall back to the octave.
const HARMONIC_INTERVALS = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28, 3: 31 };

export function harmonicSemitones(fret) {
  return HARMONIC_INTERVALS[Number(fret)] ?? 12;
}

export function stringMidi(tuningObject, stringNumber, fret, capo = 0) {
  return tuningObject.midi[6 - stringNumber] + Number(fret) + capo;
}

export function fretsForPitchClasses(tuningObject, pcs, [fretMin, fretMax]) {
  const wanted = new Set(pcs.map(mod12));
  const result = [];
  for (let string = 1; string <= 6; string += 1) {
    for (let fret = fretMin; fret <= fretMax; fret += 1) {
      const pc = mod12(stringMidi(tuningObject, string, fret));
      if (wanted.has(pc)) result.push({ string, fret, pc });
    }
  }
  return result;
}

// "Position k" = the 5-fret window that starts on the k-th scale tone found on
// the low E string (k = 1 is the lowest root). Windows that would start past
// the 12th fret wrap down an octave so every position stays playable.
export function scalePosition(tuningObject, scaleObject, position) {
  const count = scaleObject.pcs.length;
  const index = Number(position);
  if (!Number.isInteger(index) || index < 1 || index > count) return null;
  const rootPc = scaleObject.rootPc;
  const lowString = fretsForPitchClasses(tuningObject, scaleObject.pcs, [0, 24]).filter(note => note.string === 6);
  const rootFret = lowString.find(note => note.pc === rootPc)?.fret ?? 0;
  const fromRoot = lowString.filter(note => note.fret >= rootFret);
  const anchor = fromRoot[index - 1];
  if (!anchor) return null;
  let start = anchor.fret;
  if (start > 12) start -= 12;
  return [start, start + 4];
}

// Preferred accidental spelling for a key given only its pitch class — used
// when a document is transposed and the written key no longer applies.
export function keySpellingForPc(pc, mode = "major") {
  const majorPc = mode === "minor" ? mod12(pc + 3) : mod12(pc);
  return [5, 10, 3, 8, 1].includes(majorPc) ? "flat" : "sharp";
}
