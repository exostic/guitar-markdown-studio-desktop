// Glue between the preview DOM and the audio engine: one delegated click
// listener handles play buttons, the tempo pill (metronome), tuner strings
// and single chord diagrams; cues from the scheduler drive `.playing`
// highlights on measures, diagrams, grid cells and strokes.
import { chordsBlockToEvents, gridToEvents, shapeToEvents } from "./chordEvents.js";
import { ensureRunning, pluck } from "./engine.js";
import { rhythmToEvents } from "./rhythmEvents.js";
import { createTransport } from "./scheduler.js";
import { measureBeatsFor, parseTimeSignature, tabToEvents } from "./tabEvents.js";

const registry = new Map();
const transport = createTransport();
let previewEl = null;
let activeButton = null;
let highlighted = null;

export function registerBlock(id, entry) {
  registry.set(id, entry);
}

export function clearRegistry() {
  registry.clear();
}

function clearHighlight() {
  highlighted?.classList.remove("playing");
  highlighted = null;
}

function setHighlight(element) {
  clearHighlight();
  if (!element) return;
  element.classList.add("playing");
  highlighted = element;
}

export function stopAll() {
  transport.stop();
  clearHighlight();
  activeButton?.classList.remove("active");
  activeButton = null;
  previewEl?.querySelectorAll(".playing").forEach(element => element.classList.remove("playing"));
}

export function isPlaying() {
  return transport.isPlaying();
}

function cueTarget(entry, cue) {
  const host = document.getElementById(entry.id);
  if (!host) return null;
  if (entry.type === "tab" || entry.type === "partition") return host.querySelector(`[data-measure="${cue.measure}"]`);
  if (entry.type === "chords") return host.children[cue.item] ?? null;
  if (entry.type === "grid") return host.querySelector(`[data-cell="${cue.row}-${cue.cell}"]`);
  if (entry.type === "rhythm") return host.querySelector(`[data-stroke="${cue.group}-${cue.stroke}"]`);
  return null;
}

function buildEvents(entry, settings) {
  const measureBeats = measureBeatsFor(settings.timeSignature);
  const common = { tuning: settings.tuning, capo: settings.capo };
  if (entry.type === "tab" || entry.type === "partition") {
    return { ...tabToEvents(entry.ast, { ...common, timeSignature: settings.timeSignature }), loop: false };
  }
  if (entry.type === "chords") return { ...chordsBlockToEvents(entry.ast, { ...common, measureBeats }), loop: false };
  if (entry.type === "grid") {
    return {
      ...gridToEvents(entry.ast, { measureBeats, key: entry.ast.displayKey, semitones: settings.semitones, capo: settings.capo }),
      loop: false,
    };
  }
  if (entry.type === "rhythm") return { ...rhythmToEvents(entry.ast), loop: true };
  return null;
}

async function startBlock(button, entry, settings) {
  const built = buildEvents(entry, settings);
  if (!built) return;
  await ensureRunning();
  stopAll();
  const started = transport.play({
    events: built.events,
    bpm: settings.bpm,
    totalBeats: built.totalBeats,
    loop: built.loop,
    id: entry.id,
    onCue: cue => setHighlight(cueTarget(entry, cue)),
    onEnd: () => stopAll(),
  });
  if (!started) return;
  activeButton = button;
  button.classList.add("active");
}

async function startMetronome(button, settings) {
  const bpm = Number(button.dataset.bpm) || settings.bpm;
  const { beatsPerMeasure } = parseTimeSignature(settings.timeSignature);
  const events = Array.from({ length: beatsPerMeasure }, (_, beat) => ({ beat, kind: "click", accent: beat === 0 }));
  await ensureRunning();
  stopAll();
  if (!transport.play({ events, bpm, totalBeats: beatsPerMeasure, loop: true, id: "metronome" })) return;
  activeButton = button;
  button.classList.add("active");
}

async function strumDiagram(item, settings) {
  const host = item.closest(".svguitar-host");
  const entry = host ? registry.get(host.id) : null;
  if (!entry) return;
  const index = [...host.children].indexOf(item);
  const chord = entry.ast[index];
  if (!chord) return;
  await ensureRunning();
  stopAll();
  const events = shapeToEvents(chord.frets, { tuning: settings.tuning, capo: settings.capo, duration: 2 });
  transport.play({ events, bpm: settings.bpm, totalBeats: 2, loop: false, id: `${host.id}:${index}`, onEnd: () => stopAll() });
  setHighlight(item);
}

export function bindPlayback({ preview, getSettings }) {
  previewEl = preview;
  preview.addEventListener("click", async event => {
    const tunerString = event.target.closest(".tuner-string");
    if (tunerString) {
      const ctx = await ensureRunning();
      pluck({ midi: Number(tunerString.dataset.midi), time: ctx.currentTime, duration: 2.2 });
      tunerString.classList.add("playing");
      setTimeout(() => tunerString.classList.remove("playing"), 700);
      return;
    }
    const tempo = event.target.closest(".meta-pill-tempo");
    if (tempo) {
      if (activeButton === tempo) stopAll();
      else await startMetronome(tempo, getSettings());
      return;
    }
    const play = event.target.closest(".play-button");
    if (play) {
      if (activeButton === play) {
        stopAll();
        return;
      }
      const entry = registry.get(play.dataset.target);
      if (entry) await startBlock(play, entry, getSettings());
      return;
    }
    const item = event.target.closest(".svguitar-item");
    if (item && preview.classList.contains("web-mode")) await strumDiagram(item, getSettings());
  });
}
