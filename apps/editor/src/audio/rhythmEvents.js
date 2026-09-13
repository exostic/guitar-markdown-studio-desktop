// Strum pattern → one beat per group, strokes evenly spread inside the beat,
// a metronome click on every beat (accented on the first), looped.
export function rhythmToEvents(pattern) {
  const events = [];
  pattern.groups.forEach((group, groupIndex) => {
    events.push({ beat: groupIndex, kind: "click", accent: groupIndex === 0 });
    group.forEach((stroke, strokeIndex) => {
      const beat = groupIndex + strokeIndex / group.length;
      events.push({ beat, kind: "cue", cue: { group: groupIndex, stroke: strokeIndex } });
      if (!stroke.rest) events.push({ beat, kind: "strum", direction: stroke.direction, ghost: stroke.ghost });
    });
  });
  return { events, totalBeats: pattern.groups.length };
}
