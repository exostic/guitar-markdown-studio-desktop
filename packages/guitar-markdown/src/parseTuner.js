import { midiToFrequency, parseTuning } from "./theory.js";

// ```tuner``` block: an optional `tuning:` line, otherwise inherits the
// document tuning (front matter) and falls back to standard.
export function parseTuner(source, options = {}) {
  let tuningObject = options.defaultTuning ?? parseTuning("");
  const lines = (source ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^tuning\s*:\s*(.+)$/i);
    if (!match) throw new Error(`Ligne de tuner invalide : « ${line} »`);
    const parsed = parseTuning(match[1]);
    if (!parsed) throw new Error(`Accordage inconnu « ${match[1].trim()} ».`);
    tuningObject = parsed;
  }
  const strings = tuningObject.midi.map((midi, index) => ({
    number: 6 - index,
    note: tuningObject.notes[index],
    midi,
    frequency: Math.round(midiToFrequency(midi) * 100) / 100,
  }));
  return { type: "tuner", tuning: tuningObject, strings };
}
