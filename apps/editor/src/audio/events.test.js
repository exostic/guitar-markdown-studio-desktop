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

test("tabToEvents : hammer, pull et tap jouent l'arrivée en legato", () => {
  const ast = parseAsciiTab(`e|--5h7--8p7--5t12--|
B|------------------|
G|------------------|
D|------------------|
A|------------------|
E|------------------|`);
  const plucks = tabToEvents(ast, { tuning }).events.filter(e => e.kind === "pluck");
  assert.deepEqual(
    plucks.map(p => [p.midi, p.velocity, Boolean(p.legato)]),
    [[69, 1, false], [71, 0.6, true], [72, 1, false], [71, 0.6, true], [69, 1, false], [76, 0.6, true]],
  );
  assert.ok(plucks.every(p => !p.glides));
});

test("tabToEvents : slides et bends glissent la note de départ sans repincer", () => {
  const ast = parseAsciiTab(`e|5/7/9---8b10----|
B|----------------|
G|----------------|
D|----------------|
A|----------------|
E|----------------|`);
  const plucks = tabToEvents(ast, { tuning }).events.filter(e => e.kind === "pluck");
  assert.deepEqual(plucks.map(p => p.midi), [69, 72]);
  const [slide, bend] = plucks;
  assert.deepEqual(slide.glides.map(g => g.midi), [71, 73]);
  assert.ok(slide.glides[0].beat > 0 && slide.glides[1].beat > slide.glides[0].beat);
  assert.ok(slide.glides.every(g => g.span > 0 && g.span <= 0.2));
  // The chain head rings until the last slide target would have ended.
  assert.ok(slide.duration > slide.glides[1].beat);
  assert.deepEqual(bend.glides.map(g => g.midi), [74]);
  assert.ok(bend.glides[0].span > 0.2);
  assert.ok(bend.duration > bend.glides[0].beat);
});

test("tabToEvents : bends sans cible, bend-release et release vers une note", () => {
  const ast = parseAsciiTab(`e|8b----8br----8b10r8----8b---r8--|
B|--------------------------------|
G|--------------------------------|
D|--------------------------------|
A|--------------------------------|
E|--------------------------------|`);
  const plucks = tabToEvents(ast, { tuning }).events.filter(e => e.kind === "pluck");
  assert.deepEqual(plucks.map(p => p.midi), [72, 72, 72, 72]);
  const [full, bendRelease, written, implied] = plucks;
  assert.deepEqual(full.glides.map(g => g.midi), [74]);
  assert.deepEqual(bendRelease.glides.map(g => g.midi), [74, 72]);
  assert.ok(bendRelease.glides[1].beat > bendRelease.glides[0].beat);
  assert.deepEqual(written.glides.map(g => g.midi), [74, 72]);
  // `8b---r8`: the release link absorbs the second 8; the bend itself has no
  // written target so only the way back down is a glide.
  assert.deepEqual(implied.glides.map(g => g.midi), [72]);
});

test("tabToEvents : vibrato, notes fantômes et harmoniques", () => {
  const ast = parseAsciiTab(`e|--7~~~--5---(5)~~-<12>--<7>-|
B|----------------------------|
G|----------------------------|
D|----------------------------|
A|----------------------------|
E|----------------------------|`);
  const plucks = tabToEvents(ast, { tuning, capo: 2 }).events.filter(e => e.kind === "pluck");
  assert.deepEqual(
    plucks.map(p => [p.midi, p.velocity, p.vibratoAt ?? null, Boolean(p.harmonic)]),
    [[73, 1, 0, false], [71, 1, null, false], [71, 0.45, 0, false], [76, 1, null, true], [83, 1, null, true]],
  );
});

test("tabToEvents : le vibrato à l'arrivée d'un slide démarre au moment du glissé", () => {
  const ast = parseAsciiTab(`e|5/7~~---|
B|--------|
G|--------|
D|--------|
A|--------|
E|--------|`);
  const [pluck] = tabToEvents(ast, { tuning }).events.filter(e => e.kind === "pluck");
  assert.equal(pluck.vibratoAt, pluck.glides[0].beat);
  assert.ok(pluck.vibratoAt > 0);
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

test("tabToEvents : un accord s'égrène corde grave d'abord, chaque note connaît sa corde", () => {
  const ast = parseAsciiTab(`e|0-------|
B|1-------|
G|0-------|
D|2-------|
A|3-------|
E|--------|`);
  const plucks = tabToEvents(ast, { tuning }).events.filter(e => e.kind === "pluck");
  assert.deepEqual(plucks.map(p => p.string), [5, 4, 3, 2, 1]);
  assert.deepEqual(plucks.map(p => Math.round((p.offset ?? 0) * 1000)), [0, 12, 24, 36, 48]);
  assert.ok(plucks.every(p => p.beat === 0));
  const single = tabToEvents(parseAsciiTab(`e|--3--|
B|-----|
G|-----|
D|-----|
A|-----|
E|-----|`), { tuning }).events.filter(e => e.kind === "pluck");
  assert.equal(single[0].offset, undefined);
});

test("tabToEvents : les glissés portent leur type pour le bruit de doigt", () => {
  const ast = parseAsciiTab(`e|5/7--9b--7br--|
B|--------------|
G|--------------|
D|--------------|
A|--------------|
E|--------------|`);
  const plucks = tabToEvents(ast, { tuning }).events.filter(e => e.kind === "pluck");
  assert.deepEqual(plucks[0].glides.map(g => g.type), ["slide-up"]);
  assert.deepEqual(plucks[1].glides.map(g => g.type), ["bend"]);
  assert.deepEqual(plucks[2].glides.map(g => g.type), ["bend", "release"]);
  assert.deepEqual(shapeToEvents(["x", 3, 2, 0, 1, 0], { tuning }).map(e => e.string), [5, 4, 3, 2, 1]);
});
