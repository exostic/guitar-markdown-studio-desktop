import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScale,
  chordTones,
  circleIndexOfKey,
  circleOfFifths,
  diatonicChords,
  fretsForPitchClasses,
  isRomanNumeral,
  midiToFrequency,
  noteName,
  parseChord,
  parseKey,
  parseNote,
  parseTuning,
  preferAccidentals,
  resolveScaleName,
  romanToChord,
  scalePosition,
  stringMidi,
  transposeChord,
  transposeNote,
} from "../src/index.js";

test("parseNote lit lettres, altérations, solfège et octaves", () => {
  assert.equal(parseNote("A").pc, 9);
  assert.equal(parseNote("Bb").pc, 10);
  assert.equal(parseNote("F#").pc, 6);
  assert.equal(parseNote("e").letter, "E");
  assert.equal(parseNote("Sol").pc, 7);
  assert.equal(parseNote("Ré#").pc, 3);
  assert.equal(parseNote("E2").midi, 40);
  assert.equal(parseNote("Eb4").midi, 63);
  assert.equal(parseNote("H"), null);
  assert.equal(parseNote("Am"), null);
});

test("noteName, transposeNote et fréquences", () => {
  assert.equal(noteName(10), "A#");
  assert.equal(noteName(10, "flat"), "Bb");
  assert.equal(transposeNote("Bb", 2), "C");
  assert.equal(transposeNote("Bb", 1), "B");
  assert.equal(transposeNote("A", 1), "A#");
  assert.equal(transposeNote("A", 1, "flat"), "Bb");
  assert.equal(transposeNote("E2", 12), "E3");
  assert.equal(Math.round(midiToFrequency(69)), 440);
  assert.equal(Math.round(midiToFrequency(40) * 100) / 100, 82.41);
});

test("parseKey comprend les tonalités majeures et mineures", () => {
  const g = parseKey("G");
  assert.equal(g.mode, "major");
  assert.equal(g.relative, "Em");
  assert.deepEqual(g.accidentals, { count: 1, kind: "sharp" });
  assert.equal(parseKey("Gm").mode, "minor");
  assert.equal(parseKey("G minor").relative, "Bb");
  assert.equal(parseKey("F# minor").accidentals.count, 3);
  assert.equal(parseKey("Sol majeur").tonic, "G");
  assert.equal(parseKey("Mi mineur").name, "Em");
  assert.equal(parseKey("F").prefer, "flat");
  assert.deepEqual(parseKey("F").accidentals, { count: 1, kind: "flat" });
  assert.equal(parseKey("Dm").prefer, "flat");
  assert.equal(parseKey("Bb minor").relative, "Db");
  assert.equal(parseKey("blabla"), null);
  assert.equal(preferAccidentals("Eb"), "flat");
  assert.equal(preferAccidentals(undefined), "sharp");
});

test("buildScale épelle correctement les gammes", () => {
  assert.deepEqual(buildScale("A", "minor pentatonic").notes, ["A", "C", "D", "E", "G"]);
  assert.deepEqual(buildScale("A", "pentatonique mineure").degrees, ["1", "b3", "4", "5", "b7"]);
  assert.deepEqual(buildScale("F", "majeure").notes, ["F", "G", "A", "Bb", "C", "D", "E"]);
  assert.deepEqual(buildScale("G", "major").notes, ["G", "A", "B", "C", "D", "E", "F#"]);
  assert.deepEqual(buildScale("E", "blues").notes, ["E", "G", "A", "Bb", "B", "D"]);
  assert.deepEqual(buildScale("D", "dorien").notes, ["D", "E", "F", "G", "A", "B", "C"]);
  assert.equal(resolveScaleName("Mixolydien"), "mixolydian");
  assert.throws(() => buildScale("A", "klingon"), /Gamme inconnue/);
  assert.throws(() => buildScale("H", "major"), /fondamentale inconnue/);
});

test("parseChord et chordTones", () => {
  assert.deepEqual(parseChord("Am7/G").root, "A");
  assert.equal(parseChord("Am7/G").suffix, "m7");
  assert.equal(parseChord("Am7/G").bass, "G");
  assert.equal(parseChord("F6(#11)").suffix, "6(#11)");
  assert.equal(parseChord("N.C."), null);
  assert.equal(parseChord("am"), null);
  const am7 = chordTones("Am7");
  assert.deepEqual(am7.notes, ["A", "C", "E", "G"]);
  assert.deepEqual(am7.degrees, ["R", "b3", "5", "b7"]);
  assert.deepEqual(chordTones("Cmaj7").notes, ["C", "E", "G", "B"]);
  assert.deepEqual(chordTones("Dsus4").notes, ["D", "G", "A"]);
  assert.deepEqual(chordTones("F#dim").notes, ["F#", "A", "C"]);
  assert.deepEqual(chordTones("Bb").notes, ["Bb", "D", "F"]);
  assert.equal(chordTones("F6(#11)"), null);
});

test("transposeChord ne lève jamais et respecte l'altération source", () => {
  assert.equal(transposeChord("G/B", 2), "A/C#");
  assert.equal(transposeChord("Bb", 1), "B");
  assert.equal(transposeChord("Bb", 2), "C");
  assert.equal(transposeChord("F", 2, "flat"), "G");
  assert.equal(transposeChord("E", 1), "F");
  assert.equal(transposeChord("A", 1), "A#");
  assert.equal(transposeChord("A", 1, "flat"), "Bb");
  assert.equal(transposeChord("F6(#11)", 2), "G6(#11)");
  assert.equal(transposeChord("Am", -3), "F#m");
  assert.equal(transposeChord("N.C.", 5), "N.C.");
  assert.equal(transposeChord("Am", 0), "Am");
});

test("diatonicChords et chiffres romains", () => {
  const g = diatonicChords("G");
  assert.deepEqual(g.chords.map(c => c.chord), ["G", "Am", "Bm", "C", "D", "Em", "F#dim"]);
  assert.deepEqual(g.chords.map(c => c.seventh), ["Gmaj7", "Am7", "Bm7", "Cmaj7", "D7", "Em7", "F#m7b5"]);
  assert.deepEqual(g.chords[0].notes, ["G", "B", "D"]);
  assert.equal(g.harmonicDominant, null);
  const am = diatonicChords("Am");
  assert.deepEqual(am.chords.map(c => c.chord), ["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
  assert.equal(am.harmonicDominant, "E7");
  assert.deepEqual(diatonicChords("F").chords.map(c => c.chord), ["F", "Gm", "Am", "Bb", "C", "Dm", "Edim"]);
  assert.equal(romanToChord("V7", "G"), "D7");
  assert.equal(romanToChord("ii", "G"), "Am");
  assert.equal(romanToChord("vii°", "G"), "F#dim");
  assert.equal(romanToChord("bVII", "G"), "F");
  assert.equal(romanToChord("IVmaj7", "G"), "Cmaj7");
  assert.equal(romanToChord("i", "Am"), "Am");
  assert.equal(romanToChord("VI", "Am"), "F");
  assert.equal(romanToChord("Em", "G"), null);
  assert.equal(isRomanNumeral("IV"), true);
  assert.equal(isRomanNumeral("ii7"), true);
  assert.equal(isRomanNumeral("Am"), false);
  assert.equal(isRomanNumeral("C"), false);
});

test("cercle des quintes", () => {
  const circle = circleOfFifths();
  assert.equal(circle.length, 12);
  assert.deepEqual(circle.slice(0, 4).map(s => s.major), ["C", "G", "D", "A"]);
  assert.equal(circle[11].major, "F");
  assert.equal(circle[11].minor, "Dm");
  assert.equal(circle[6].major, "F#/Gb");
  assert.equal(circleIndexOfKey("Em"), 1);
  assert.equal(circleIndexOfKey("Bb"), 10);
});

test("parseTuning et géométrie du manche", () => {
  assert.deepEqual(parseTuning("").midi, [40, 45, 50, 55, 59, 64]);
  assert.equal(parseTuning("Standard").name, "standard");
  assert.deepEqual(parseTuning("E A D G B e").midi, [40, 45, 50, 55, 59, 64]);
  assert.deepEqual(parseTuning("Drop D").midi, [38, 45, 50, 55, 59, 64]);
  assert.deepEqual(parseTuning("DADGAD").notes, ["D2", "A2", "D3", "G3", "A3", "D4"]);
  assert.deepEqual(parseTuning("D2 A2 D3 G3 B3 E4").midi, [38, 45, 50, 55, 59, 64]);
  assert.equal(parseTuning("Eb standard").midi[0], 39);
  assert.equal(parseTuning("E A D"), null);
  const standard = parseTuning("");
  assert.equal(stringMidi(standard, 1, 0), 64);
  assert.equal(stringMidi(standard, 6, 5, 3), 48);
  const pent = buildScale("A", "minor pentatonic");
  assert.equal(fretsForPitchClasses(standard, pent.pcs, [0, 12]).length, 35);
  assert.deepEqual(scalePosition(standard, pent, 1), [5, 9]);
  assert.deepEqual(scalePosition(standard, pent, 2), [8, 12]);
  assert.deepEqual(scalePosition(standard, pent, 5), [3, 7]);
  assert.equal(scalePosition(standard, pent, 6), null);
});
