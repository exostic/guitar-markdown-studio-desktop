import test from "node:test";
import assert from "node:assert/strict";
import { extractBlockOptions, parseStaff } from "./blockOptions.js";

test("extractBlockOptions lit sound: et grid: en tête d'un bloc", () => {
  const { body, sound, grid } = extractBlockOptions("sound: clean\ngrid: 8\ne|--3--|\nB|-----|");
  assert.equal(body, "\n\ne|--3--|\nB|-----|", "les lignes d'option deviennent des lignes vides : la numérotation tient");
  assert.equal(sound, "electric");
  assert.equal(grid, 8);
  assert.deepEqual(extractBlockOptions("e|--3--|"), { body: "e|--3--|", sound: null, grid: null, staff: null, tempo: null, timeSignature: null, tuning: null, capo: null });
  const song = extractBlockOptions("tempo: 140\ntime: 3/4\ntuning: Drop D\ncapo: 2\ne|--3--|");
  assert.equal(song.body, "\n\n\n\ne|--3--|");
  assert.equal(song.tempo, 140);
  assert.equal(song.timeSignature, "3/4");
  assert.equal(song.tuning.name, "drop d");
  assert.equal(song.capo, 2);
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
