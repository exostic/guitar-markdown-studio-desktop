import test from "node:test";
import assert from "node:assert/strict";
import { diatonicChords, parseTuner } from "@gms/guitar-markdown";
import { renderCircleOfFifthsSvg, renderKeyChartHtml, renderTunerHtml } from "../src/index.js";

test("tableau de tonalité : 7 lignes, texte échappé", () => {
  const html = renderKeyChartHtml(diatonicChords("G", { sevenths: true }));
  assert.equal((html.match(/<tr>/g) ?? []).length, 8);
  assert.match(html, /F#<sub class="chord-ext">dim<\/sub>/);
  assert.match(html, /Gmaj7|G<sub class="chord-ext">maj7<\/sub>/);
  assert.match(html, /Relative mineure : Em/);
  assert.match(renderKeyChartHtml(diatonicChords("Am")), /Dominante \(mineur harmonique\) : E7/);
});

test("cercle des quintes : 12 secteurs majeurs et mineurs, une tonalité active", () => {
  const svg = renderCircleOfFifthsSvg("D");
  assert.equal((svg.match(/cof-label-major/g) ?? []).length, 12);
  assert.equal((svg.match(/cof-label-minor/g) ?? []).length, 12);
  assert.equal((svg.match(/cof-major cof-key/g) ?? []).length, 1);
  assert.equal((svg.match(/cof-neighbor/g) ?? []).length, 5);
  assert.match(svg, /voisines G et A, relative Bm/);
  assert.doesNotThrow(() => renderCircleOfFifthsSvg(""));
  const minor = renderCircleOfFifthsSvg("Am");
  assert.equal((minor.match(/cof-minor cof-key/g) ?? []).length, 1);
  assert.equal((minor.match(/cof-major cof-key/g) ?? []).length, 0);
  assert.equal((minor.match(/cof-label-active/g) ?? []).length, 1);
});

test("accordeur : 6 boutons et 6 lignes de tableau", () => {
  const html = renderTunerHtml(parseTuner("tuning: Drop D"));
  assert.equal((html.match(/class="tuner-string"/g) ?? []).length, 6);
  assert.equal((html.match(/<tr><td>/g) ?? []).length, 6);
  assert.match(html, /data-midi="38"/);
  assert.match(html, /73,42 Hz/);
});
