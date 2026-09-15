import test from "node:test";
import assert from "node:assert/strict";
import * as alphaTab from "@coderline/alphatab";
import { listScoreTracks, parseAsciiTab, scoreToBlocks, scoreToMarkdown } from "../src/index.js";

function scoreFromTex(tex) {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  return importer.readScore();
}

const SONG = `\\title "Song" \\artist "Band" \\tempo 100 \\tuning d4 b3 g3 d3 a2 d2 \\capo 2 \\instrument 30 \\track "Lead" .
\\ts 4 4 5.3{h}.8 7.3.8 8.2{b (0 4)}.4 (0.1 1.2 0.3).8{ch "C"} r.8 x.3.16 7.1{v}.16 5.1{g}.8 |
3.3.8{tu 3} 4.3.8{tu 3} 5.3.8{tu 3} 12.1{nh}.4 5.3{ss}.4 7.3.4 |
r.1 |
8.2{b (0 4 0)}.2 10.2{h}.4 8.2.4`;

test("scoreToMarkdown : front matter et tablature ASCII à partir d'une partition alphaTab", () => {
  const { markdown, warnings } = scoreToMarkdown(scoreFromTex(SONG));
  assert.deepEqual(warnings, []);
  assert.match(markdown, /^---\ntitle: Song\nartist: Band\ntempo: 100 BPM\ntime: 4\/4\ntuning: D2 A2 D3 G3 B3 D4\ncapo: 2\nsound: distortion\n---\n/);
  const block = markdown.slice(markdown.indexOf("```tab"));
  assert.equal(block, `\`\`\`tab
staff: tab et partition
  C
e|--------------------------------0-------------------7~~~(5)-----|
B|----------------8b--------------1-------------------------------|
G|5h------7-----------------------0---------------x---------------|
D|----------------------------------------------------------------|
A|----------------------------------------------------------------|
E|----------------------------------------------------------------|

e|---------------<12>-----------------------------------------|----|------------|
B|------------------------------------------------------------|----|8br---10p8--|
G|3----4----5-------------------5/-------------7--------------|----|------------|
D|------------------------------------------------------------|----|------------|
A|------------------------------------------------------------|----|------------|
E|------------------------------------------------------------|----|------------|
\`\`\`
`);
});

test("scoreToMarkdown : ce que le parseur ASCII relit correspond à la partition", () => {
  const { markdown } = scoreToMarkdown(scoreFromTex(SONG));
  const tab = markdown.slice(markdown.indexOf("e|"), markdown.lastIndexOf("|") + 1);
  const ast = parseAsciiTab(tab);
  assert.equal(ast.measures.length, 4);
  assert.equal(ast.measures[0].events.length, 7, "8 temps d'attaque moins le silence");
  assert.deepEqual(ast.measures[0].techniques.map(t => t.type), ["hammer"]);
  assert.deepEqual(ast.measures[0].ornaments.map(o => o.type).sort(), ["bend", "vibrato"]);
  assert.deepEqual(ast.measures[1].techniques.map(t => t.type), ["slide-up"]);
  assert.equal(ast.measures[2].events.length, 0);
  assert.deepEqual(ast.measures[3].techniques.map(t => t.type), ["pull"]);
  assert.deepEqual(ast.measures[3].ornaments.map(o => o.type), ["bend-release"]);
});

test("scoreToMarkdown : un fichier Guitar Pro rechargé donne le même Markdown", () => {
  const score = scoreFromTex(SONG);
  const bytes = new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
  const reloaded = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());
  assert.equal(scoreToMarkdown(reloaded).markdown, scoreToMarkdown(score).markdown);
});

test("scoreToMarkdown : plusieurs pistes, pistes ignorées et découpage optionnel en blocs", () => {
  const tex = `\\title "Duo" \\tempo 90 .
\\track "Guitare" \\staff {tabs} \\tuning e4 b3 g3 d3 a2 e2 .
3.3.4 3.3.4 3.3.4 3.3.4 | 5.3.1 | 7.3.1 | 8.3.1 | 10.3.1 |
\\track "Basse" \\staff {tabs} \\tuning g2 d2 a1 e1 .
3.3.1 | 3.3.1 | 3.3.1 | 3.3.1 | 3.3.1`;
  const { markdown, warnings } = scoreToMarkdown(scoreFromTex(tex));
  assert.deepEqual(warnings, ["Piste ignorée : Basse (4 cordes)"]);
  assert.match(markdown, /> Piste ignorée : Basse \(4 cordes\)/);
  assert.equal((markdown.match(/```tab/g) ?? []).length, 1, "une piste : un seul bloc, portée et tablature");
  assert.equal((scoreToMarkdown(scoreFromTex(tex), { barsPerBlock: 4, staff: null }).markdown.match(/```tab/g) ?? []).length, 2, "5 mesures en blocs de 4 → deux blocs");
  assert.doesNotMatch(scoreToMarkdown(scoreFromTex(tex), { staff: null }).markdown, /staff:/);
  assert.doesNotMatch(markdown, /^## /m, "une seule piste retenue : pas de titre de piste");
  assert.match(markdown, /G\|3-3-3-3-\|5---\|7---\|8---\|\n[DAE]\|/, "quatre mesures sur la ligne");
  assert.match(markdown, /E\|--------\|----\|----\|----\|\n\ne\|----\|\n/, "la cinquième mesure ouvre un nouveau groupe de lignes dans le même bloc");
  const ast = parseAsciiTab(markdown.slice(markdown.indexOf("e|"), markdown.lastIndexOf("|") + 1));
  assert.equal(ast.measures.length, 5);
});

test("scoreToMarkdown : une levée ne fixe pas la mesure du morceau et se complète par des silences", () => {
  const tex = `\\title "Levée" \\tempo 72 .
\\ts 1 4 3.3.8 5.3.8 | \\ts 4 4 7.3.4 8.3.4 7.3.4 5.3.4 | 3.3.1 | \\ts 2 4 5.3.4 7.3.4`;
  const { markdown, warnings } = scoreToMarkdown(scoreFromTex(tex));
  assert.match(markdown, /\ntime: 4\/4\n/);
  assert.deepEqual(warnings, ["Mesures plus courtes que 4/4, complétées par des silences : 1, 4"]);
  assert.match(markdown, /G\|------------3-5-\|7-8-7-5-\|3---\|5-7-----\|/);
  const ast = parseAsciiTab(markdown.slice(markdown.indexOf("e|"), markdown.lastIndexOf("|") + 1));
  assert.equal(ast.measures[0].events[0].offset, 0.75, "la levée commence sur le dernier temps");
});

test("scoreToBlocks : des blocs à insérer, avec leurs réglages et une note d'origine", () => {
  const { markdown, warnings } = scoreToBlocks(scoreFromTex(SONG), { sourceName: "song.gp5" });
  assert.deepEqual(warnings, []);
  assert.doesNotMatch(markdown, /^---/, "pas de front matter");
  assert.match(markdown, /^```tab\nstaff: tab et partition\ntempo: 100\ntime: 4\/4\ntuning: D2 A2 D3 G3 B3 D4\ncapo: 2\nsound: distortion\n  C\n/, "pas de note d'origine : les blocs commencent tout de suite");
});

test("scoreToMarkdown : deux frettes à deux chiffres ne se collent jamais", () => {
  const tex = `\\tempo 90 . 7.3.16 9.3.16 10.3.16 12.3.16 14.3.16 16.3.16 17.3.16 19.3.16 12.1{v}.8 13.1.8`;
  const { markdown } = scoreToMarkdown(scoreFromTex(tex));
  assert.match(markdown, /G\|7--9--10-12-14-16-17-19-------------------------\|/);
  assert.match(markdown, /e\|------------------------12~---13----------------\|/);
  const ast = parseAsciiTab(markdown.slice(markdown.indexOf("e|"), markdown.lastIndexOf("|") + 1));
  assert.deepEqual(ast.measures[0].events.map(e => e.positions[0].fret), ["7", "9", "10", "12", "14", "16", "17", "19", "12", "13"]);
});

test("listScoreTracks et le choix des pistes", () => {
  const tex = `\\title "Trio" \\tempo 90 .
\\track "Rythmique" \\instrument 25 \\tuning e4 b3 g3 d3 a2 e2 . 3.3.1 | 3.3.1
\\track "Solo" \\instrument 30 \\tuning e4 b3 g3 d3 a2 e2 . 12.1.1 | r.1
\\track "Basse" \\instrument 33 \\tuning g2 d2 a1 e1 . 3.3.1 | 3.3.1`;
  const score = scoreFromTex(tex);
  assert.deepEqual(listScoreTracks(score).map(t => [t.name, t.instrument, t.strings, t.bars, t.notes, t.eligible, t.reason]), [
    ["Rythmique", "Guitare acoustique", 6, 2, 2, true, null],
    ["Solo", "Guitare distordue", 6, 2, 1, true, null],
    ["Basse", "Basse", 4, 2, 2, false, "4 cordes"],
  ]);
  const only = scoreToMarkdown(score, { tracks: [1] });
  assert.deepEqual(only.warnings, [], "une piste écartée volontairement n'est pas signalée");
  assert.equal((only.markdown.match(/```tab/g) ?? []).length, 1);
  assert.doesNotMatch(only.markdown, /^## /m);
  assert.match(only.markdown, /sound: distortion/, "les réglages suivent la première piste retenue");
  const blocks = scoreToBlocks(score, { tracks: [0, 1] });
  assert.equal((blocks.markdown.match(/^## /gm) ?? []).length, 2);
});

test("scoreToMarkdown : les lignes se coupent selon la largeur, une mesure trop large reste seule", () => {
  // Three sparse bars (4 chars each) then a dense one of sixteen sixteenths.
  const tex = `\\tempo 90 . 3.3.2 5.3.2 | 3.3.2 5.3.2 | 3.3.2 5.3.2 | 3.3.16 4.3.16 5.3.16 6.3.16 7.3.16 8.3.16 9.3.16 10.3.16 3.3.16 4.3.16 5.3.16 6.3.16 7.3.16 8.3.16 9.3.16 10.3.16 | 3.3.1`;
  const { markdown } = scoreToMarkdown(scoreFromTex(tex), { maxLineWidth: 40 });
  const rows = markdown.split("\n").filter(l => /^G\|/.test(l));
  assert.deepEqual(rows, [
    "G|3-5-|3-5-|3-5-|",
    "G|3--4--5--6--7--8--9--10-3--4--5--6--7--8--9--10-|",
    "G|3---|",
  ]);
  const wide = scoreToMarkdown(scoreFromTex(tex)).markdown.split("\n").filter(l => /^G\|/.test(l));
  assert.equal(wide.length, 2, "avec la largeur par défaut : quatre mesures puis la cinquième");
});
