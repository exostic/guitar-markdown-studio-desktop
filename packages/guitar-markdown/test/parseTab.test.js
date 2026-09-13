import test from "node:test";
import assert from "node:assert/strict";
import { parseAsciiTab } from "../src/index.js";

test("parse une tablature ASCII en mesures et événements", () => {
  const ast = parseAsciiTab(`   Em        D
e|--0--2--|--2-----|
B|--0-----|--3-----|
G|--0-----|--2-----|
D|--2-----|--0-----|
A|--2-----|--------|
E|--0-----|--------|`);
  assert.equal(ast.measures.length, 2);
  assert.equal(ast.measures[0].events[0].positions.length, 6);
  assert.equal(ast.measures[1].events[0].positions.length, 4);
});

test("détecte hammer-on et pull-off", () => {
  const ast = parseAsciiTab(`e|--5h7p5--|
B|----------|
G|----------|
D|----------|
A|----------|
E|----------|`);
  assert.deepEqual(ast.measures[0].techniques.map(t => t.type), ["hammer", "pull"]);
});

test("détecte tap, bends, releases, vibrato et notes spéciales", () => {
  const ast = parseAsciiTab(`e|-5t7-8b10r8-8b---r8-8br--13b(hold)-8h10-7~~-(5)-<12>-|
B|-------------------------------------------------------|
G|-------------------------------------------------------|
D|-------------------------------------------------------|
A|-------------------------------------------------------|
E|-------------------------------------------------------|`);
  const measure = ast.measures[0];
  assert.deepEqual(
    measure.techniques.map(t => [t.type, t.fromEvent, t.toEvent]),
    [["tap", 0, 1], ["bend", 2, 3], ["release", 3, 4], ["release", 5, 6], ["hammer", 9, 10]],
  );
  assert.deepEqual(
    measure.ornaments.map(o => [o.type, o.event]),
    [["bend", 5], ["bend-release", 7], ["bend", 8], ["vibrato", 11]],
  );
  const frets = measure.events.map(event => event.positions[0]);
  assert.deepEqual(frets[12], { string: 1, fret: "5", ghost: true });
  assert.deepEqual(frets[13], { string: 1, fret: "12", harmonic: true });
});

test("le vibrato en fin de mesure est conservé", () => {
  const ast = parseAsciiTab(`e|--7~~~~|
B|-------|
G|-------|
D|-------|
A|-------|
E|-------|`);
  assert.deepEqual(ast.measures[0].ornaments, [{ type: "vibrato", string: 1, event: 0 }]);
});
