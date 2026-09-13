// Turns a parsed tablature AST into scheduler events. Onsets follow the ASCII
// column positions (event.offset), which is what the reader sees; a note
// rings until the next event on the same measure, four beats at most.
//
// Techniques become audio hints on the pluck events:
//   - slides, bends with a written target and releases keep the first note
//     ringing and glide its pitch (`glides`), so the arrival is not plucked
//     again — chains such as 5/7/9 or 8b10r8 become one voice;
//   - a bend with no target (`8b--`) rises a whole step, `8br` rises and
//     falls back, both as glides on the note itself;
//   - hammer-ons, pull-offs and taps pluck the arrival softly without a pick
//     attack (`legato`);
//   - vibrato wobbles its note (`vibratoAt`, in beats after the voice starts);
//   - ghost notes `(8)` play quietly, harmonics `<12>` ring as a chime.
import { harmonicSemitones, stringMidi } from "@gms/guitar-markdown";

const PITCH_TECHNIQUES = new Set(["slide-up", "slide-down", "bend", "release"]);
const LEGATO_TECHNIQUES = new Set(["hammer", "pull", "tap"]);
const MAX_RING_BEATS = 4;
const GHOST_VELOCITY = 0.45;
const BEND_SEMITONES = 2;

export function parseTimeSignature(timeSignature) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(timeSignature ?? "4/4");
  if (!match) return { beatsPerMeasure: 4, beatUnit: 4 };
  return { beatsPerMeasure: Number(match[1]), beatUnit: Number(match[2]) };
}

export function measureBeatsFor(timeSignature) {
  const { beatsPerMeasure, beatUnit } = parseTimeSignature(timeSignature);
  return (beatsPerMeasure * 4) / beatUnit;
}

function techniqueKey(eventIndex, string) {
  return `${eventIndex}:${string}`;
}

// A slide reaches the next fret in a quick hop just before it sounds; a bend
// pulls the string up over most of the gap so the rise is audible, and a
// release lets it back down a little slower than a slide.
function glideSpan(type, gapBeats) {
  if (type === "bend") return gapBeats * 0.75;
  if (type === "release") return Math.min(gapBeats * 0.5, 0.3);
  return Math.min(gapBeats * 0.5, 0.2);
}

function fretMidi(position, tuning, capo) {
  if (position.harmonic) return stringMidi(tuning, position.string, harmonicSemitones(position.fret), 0);
  return stringMidi(tuning, position.string, Number(position.fret), capo);
}

// Bends written on the note itself: up a whole step early in the note, and
// for `br` back down before the note ends.
function ornamentGlides(types, midi, ringBeats) {
  const glides = [];
  const up = Math.min(0.5, ringBeats * 0.4);
  if (types.has("bend") || types.has("bend-release")) {
    glides.push({ midi: midi + BEND_SEMITONES, beat: up, span: up });
  }
  if (types.has("bend-release")) {
    const down = Math.min(ringBeats * 0.85, up + 0.6);
    glides.push({ midi, beat: down, span: Math.max(0.05, (down - up) * 0.6) });
  }
  return glides;
}

export function tabToEvents(ast, { tuning, capo = 0, timeSignature } = {}) {
  const measureBeats = measureBeatsFor(timeSignature ?? ast.timeSignature);
  const events = [];
  ast.measures.forEach(measure => {
    const base = measure.index * measureBeats;
    events.push({ beat: base, kind: "cue", cue: { measure: measure.index } });
    const incoming = new Map();
    const outgoing = new Map();
    const ornaments = new Map();
    for (const technique of measure.techniques) {
      incoming.set(techniqueKey(technique.toEvent, technique.string), technique);
      outgoing.set(techniqueKey(technique.fromEvent, technique.string), technique);
    }
    for (const ornament of measure.ornaments ?? []) {
      const key = techniqueKey(ornament.event, ornament.string);
      if (!ornaments.has(key)) ornaments.set(key, new Set());
      ornaments.get(key).add(ornament.type);
    }
    const ornamentsAt = (eventIndex, string) => ornaments.get(techniqueKey(eventIndex, string)) ?? new Set();
    const endOffsetOf = eventIndex => measure.events[eventIndex + 1]?.offset ?? 1;

    measure.events.forEach((event, eventIndex) => {
      const onset = base + event.offset * measureBeats;
      let muted = false;
      for (const position of event.positions) {
        if (position.fret === "x") {
          muted = true;
          continue;
        }
        const arrival = incoming.get(techniqueKey(eventIndex, position.string));
        // The head of a slide/bend/release chain plays this note through its glide.
        if (arrival && PITCH_TECHNIQUES.has(arrival.type)) continue;
        const legato = Boolean(arrival && LEGATO_TECHNIQUES.has(arrival.type));
        const midi = fretMidi(position, tuning, capo);

        // Follow pitch links forward on this string: each link adds a glide
        // and the voice rings until the last link would have ended.
        const glides = [];
        let vibratoAt = ornamentsAt(eventIndex, position.string).has("vibrato") ? 0 : null;
        let lastIndex = eventIndex;
        let lastOffset = event.offset;
        let link = outgoing.get(techniqueKey(eventIndex, position.string));
        while (link && PITCH_TECHNIQUES.has(link.type)) {
          const target = measure.events[link.toEvent];
          const targetPosition = target?.positions.find(p => p.string === position.string);
          if (!targetPosition || targetPosition.fret === "x") break;
          const gapBeats = (target.offset - lastOffset) * measureBeats;
          const arriveBeat = (target.offset - event.offset) * measureBeats;
          glides.push({ midi: fretMidi(targetPosition, tuning, capo), beat: arriveBeat, span: glideSpan(link.type, gapBeats) });
          if (vibratoAt === null && ornamentsAt(link.toEvent, position.string).has("vibrato")) vibratoAt = arriveBeat;
          lastIndex = link.toEvent;
          lastOffset = target.offset;
          link = outgoing.get(techniqueKey(lastIndex, position.string));
        }

        const ring = Math.min(MAX_RING_BEATS, Math.max(0.1, (endOffsetOf(lastIndex) - event.offset) * measureBeats));
        if (!glides.length) {
          glides.push(...ornamentGlides(ornamentsAt(eventIndex, position.string), midi, ring));
        }
        const velocity = position.ghost ? GHOST_VELOCITY : legato ? 0.6 : 1;
        const pluck = { beat: onset, kind: "pluck", midi, duration: ring, velocity };
        if (legato) pluck.legato = true;
        if (position.harmonic) pluck.harmonic = true;
        if (vibratoAt !== null) pluck.vibratoAt = vibratoAt;
        if (glides.length) pluck.glides = glides;
        events.push(pluck);
      }
      if (muted) events.push({ beat: onset, kind: "mute" });
    });
  });
  return { events, totalBeats: ast.measures.length * measureBeats };
}
