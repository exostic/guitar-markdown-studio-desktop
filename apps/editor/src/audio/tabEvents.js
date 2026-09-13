// Turns a parsed tablature AST into scheduler events. Onsets follow the ASCII
// column positions (event.offset), which is what the reader sees; a note
// rings until the next event on the same measure, four beats at most.
import { stringMidi } from "@gms/guitar-markdown";

export function parseTimeSignature(timeSignature) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(timeSignature ?? "4/4");
  if (!match) return { beatsPerMeasure: 4, beatUnit: 4 };
  return { beatsPerMeasure: Number(match[1]), beatUnit: Number(match[2]) };
}

export function measureBeatsFor(timeSignature) {
  const { beatsPerMeasure, beatUnit } = parseTimeSignature(timeSignature);
  return (beatsPerMeasure * 4) / beatUnit;
}

export function tabToEvents(ast, { tuning, capo = 0, timeSignature } = {}) {
  const measureBeats = measureBeatsFor(timeSignature ?? ast.timeSignature);
  const events = [];
  ast.measures.forEach(measure => {
    const base = measure.index * measureBeats;
    events.push({ beat: base, kind: "cue", cue: { measure: measure.index } });
    measure.events.forEach((event, eventIndex) => {
      const onset = base + event.offset * measureBeats;
      const nextOffset = measure.events[eventIndex + 1]?.offset ?? 1;
      const ring = Math.min(4, Math.max(0.1, (nextOffset - event.offset) * measureBeats));
      // Hammer-ons, pull-offs and bends all reach their arrival note without a
      // fresh pick: play it at its own fret, only softer.
      const softened = new Set(
        measure.techniques.filter(t => t.toEvent === eventIndex && ["hammer", "pull", "bend"].includes(t.type)).map(t => t.string),
      );
      let muted = false;
      for (const position of event.positions) {
        if (position.fret === "x") {
          muted = true;
          continue;
        }
        const midi = stringMidi(tuning, position.string, Number(position.fret), capo);
        events.push({ beat: onset, kind: "pluck", midi, duration: ring, velocity: softened.has(position.string) ? 0.6 : 1 });
      }
      if (muted) events.push({ beat: onset, kind: "mute" });
    });
  });
  return { events, totalBeats: ast.measures.length * measureBeats };
}
