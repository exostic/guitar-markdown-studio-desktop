import test from "node:test";
import assert from "node:assert/strict";
import { extractBlockOptions, parseStaff } from "./blockOptions.js";

test("extractBlockOptions lit sound: et grid: en tête d'un bloc", () => {
  const { body, sound, grid } = extractBlockOptions("sound: clean\ngrid: 8\ne|--3--|\nB|-----|");
  assert.equal(body, "e|--3--|\nB|-----|");
  assert.equal(sound, "electric");
  assert.equal(grid, 8);
  assert.deepEqual(extractBlockOptions("e|--3--|"), { body: "e|--3--|", sound: null, grid: null, staff: null });
  assert.equal(extractBlockOptions("staff: tab et partition\ne|--3--|").staff, "score tabs");
});

test("parseStaff : tab, partition ou les deux", () => {
  assert.equal(parseStaff("tab"), "tabs");
  assert.equal(parseStaff("tablature"), "tabs");
  assert.equal(parseStaff("partition"), "score");
  assert.equal(parseStaff("score"), "score");
  assert.equal(parseStaff("tab et partition"), "score tabs");
  assert.equal(parseStaff("tab+score"), "score tabs");
  assert.equal(parseStaff("les deux"), "score tabs");
  assert.equal(parseStaff(""), null);
});
