import test from "node:test";
import assert from "node:assert/strict";
import { parseTuner, parseTuning } from "../src/index.js";

test("accordage standard par défaut, cordes de la 6 à la 1", () => {
  const ast = parseTuner("");
  assert.deepEqual(ast.strings.map(s => s.number), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(ast.strings.map(s => s.note), ["E2", "A2", "D3", "G3", "B3", "E4"]);
  assert.equal(ast.strings[0].frequency, 82.41);
  assert.equal(ast.strings[5].frequency, 329.63);
});

test("accordage nommé, explicite ou hérité du document", () => {
  assert.equal(parseTuner("tuning: DADGAD").strings[1].note, "A2");
  assert.equal(parseTuner("tuning: D A D G B e").strings[0].midi, 38);
  assert.equal(parseTuner("", { defaultTuning: parseTuning("Drop D") }).strings[0].note, "D2");
});

test("rejette une ligne inconnue ou un accordage invalide", () => {
  assert.throws(() => parseTuner("foo: bar"), /Ligne de tuner invalide/);
  assert.throws(() => parseTuner("tuning: E A D"), /Accordage inconnu/);
});
