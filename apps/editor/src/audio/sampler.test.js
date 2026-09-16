import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadSampler, isSamplerReady, voiceFor } from "./sampler.js";

const require = createRequire(import.meta.url);
const files = {
  "https://app.test/samples/acoustic-steel.sf2": readFileSync(new URL("../../public/samples/acoustic-steel.sf2", import.meta.url)),
  "https://app.test/soundfont/sonivox.sf2": readFileSync(require.resolve("@coderline/alphatab/soundfont/sonivox.sf2")),
};
const fetched = [];
globalThis.fetch = async url => {
  fetched.push(url);
  const file = files[url];
  if (!file) return { ok: false, status: 404 };
  return { ok: true, arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) };
};
const ctx = {
  createBuffer: (channels, length, sampleRate) => ({ channels, length, sampleRate, copyToChannel() {} }),
};

test("l'acoustique vient de la première banque, l'électrique de la banque General MIDI", async () => {
  assert.equal(isSamplerReady(), false);
  const ready = await loadSampler(Object.keys(files));
  assert.equal(ready, true);
  assert.equal(isSamplerReady(), true);
  const acoustic = voiceFor(ctx, "acoustic", 52);
  assert.match(acoustic.bank, /acoustic-steel/);
  assert.equal(acoustic.buffer.sampleRate, 44100);
  assert.equal(acoustic.loop, null, "un échantillon complet, sans boucle");
  assert.ok(Math.abs(acoustic.rate - 1) < 0.02, "le mi 52 est échantillonné, joué presque à sa vitesse");
  const electric = voiceFor(ctx, "electric", 52);
  assert.match(electric.bank, /sonivox/);
  assert.equal(voiceFor(ctx, "acoustic", 52).buffer, acoustic.buffer, "le tampon est réutilisé");
});

test("une banque manquante n'empêche pas les autres, et la même liste n'est pas rechargée", async () => {
  fetched.length = 0;
  const ready = await loadSampler(["https://app.test/nope.sf2", "https://app.test/soundfont/sonivox.sf2"]);
  assert.equal(ready, true);
  assert.equal(fetched.length, 2);
  assert.match(voiceFor(ctx, "acoustic", 52).bank, /sonivox/, "l'acoustique retombe sur la banque General MIDI");
  await loadSampler(["https://app.test/nope.sf2", "https://app.test/soundfont/sonivox.sf2"]);
  assert.equal(fetched.length, 2, "pas de nouveau téléchargement");
  assert.equal(await loadSampler(["https://app.test/nope.sf2"]), false);
  assert.equal(isSamplerReady(), false);
  assert.equal(voiceFor(ctx, "acoustic", 52), null);
});
