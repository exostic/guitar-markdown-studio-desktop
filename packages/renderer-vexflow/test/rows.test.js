import test from "node:test";
import assert from "node:assert/strict";
import { measureNaturalWidth, packMeasureRows } from "../src/index.js";

const measure = (eventCount, index = 0) => ({ index, events: Array.from({ length: eventCount }, () => ({ positions: [], duration: "8" })), techniques: [] });

test("an ordinary bar keeps the base measure width", () => {
  assert.equal(measureNaturalWidth(measure(8), 220), 220);
  assert.equal(measureNaturalWidth(measure(0), 220), 220);
});

test("a dense bar grows with its number of events", () => {
  assert.ok(measureNaturalWidth(measure(16), 220) > 220);
  assert.ok(measureNaturalWidth(measure(36), 220) > measureNaturalWidth(measure(16), 220));
});

test("base-width measures still pack measuresPerRow per row", () => {
  const measures = Array.from({ length: 9 }, (_, i) => measure(8, i));
  const rows = packMeasureRows(measures, 220, 4);
  assert.deepEqual(rows.map(row => row.length), [4, 4, 1]);
});

test("a dense measure takes the room of several ordinary ones", () => {
  const measures = [measure(8, 0), measure(8, 1), measure(20, 2), measure(8, 3), measure(8, 4)];
  const rows = packMeasureRows(measures, 220, 4);
  // 220 + 220 + 504 = 944 > 880: the dense bar starts a new row.
  assert.deepEqual(rows.map(row => row.map(m => m.index)), [[0, 1], [2, 3], [4]]);
});

test("a measure wider than a whole row gets a row of its own", () => {
  const measures = [measure(8, 0), measure(40, 1), measure(8, 2)];
  const rows = packMeasureRows(measures, 220, 4);
  assert.deepEqual(rows.map(row => row.map(m => m.index)), [[0], [1], [2]]);
});
