import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseSoundFont, zoneForNote } from "./soundfont.js";

const require = createRequire(import.meta.url);
const file = readFileSync(require.resolve("@coderline/alphatab/soundfont/sonivox.sf2"));
const font = parseSoundFont(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

test("la SoundFont livrée avec alphaTab contient les guitares General MIDI", () => {
  const names = Object.fromEntries(font.presets.filter(p => p.bank === 0).map(p => [p.program, p.name]));
  for (const program of [24, 25, 27, 29, 30]) assert.ok(names[program], `programme ${program}`);
  assert.match(names[25], /steel/i);
  assert.match(names[27], /clean/i);
});

test("une zone couvre chaque note de la guitare, avec racine, boucle et enveloppe", () => {
  const zones = font.programZones(25);
  assert.ok(zones.length > 0);
  for (const midi of [40, 52, 64, 76, 88]) {
    const zone = zoneForNote(zones, midi);
    assert.ok(zone, `note ${midi}`);
    assert.ok(zone.sampleRate >= 8000 && zone.sampleRate <= 48000);
    assert.ok(zone.rootKey >= 0 && zone.rootKey <= 127);
    assert.ok(zone.end > zone.start);
    if (zone.loops) assert.ok(zone.loopEnd > zone.loopStart && zone.loopEnd <= zone.end);
    assert.ok(zone.envelope.release > 0 && zone.envelope.release < 30);
    const data = font.zoneSamples(zone);
    assert.equal(data.length, zone.end - zone.start);
    assert.ok(data.some(v => Math.abs(v) > 0.01), "des échantillons non nuls");
    assert.ok(data.every(v => v >= -1 && v <= 1));
  }
});

test("zoneForNote prend la zone la plus proche hors plage", () => {
  const zones = [{ lo: 40, hi: 50 }, { lo: 60, hi: 70 }];
  assert.equal(zoneForNote(zones, 45), zones[0]);
  assert.equal(zoneForNote(zones, 55), zones[0]);
  assert.equal(zoneForNote(zones, 80), zones[1]);
});
