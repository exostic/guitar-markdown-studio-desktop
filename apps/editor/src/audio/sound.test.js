import test from "node:test";
import assert from "node:assert/strict";
import { extractSoundLine, parseSound } from "./sound.js";

test("parseSound comprend l'anglais et le français", () => {
  assert.equal(parseSound("distortion"), "distortion");
  assert.equal(parseSound("Guitare saturée"), "distortion");
  assert.equal(parseSound("clean"), "electric");
  assert.equal(parseSound("électrique"), "electric");
  assert.equal(parseSound("acoustic"), "acoustic");
  assert.equal(parseSound(""), null);
});

test("extractSoundLine retire la ligne sound: d'un bloc tab", () => {
  const body = "sound: clean\n    F\ne|--1--|\nB|--1--|\n";
  const { body: rest, sound } = extractSoundLine(body);
  assert.equal(sound, "electric");
  assert.equal(rest, "    F\ne|--1--|\nB|--1--|\n");
  assert.deepEqual(extractSoundLine("e|--1--|"), { body: "e|--1--|", sound: null });
});
