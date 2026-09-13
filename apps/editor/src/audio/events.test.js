import test from "node:test";
import assert from "node:assert/strict";
import { parseAsciiTab, parseChordBlock, parseChordGrid, parseRhythmPattern, parseTuning } from "@gms/guitar-markdown";
import { tabToEvents, measureBeatsFor } from "./tabEvents.js";
import { autoVoicing, chordsBlockToEvents, gridToEvents, resolveGridChord, shapeToEvents } from "./chordEvents.js";
import { rhythmToEvents } from "./rhythmEvents.js";

const tuning = parseTuning("");

test("tabToEvents : onsets par colonne, hauteur par accordage + capo", () => {
  const ast = parseAsciiTab(`e|--0-------|--x---|
B|------1---|------|
G|----------|------|
D|----------|------|
A|----------|------|
E|0---------|------|`);
  const { events, totalBeats } = tabToEvents(ast, { tuning, capo: 2 });
  assert.equal(totalBeats, 8);
  const plucks = events.filter(e => e.kind === "pluck");
  assert.deepEqual(plucks.map(p => p.midi), [42, 66, 62]);
  assert.equal(plucks[0].beat, 0);
  assert.ok(plucks[1].beat > 0 && plucks[1].beat < 4);
  assert.equal(events.filter(e => e.kind === "mute").length, 1);
  assert.deepEqual(events.filter(e => e.kind === "cue").map(e => e.cue.measure), [0, 1]);
  assert.equal(measureBeatsFor("6/8"), 3);
});

test("tabToEvents : hammer et bend adoucissent la note d'arrivée", () => {
  const ast = parseAsciiTab(`e|--5h7--8b10--|
B|-----------|
G|-----------|
D|-----------|
A|-----------|
E|-----------|`);
  const plucks = tabToEvents(ast, { tuning }).events.filter(e => e.kind === "pluck");
  assert.deepEqual(plucks.map(p => [p.midi, p.velocity]), [[69, 1], [71, 0.6], [72, 1], [74, 0.6]]);
});

test("shapeToEvents ignore les cordes étouffées et étale le balayage", () => {
  const events = shapeToEvents(["x", 0, 2, 2, 1, 0], { tuning });
  assert.deepEqual(events.map(e => e.midi), [45, 52, 57, 60, 64]);
  assert.ok(events[4].beat > events[0].beat);
  const block = chordsBlockToEvents(parseChordBlock("Am x02210\nC x32010"), { tuning, measureBeats: 4 });
  assert.equal(block.totalBeats, 8);
  assert.deepEqual(block.events.filter(e => e.kind === "cue").map(e => e.cue.item), [0, 1]);
});

test("autoVoicing construit une voix proche de la basse", () => {
  assert.deepEqual(autoVoicing("Am"), [45, 48, 52, 57, 60]);
  assert.deepEqual(autoVoicing("G"), [43, 47, 50, 55, 59]);
  assert.equal(autoVoicing("N.C."), null);
});

test("gridToEvents : reprises, cellules coupées, chiffres romains et transposition", () => {
  const grid = parseChordGrid("key: G\n||: I | V/vi :|| x2\n| N.C. |");
  const { events, totalBeats } = gridToEvents(grid, { measureBeats: 4, key: grid.key });
  assert.equal(totalBeats, 20);
  const cues = events.filter(e => e.kind === "cue").map(e => `${e.cue.row}-${e.cue.cell}`);
  assert.deepEqual(cues, ["0-0", "0-1", "0-0", "0-1", "1-0"]);
  assert.equal(events.filter(e => e.kind === "click").length, 1);
  assert.equal(resolveGridChord("vi", { key: "G" }), "Em");
  assert.equal(resolveGridChord("Em", { semitones: 2 }), "F#m");
});

test("rhythmToEvents : un clic par temps, frappes réparties, silences muets", () => {
  const { events, totalBeats } = rhythmToEvents(parseRhythmPattern("B H | b - | H"));
  assert.equal(totalBeats, 3);
  assert.equal(events.filter(e => e.kind === "click").length, 3);
  const strums = events.filter(e => e.kind === "strum");
  assert.deepEqual(strums.map(s => [s.beat, s.direction, s.ghost]), [[0, "down", false], [0.5, "up", false], [1, "down", true], [2, "up", false]]);
});
