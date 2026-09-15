import test from "node:test";
import assert from "node:assert/strict";
import { detectPitch, noteFromFrequency } from "./pitch.js";

const sampleRate = 44100;

function tone(frequency, { seconds = 0.1, harmonics = [1], amplitude = 0.3 } = {}) {
  const data = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < data.length; i += 1) {
    let value = 0;
    harmonics.forEach((level, k) => {
      value += level * Math.sin((2 * Math.PI * frequency * (k + 1) * i) / sampleRate);
    });
    data[i] = amplitude * value;
  }
  return data;
}

test("detectPitch : les six cordes à vide, avec harmoniques", () => {
  for (const frequency of [82.41, 110, 146.83, 196, 246.94, 329.63]) {
    const found = detectPitch(tone(frequency, { harmonics: [1, 0.6, 0.3, 0.2] }), sampleRate);
    assert.ok(found, `${frequency} Hz détecté`);
    const cents = 1200 * Math.log2(found.frequency / frequency);
    assert.ok(Math.abs(cents) < 3, `${frequency} Hz : ${cents.toFixed(1)} cents`);
  }
});

test("detectPitch : silence et bruit ne donnent rien", () => {
  assert.equal(detectPitch(new Float32Array(4096), sampleRate), null);
  let seed = 7;
  const noise = Float32Array.from({ length: 4096 }, () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648) * 0.6 - 0.3; });
  assert.equal(detectPitch(noise, sampleRate), null);
});

test("noteFromFrequency : note la plus proche et écart en cents", () => {
  assert.deepEqual(noteFromFrequency(440), { midi: 69, cents: 0 });
  assert.deepEqual(noteFromFrequency(110 * 2 ** (10 / 1200)), { midi: 45, cents: 10 });
  assert.deepEqual(noteFromFrequency(82.41 * 2 ** (-30 / 1200)), { midi: 40, cents: -30 });
});
