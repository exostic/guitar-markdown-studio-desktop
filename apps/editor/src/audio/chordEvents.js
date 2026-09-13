import { chordTones, isRomanNumeral, romanToChord, stringMidi, transposeChord } from "@gms/guitar-markdown";

const STRUM_SPREAD_BEATS = 0.04;

// One chord shape (frets[0] = low E string) strummed low to high.
export function shapeToEvents(frets, { tuning, capo = 0, beat = 0, duration = 2, velocity = 1, direction = "down" } = {}) {
  const events = [];
  const played = frets.map((fret, index) => ({ fret, string: 6 - index })).filter(entry => entry.fret !== "x");
  const ordered = direction === "down" ? played : [...played].reverse();
  ordered.forEach((entry, order) => {
    const midi = stringMidi(tuning, entry.string, Number(entry.fret), capo);
    events.push({ beat: beat + order * STRUM_SPREAD_BEATS, kind: "pluck", midi, string: entry.string, duration, velocity });
  });
  return events;
}

export function chordsBlockToEvents(chords, { tuning, capo = 0, measureBeats = 4 } = {}) {
  const events = [];
  chords.forEach((chord, index) => {
    const beat = index * measureBeats;
    events.push({ beat, kind: "cue", cue: { item: index } });
    events.push(...shapeToEvents(chord.frets, { tuning, capo, beat, duration: measureBeats }));
  });
  return { events, totalBeats: chords.length * measureBeats };
}

// A close voicing for a chord name: root near A2 (MIDI 45), the other chord
// tones stacked above it, then the root (and third) doubled an octave up so a
// strum has up to six voices like a real open chord.
export function autoVoicing(name) {
  const tones = chordTones(name);
  if (!tones) return null;
  const candidates = [36 + tones.rootPc, 48 + tones.rootPc];
  const rootMidi = candidates.reduce((best, midi) => (Math.abs(midi - 45) < Math.abs(best - 45) ? midi : best));
  const voicing = [rootMidi];
  for (const interval of tones.intervals.slice(1)) voicing.push(rootMidi + (interval % 12));
  if (voicing.length < 5) voicing.push(rootMidi + 12);
  if (voicing.length < 6 && tones.intervals[1] !== undefined) voicing.push(rootMidi + 12 + (tones.intervals[1] % 12));
  return voicing.sort((a, b) => a - b);
}

function voicingEvents(voicing, { beat, duration, velocity }) {
  return voicing.map((midi, order) => ({ beat: beat + order * STRUM_SPREAD_BEATS, kind: "pluck", midi, duration, velocity }));
}

function expandRows(rows) {
  const expanded = [];
  rows.forEach((row, rowIndex) => {
    const repeats = row.repeatCount ? Math.max(1, Number(row.repeatCount)) : row.repeat ? 2 : 1;
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      row.cells.forEach((cell, cellIndex) => expanded.push({ cell, rowIndex, cellIndex }));
    }
  });
  return expanded;
}

export function resolveGridChord(cellText, { key = null, semitones = 0, prefer = "auto" } = {}) {
  const text = cellText.trim();
  if (key && isRomanNumeral(text)) return romanToChord(text, key);
  return semitones ? transposeChord(text, semitones, prefer) : text;
}

export function gridToEvents(grid, { measureBeats = 4, key = null, semitones = 0, prefer = "auto", capo = 0 } = {}) {
  const events = [];
  let beat = 0;
  for (const { cell, rowIndex, cellIndex } of expandRows(grid.rows)) {
    events.push({ beat, kind: "cue", cue: { row: rowIndex, cell: cellIndex } });
    const halves = cell.includes("/") ? cell.split("/").slice(0, 2) : [cell];
    const slot = measureBeats / halves.length;
    halves.forEach((half, halfIndex) => {
      const start = beat + halfIndex * slot;
      const voicing = autoVoicing(resolveGridChord(half, { key, semitones, prefer }))?.map(midi => midi + capo);
      if (!voicing) {
        events.push({ beat: start, kind: "click", accent: halfIndex === 0 });
        return;
      }
      events.push(...voicingEvents(voicing, { beat: start, duration: slot, velocity: 1 }));
      if (halves.length === 1 && measureBeats >= 2) {
        events.push(...voicingEvents(voicing, { beat: start + slot / 2, duration: slot / 2, velocity: 0.55 }));
      }
    });
    beat += measureBeats;
  }
  return { events, totalBeats: beat };
}
