import test from "node:test";
import assert from "node:assert/strict";
import * as alphaTab from "@coderline/alphatab";
import { parseAsciiTab, parseTuning, toAlphaTex, translateTab } from "../src/index.js";

// Round-trips through alphaTab's own parser: the generated text must be
// valid alphaTex, and the score it builds is what the assertions inspect.
function score(tex) {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  try {
    return importer.readScore();
  } catch (error) {
    const cause = error.cause ?? error;
    const messages = [...(cause.lexerDiagnostics ?? []), ...(cause.parserDiagnostics ?? []), ...(cause.semanticDiagnostics ?? [])].map(d => d.message);
    throw new Error(`alphaTex invalide : ${messages.join(" ; ")}\n${tex}`);
  }
}

function tab(lines, options = {}) {
  return parseAsciiTab(lines, { timeSignature: options.timeSignature ?? "4/4" });
}

// Compact description of one bar: "fret/string[effects]:duration" per beat.
function describe(bar) {
  return bar.voices[0].beats.map(beat => {
    const notes = beat.notes.map(note => {
      const string = note.beat.voice.bar.staff.tuning.length - note.string + 1;
      let text = note.isDead ? `x/${string}` : `${note.isTieDestination ? "~" : ""}${note.fret}/${string}`;
      if (note.isHammerPullOrigin) text += "h";
      if (note.slideOutType) text += "s";
      if (note.vibrato) text += "v";
      if (note.hasBend) text += `b${note.bendPoints.map(p => p.value).join(",")}`;
      if (note.isGhost) text += "g";
      if (note.harmonicType) text += "H";
      return text;
    });
    const duration = `${beat.duration}${beat.dots ? ".".repeat(beat.dots) : ""}${beat.tupletNumerator > 1 ? `t${beat.tupletNumerator}` : ""}${beat.tap ? "T" : ""}`;
    return `${notes.length ? (notes.length > 1 ? `(${notes.join(" ")})` : notes[0]) : "r"}:${duration}`;
  }).join(" ");
}

test("toAlphaTex : en-tête, mesure, accordage et capo", () => {
  const ast = tab(`e|3--5--7--8--|
B|------------|
G|------------|
D|------------|
A|------------|
E|------------|`);
  const tex = toAlphaTex(ast, { tempo: 92, tuning: parseTuning("drop d"), capo: 2, sound: "distortion" });
  assert.match(tex, /^\\tempo 92\n\\hidedynamics\n\\tuning e4 b3 g3 d3 a2 d2\n\\capo 2\n\\instrument 30\n\\track "Guitare"\n\\staff \{score\}\n\.\n\\ts 4 4 /);
  const staff = score(tex).tracks[0].staves[0];
  assert.deepEqual(staff.tuning, [64, 59, 55, 50, 45, 38]);
  assert.equal(staff.capo, 2);
  assert.equal(describe(staff.bars[0]), "3/1:4 5/1:4 7/1:4 8/1:4");
});

test("toAlphaTex : grille par mesure, silence de départ, accords et notes liées", () => {
  const ast = tab(`e|-3--5--7--8-|----0---|3-------|
B|------------|----1---|--------|
G|------------|----0---|--------|
D|------------|--------|5-------|
A|------------|--------|--------|
E|------------|--------|--------|`);
  const staff = score(toAlphaTex(ast)).tracks[0].staves[0];
  assert.equal(staff.bars.length, 3);
  assert.equal(describe(staff.bars[0]), "3/1:4 5/1:4 7/1:4 8/1:4", "un tiret devant la première note ne décale pas la grille");
  assert.equal(describe(staff.bars[1]), "r:2 (0/1 1/2 0/3):2");
  assert.equal(describe(staff.bars[2]), "(3/1 5/4):1");
});

test("toAlphaTex : croches, doubles, pointés et triolets", () => {
  const ast = tab(`e|3-5-7-8-3-5-7-8-|3---5-7-|3--5-7-8--------|3--5--7--|
B|----------------|--------|----------------|---------|
G|----------------|--------|----------------|---------|
D|----------------|--------|----------------|---------|
A|----------------|--------|----------------|---------|
E|----------------|--------|----------------|---------|`);
  const staff = score(toAlphaTex(ast)).tracks[0].staves[0];
  assert.equal(describe(staff.bars[0]), "3/1:8 5/1:8 7/1:8 8/1:8 3/1:8 5/1:8 7/1:8 8/1:8");
  assert.equal(describe(staff.bars[1]), "3/1:2 5/1:4 7/1:4");
  assert.equal(describe(staff.bars[2]), "3/1:8. 5/1:8 7/1:8 8/1:2 ~8/1:16", "croche pointée, et une tenue de 9 doubles = blanche liée à une double");
  assert.equal(describe(staff.bars[3]), "3/1:2t3 5/1:2t3 7/1:2t3", "trois notes égales sur une mesure : triolet de blanches");
});

test("toAlphaTex : grid: force le découpage, une mesure vide est un silence", () => {
  const ast = tab(`e|3-5-7-8---------|----------------|
B|----------------|----------------|
G|----------------|----------------|
D|----------------|----------------|
A|----------------|----------------|
E|----------------|----------------|`);
  const auto = score(toAlphaTex(ast)).tracks[0].staves[0];
  assert.equal(describe(auto.bars[0]), "3/1:8 5/1:8 7/1:8 8/1:2 ~8/1:8", "sans grille : croches");
  const forced = score(toAlphaTex(ast, { grid: 4 })).tracks[0].staves[0];
  assert.equal(describe(forced.bars[0]), "3/1:4 5/1:4 7/1:4 8/1:4", "grid: 4 force quatre noires");
  assert.equal(describe(forced.bars[1]), "r:1");
});

test("toAlphaTex : techniques traduites en effets alphaTex", () => {
  const ast = tab(`e|5h7-8p7-5t12x---|5/7-9\\7~~(5)<12>|8b10r8--8b--8br-|
B|----------------|----------------|----------------|
G|----------------|----------------|----------------|
D|----------------|----------------|----------------|
A|----------------|----------------|----------------|
E|----------------|----------------|----------------|`);
  const tex = toAlphaTex(ast);
  const staff = score(tex).tracks[0].staves[0];
  assert.equal(describe(staff.bars[0]), "5/1h:8 7/1:8 8/1h:8 7/1:8 5/1h:8 12/1:8T x/1:4");
  assert.equal(describe(staff.bars[1]), "5/1s:8 7/1:8 9/1s:8 7/1v:8. 5/1g:8. 12/1H:4");
  assert.equal(describe(staff.bars[2]), "8/1b0,4,4,0:2 8/1b0,4:4 8/1b0,4,4,0:4", "8b10r8 est une seule note avec sa courbe de bend");
});

test("toAlphaTex : un bend tenu pendant qu'une autre corde joue se lie", () => {
  const ast = tab(`e|----5-----------|--------5-------|
B|8b10--r8--------|8b10------------|
G|----------------|----------------|
D|----------------|----------------|
A|----------------|----------------|
E|----------------|----------------|`);
  const staff = score(toAlphaTex(ast)).tracks[0].staves[0];
  assert.equal(describe(staff.bars[0]), "8/2b0,4,4,0:4 (5/1 ~8/2):2.", "le bend se relâche après la note de la chanterelle : liaison");
  assert.equal(describe(staff.bars[1]), "8/2b0,4:2 5/1:2", "le bend est fini avant : pas de liaison");
});

test("toAlphaTex : une mesure trop dense garde l'ordre des notes", () => {
  const dense = `e|-8-8br---10b-8h10p8----8-------13p12-----13p12----13b---13~~~~-|
B|--------------------------10---11b----------13-------13---------|
G|----------------------------------------------------------------|
D|----------------------------------------------------------------|
A|----------------------------------------------------------------|
E|----------------------------------------------------------------|`;
  const staff = score(toAlphaTex(tab(dense))).tracks[0].staves[0];
  const beats = staff.bars[0].voices[0].beats;
  assert.ok(beats.length >= 14);
  assert.equal(beats[0].notes[0].fret, 8);
  assert.equal(beats[beats.length - 1].notes[0].fret, 13);
  assert.ok(beats[beats.length - 1].notes[0].vibrato);
});

test("toAlphaTex : 6/8 et partition tablature", () => {
  const ast = tab(`e|3-5-7-3-5-7-|
B|------------|
G|------------|
D|------------|
A|------------|
E|------------|`, { timeSignature: "6/8" });
  const tex = toAlphaTex(ast, { staff: "score tabs" });
  assert.match(tex, /\\staff \{score tabs\}/);
  assert.equal(score(toAlphaTex(ast, { staff: "tabs" })).tracks[0].staves[0].showTablature, true);
  assert.equal(score(toAlphaTex(ast, { staff: "tabs" })).tracks[0].staves[0].showStandardNotation, false);
  assert.match(tex, /\\ts 6 8 /);
  const bar = score(tex).tracks[0].staves[0].bars[0];
  assert.equal(bar.masterBar.timeSignatureNumerator, 6);
  assert.equal(describe(bar), "3/1:8 5/1:8 7/1:8 3/1:8 5/1:8 7/1:8");
});

test("translateTab : chaque événement ASCII connaît son temps alphaTab", () => {
  const ast = tab(`e|-3--5--7--8-|----0---|8b10r8--8b--8br-|3--5-7-8--------|
B|------------|----1---|----------------|----------------|
G|------------|--------|----------------|----------------|
D|------------|--------|----------------|----------------|
A|------------|--------|----------------|----------------|
E|------------|--------|----------------|----------------|`);
  const { tex, beats } = translateTab(ast);
  assert.equal(tex, toAlphaTex(ast));
  assert.deepEqual(beats[0], [0, 1, 2, 3]);
  assert.deepEqual(beats[1], [1], "le silence de départ est le temps 0");
  assert.deepEqual(beats[2], [0, 0, 0, 1, 2], "l'arrivée et le relâché d'un bend renvoient à la note de départ");
  assert.deepEqual(beats[3], [0, 1, 2, 3], "la liaison de la dernière note est un temps de plus, pas un événement");
  const staff = score(tex).tracks[0].staves[0];
  assert.equal(staff.bars[3].voices[0].beats.length, 5);
});

test("toAlphaTex : une frette impossible devient une note étouffée au lieu de faire planter le rendu", () => {
  const ast = tab(`e|1012----5-------|
B|----------------|
G|----------------|
D|----------------|
A|----------------|
E|----------------|`);
  const staff = score(toAlphaTex(ast)).tracks[0].staves[0];
  assert.equal(describe(staff.bars[0]), "x/1:2 5/1:2");
});
