import test from "node:test";
import assert from "node:assert/strict";
import { parseRhythmPattern } from "../src/index.js";

test("parse un motif rythmique en temps et frappes", () => {
  const pattern = parseRhythmPattern("B H | B h | H B");
  assert.equal(pattern.groups.length, 3);
  assert.deepEqual(pattern.groups[0], [
    { direction: "down", ghost: false },
    { direction: "up", ghost: false },
  ]);
  assert.deepEqual(pattern.groups[1][1], { direction: "up", ghost: true });
});

test("parse un silence dans un motif", () => {
  const pattern = parseRhythmPattern("B - H | - B");
  assert.deepEqual(pattern.groups[0], [
    { direction: "down", ghost: false },
    { rest: true },
    { direction: "up", ghost: false },
  ]);
  assert.deepEqual(pattern.groups[1][0], { rest: true });
});

test("rejette une frappe invalide", () => {
  assert.throws(() => parseRhythmPattern("B X | B H"), /Frappe invalide/);
});

test("rejette un motif vide", () => {
  assert.throws(() => parseRhythmPattern("   "), /aucun temps trouvé/);
});
