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
  assert.deepEqual(frets[12], { string: 1, fret: "5", ghost: true, column: 44, length: 3 });
  assert.deepEqual(frets[13], { string: 1, fret: "12", harmonic: true, column: 48, length: 4 });
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

test("plusieurs groupes de 6 lignes dans un bloc = mesures qui se suivent", () => {
  const ast = parseAsciiTab(`  C    G
e|0---|3---|
B|1---|0---|
G|0---|0---|
D|2---|0---|
A|3---|2---|
E|----|3---|

  Am
e|0---|
B|1---|
G|2---|
D|2---|
A|0---|
E|----|`);
  assert.equal(ast.measures.length, 3);
  assert.deepEqual(ast.measures.map(m => m.index), [0, 1, 2]);
  assert.deepEqual(ast.measures.map(m => m.chord), ["C", "G", "Am"]);
  assert.deepEqual(ast.measures[2].events[0].positions.map(p => `${p.string}:${p.fret}`), ["1:0", "2:1", "3:2", "4:2", "5:0"]);
  assert.throws(() => parseAsciiTab(`e|0---|\nB|1---|\nG|0---|\nD|2---|\nA|3---|\nE|----|\ne|0---|\nB|1---|`), /6 cordes/);
});

test("chaque mesure et chaque note connaissent leur place dans la source", () => {
  const source = `sound: clean

  C    G
e|0---|3---|
B|1---|0---|
G|0---|0---|
D|2---|0---|
A|3---|2---|
E|----|3---|

e|--12-|
B|-----|
G|-----|
D|-----|
A|-----|
E|-----|`;
  const ast = parseAsciiTab(source);
  const lines = source.split("\n");
  assert.deepEqual(ast.measures[1].sources[1], { line: 3, column: 7 }, "2e mesure sur la ligne e| : après « e|0---| »");
  assert.deepEqual(ast.measures[1].sources[6], { line: 8, column: 7 });
  assert.deepEqual(ast.measures[2].sources[1], { line: 10, column: 2 });
  const note = ast.measures[2].events[0].positions[0];
  assert.deepEqual([note.column, note.length], [2, 2]);
  const at = ast.measures[2].sources[note.string];
  assert.equal(lines[at.line].slice(at.column + note.column, at.column + note.column + note.length), "12");
});
