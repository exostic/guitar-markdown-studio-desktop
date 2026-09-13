import test from "node:test";
import assert from "node:assert/strict";
import { parseScale } from "../src/index.js";

test("parse un diagramme de gamme avec notes grises et surlignées", () => {
  const ast = parseScale(`frets: 0-8
e: 0|2|3|[5]|[7]|8
E: 0|2|3|[5]|[7]|8`);
  assert.deepEqual(ast.fretRange, [0, 8]);
  assert.deepEqual(ast.dim[1], [
    { fret: 0, label: null },
    { fret: 2, label: null },
    { fret: 3, label: null },
    { fret: 8, label: null },
  ]);
  assert.deepEqual(ast.highlight[1], [
    { fret: 5, label: null },
    { fret: 7, label: null },
  ]);
});

test("parse une étiquette de note (grise et surlignée)", () => {
  const ast = parseScale("e: 5,A|[7,Am]|[3,A#]|2,Ab");
  assert.deepEqual(ast.dim[1], [
    { fret: 5, label: "A" },
    { fret: 2, label: "Ab" },
  ]);
  assert.deepEqual(ast.highlight[1], [
    { fret: 7, label: "Am" },
    { fret: 3, label: "A#" },
  ]);
});

test("déduit la plage de frettes si absente", () => {
  const ast = parseScale("e: 0|[2]|5");
  assert.deepEqual(ast.fretRange, [0, 5]);
});

test("rejette une frette invalide", () => {
  assert.throws(() => parseScale("e: 0|x|5"), /Frette invalide/);
});

test("rejette une ligne de corde inconnue", () => {
  assert.throws(() => parseScale("Z: 0|2|5"), /Ligne de diagramme invalide/);
});

test("rejette un diagramme vide", () => {
  assert.throws(() => parseScale("   "), /aucune ligne trouvée/);
});

test("rejette une plage de frettes invalide", () => {
  assert.throws(() => parseScale("frets: 5-2"), /Plage de frettes invalide/);
});

test("génère une gamme nommée avec la fondamentale surlignée", () => {
  const ast = parseScale("scale: A minor pentatonic\nfrets: 5-8");
  assert.deepEqual(ast.fretRange, [5, 8]);
  assert.deepEqual(ast.highlight[6], [{ fret: 5, label: "A", degree: "R" }]);
  assert.deepEqual(ast.dim[6], [{ fret: 8, label: "C", degree: "b3" }]);
  assert.equal(ast.meta.kind, "scale");
  assert.equal(ast.meta.labelFr, "pentatonique mineure");
  assert.deepEqual(ast.meta.notes, ["A", "C", "D", "E", "G"]);
});

test("accepte les noms français et les étiquettes en degrés", () => {
  const ast = parseScale("gamme: Sol majeure\nfrets: 0-3\nlabels: degrees");
  assert.deepEqual(ast.highlight[6], [{ fret: 3, label: "R", degree: "R" }]);
  assert.deepEqual(ast.dim[6].map(note => note.label), ["6", "7"]);
  assert.deepEqual(parseScale("scale: G major\nfrets: 0-3\nlabels: none").dim[6].map(note => note.label), [null, null]);
});

test("position : fenêtre de 5 cases, frets: prioritaire", () => {
  assert.deepEqual(parseScale("scale: A minor pentatonic\nposition: 1").fretRange, [5, 9]);
  assert.deepEqual(parseScale("scale: A minor pentatonic\nposition: 2").fretRange, [8, 12]);
  assert.deepEqual(parseScale("scale: A minor pentatonic\nposition: 2\nfrets: 0-4").fretRange, [0, 4]);
  assert.throws(() => parseScale("scale: A minor pentatonic\nposition: 9"), /Position 9 introuvable/);
});

test("une ligne explicite remplace la note générée", () => {
  const ast = parseScale("scale: A minor pentatonic\nfrets: 5-8\ne: [8,bend]");
  assert.deepEqual(ast.highlight[1], [{ fret: 5, label: "A", degree: "R" }, { fret: 8, label: "bend" }]);
  assert.equal(ast.dim[1], undefined);
});

test("arpège : couleurs par degré, plage par défaut 0-12", () => {
  const ast = parseScale("arpeggio: Am7");
  assert.deepEqual(ast.fretRange, [0, 12]);
  assert.equal(ast.meta.kind, "arpeggio");
  assert.deepEqual(ast.meta.degrees, ["R", "b3", "5", "b7"]);
  const third = ast.dim[6].find(note => note.fret === 8);
  assert.deepEqual(third, { fret: 8, label: "b3", degree: "b3", color: "#e43b7d" });
  assert.equal(ast.highlight[6][0].color, "#1f2937");
});

test("scale: et arpeggio: sont exclusifs, gamme et accord inconnus refusés", () => {
  assert.throws(() => parseScale("scale: A major\narpeggio: Am"), /soit scale:, soit arpeggio:/);
  assert.throws(() => parseScale("scale: A klingon"), /Gamme inconnue/);
  assert.throws(() => parseScale("arpeggio: Xyz"), /Accord inconnu/);
  assert.throws(() => parseScale("scale: pentatonic"), /indiquez la note/);
});

test("accordage alternatif via tuning:", () => {
  const ast = parseScale("scale: D major\nfrets: 0-2\ntuning: Drop D");
  assert.equal(ast.highlight[6][0].fret, 0);
});
