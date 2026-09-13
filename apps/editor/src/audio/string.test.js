import test from "node:test";
import assert from "node:assert/strict";
import { midiToFrequency } from "@gms/guitar-markdown";
import { STRING_CHARACTER, guessString, renderPluck } from "./string.js";
import { renderBodyImpulse, renderCabinetImpulse, renderRoomImpulse } from "./impulse.js";

const sampleRate = 44100;

// Deterministic noise so the response checks below cannot flake.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fundamental by autocorrelation with parabolic refinement, sub-sample accurate.
function estimateFrequency(data, expected) {
  const start = Math.round(sampleRate * 0.1);
  const window = 4096;
  const period = sampleRate / expected;
  const correlation = new Map();
  let bestLag = 0;
  for (let lag = Math.floor(period * 0.9); lag <= Math.ceil(period * 1.1); lag += 1) {
    let sum = 0;
    for (let n = start; n < start + window; n += 1) sum += data[n] * data[n + lag];
    correlation.set(lag, sum);
    if (!bestLag || sum > correlation.get(bestLag)) bestLag = lag;
  }
  const y0 = correlation.get(bestLag - 1) ?? correlation.get(bestLag);
  const y1 = correlation.get(bestLag);
  const y2 = correlation.get(bestLag + 1) ?? y1;
  const shift = (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2 || 1);
  return sampleRate / (bestLag + shift);
}

function rmsDb(data, seconds) {
  const start = Math.round(sampleRate * seconds);
  let sum = 0;
  for (let n = start; n < start + 2048; n += 1) sum += data[n] * data[n];
  return 20 * Math.log10(Math.sqrt(sum / 2048) + 1e-12);
}

function magnitudeDb(impulse, frequency) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  let re = 0;
  let im = 0;
  for (let n = 0; n < impulse.length; n += 1) {
    re += impulse[n] * Math.cos(omega * n);
    im -= impulse[n] * Math.sin(omega * n);
  }
  return 20 * Math.log10(Math.hypot(re, im) + 1e-12);
}

test("renderPluck : juste à moins de 3 cents sur toute la tessiture", () => {
  for (const [midi, string] of [[40, 6], [45, 5], [52, 4], [64, 1], [76, 1], [88, 1]]) {
    const expected = midiToFrequency(midi);
    const data = renderPluck({ midi, string, sampleRate });
    const cents = 1200 * Math.log2(estimateFrequency(data, expected) / expected);
    assert.ok(Math.abs(cents) < 3, `midi ${midi} : ${cents.toFixed(1)} cents`);
  }
});

test("renderPluck : normalisée, finie, et une corde grave sonne plus longtemps", () => {
  const plain = renderPluck({ midi: 64, string: 1, sampleRate });
  const wound = renderPluck({ midi: 64, string: 4, sampleRate });
  for (const data of [plain, wound]) {
    assert.ok(data.every(Number.isFinite));
    assert.ok(Math.max(...data.slice(0, 4096).map(Math.abs)) <= 0.8 + 1e-6);
  }
  assert.ok(rmsDb(wound, 1.5) - rmsDb(wound, 0.05) > rmsDb(plain, 1.5) - rmsDb(plain, 0.05));
  assert.equal(Object.keys(STRING_CHARACTER).length, 6);
  assert.deepEqual([40, 52, 60, 69].map(guessString), [6, 5, 3, 1]);
});

test("réponses impulsionnelles : énergie unitaire, caisse bombée dans le grave", () => {
  for (const render of [renderBodyImpulse, renderRoomImpulse, renderCabinetImpulse]) {
    const impulse = render({ sampleRate, random: seeded(7) });
    assert.ok(impulse.every(Number.isFinite));
    const energy = impulse.reduce((sum, x) => sum + x * x, 0);
    assert.ok(Math.abs(energy - 1) < 1e-3, `energy ${energy}`);
  }
  const body = renderBodyImpulse({ sampleRate, random: seeded(7) });
  // Against an average of mids: the reflection tail combs single frequencies.
  const mids = [800, 1000, 1300, 1700, 2000].map(f => magnitudeDb(body, f));
  const bump = magnitudeDb(body, 102) - mids.reduce((a, b) => a + b) / mids.length;
  assert.ok(bump > 2 && bump < 16, `bump ${bump.toFixed(1)} dB`);
});
