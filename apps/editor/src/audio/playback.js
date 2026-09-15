// Glue between the preview DOM and the audio engine: one delegated click
// listener handles play buttons, the tempo pill (metronome), tuner strings
// and single chord diagrams; cues from the scheduler drive `.playing`
// highlights on measures, diagrams, grid cells and strokes.
import { alphaTabBarHighlight, alphaTabBeatElements, alphaTabEventAtPoint } from "../alphatab.js";
import { chordsBlockToEvents, gridToEvents, shapeToEvents } from "./chordEvents.js";
import { ensureRunning, pluck, setSound } from "./engine.js";
import { rhythmToEvents } from "./rhythmEvents.js";
import { createTransport } from "./scheduler.js";
import { measureBeatsFor, parseTimeSignature, tabToEvents } from "./tabEvents.js";

const registry = new Map();
const transport = createTransport();
let previewEl = null;
let activeButton = null;
let highlighted = [];
// Practice speed per block (1 = the front matter tempo), keyed by block id
// so it survives the re-render that follows every keystroke. The metronome
// pill keeps the written tempo.
const speeds = new Map();

function speedControlId(select) {
  return select.closest(".block-toolbar")?.querySelector(".play-button")?.dataset.target ?? null;
}

export function getSpeed(id) {
  return speeds.get(id) ?? 1;
}

// Each `.play-speed` select shows its own block's value; called after each
// render, since the selects are rebuilt with the page.
export function syncSpeedControls(root = previewEl) {
  root?.querySelectorAll(".play-speed").forEach(select => {
    select.value = String(getSpeed(speedControlId(select)));
  });
}

export function registerBlock(id, entry) {
  registry.set(id, entry);
}

export function clearRegistry() {
  registry.clear();
}

// One element, or several when a beat is drawn on more than one staff.
function clearHighlight() {
  for (const element of highlighted) element.classList.remove("playing");
  highlighted = [];
}

function setHighlight(target) {
  clearHighlight();
  const elements = (Array.isArray(target) ? target : [target]).filter(Boolean);
  for (const element of elements) element.classList.add("playing");
  highlighted = elements;
}

// Where ▶ Écouter starts in a notation block: the column the reader
// clicked last. Shown in pink while nothing plays; cleared when a play
// reaches the end of the block.
let cursor = null; // { id, measure, event, beat }

function showCursor() {
  if (cursor) setHighlight(alphaTabBeatElements(cursor.id, cursor.measure, cursor.event));
}

export function stopAll() {
  transport.stop();
  clearHighlight();
  activeButton?.classList.remove("active", "paused");
  if (activeButton?.classList.contains("play-button")) activeButton.textContent = PLAY_LABEL;
  activeButton = null;
  previewEl?.querySelectorAll(".playing").forEach(element => element.classList.remove("playing"));
  showCursor();
}

export function isPlaying() {
  return transport.isPlaying();
}

function cueTarget(entry, cue) {
  const host = document.getElementById(entry.id);
  if (!host) return null;
  if (entry.type === "tab" || entry.type === "partition") {
    // The bar box under the note, the note's glyphs on top.
    return [alphaTabBarHighlight(entry.id, cue.measure), ...alphaTabBeatElements(entry.id, cue.measure, cue.event)];
  }
  if (entry.type === "chords") return host.children[cue.item] ?? null;
  if (entry.type === "grid") return host.querySelector(`[data-cell="${cue.row}-${cue.cell}"]`);
  if (entry.type === "rhythm") return host.querySelector(`[data-stroke="${cue.group}-${cue.stroke}"]`);
  return null;
}

// A notation block may carry its own tempo, meter, tuning and capo.
function blockSettings(entry, settings) {
  if (entry.type !== "tab" && entry.type !== "partition") return settings;
  return {
    ...settings,
    bpm: entry.tempo ?? settings.bpm,
    timeSignature: entry.timeSignature ?? settings.timeSignature,
    tuning: entry.tuning ?? settings.tuning,
    capo: entry.capo ?? settings.capo,
  };
}

function buildEvents(entry, docSettings) {
  const settings = blockSettings(entry, docSettings);
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
  let { events, totalBeats } = built;
  // Resume from the cursor when it sits in this block.
  const from = cursor?.id === entry.id ? cursor.beat : 0;
  if (from > 0) {
    events = events.filter(event => event.beat >= from - 1e-6).map(event => ({ ...event, beat: event.beat - from }));
    totalBeats -= from;
  }
  await ensureRunning();
  setSound(entry.sound ?? settings.sound);
  stopAll();
  const started = transport.play({
    events,
    bpm: blockSettings(entry, settings).bpm * getSpeed(entry.id),
    totalBeats,
    loop: built.loop,
    id: entry.id,
    onCue: cue => {
      const target = cueTarget(entry, cue);
      setHighlight(target);
      onPlaying?.(entry, cue, (Array.isArray(target) ? target : [target]).filter(Boolean));
    },
    onEnd: () => {
      if (cursor?.id === entry.id) cursor = null;
      stopAll();
    },
  });
  if (!started) return;
  activeButton = button;
  lastStarted = { button, entry };
  button.classList.add("active");
}

// Space: pause or resume what plays; with nothing playing, start the last
// block played (or the one holding the cursor) again. Returns false when
// there was nothing to do, so the key can keep its normal meaning.
export function togglePlayPause() {
  if (transport.isPlaying() && activeButton?.classList.contains("play-button")) {
    if (transport.isPaused()) {
      transport.resume();
      activeButton.classList.remove("paused");
      activeButton.textContent = PLAY_LABEL;
    } else {
      transport.pause();
      activeButton.classList.add("paused");
      activeButton.textContent = PAUSED_LABEL;
    }
    return true;
  }
  const target = lastStarted && document.body.contains(lastStarted.button) ? lastStarted : null;
  const cursorEntry = cursor ? registry.get(cursor.id) : null;
  const cursorButton = cursorEntry ? previewEl?.querySelector(`.play-button[data-target="${cursor.id}"]`) : null;
  const pick = cursorButton ? { button: cursorButton, entry: cursorEntry } : target;
  if (!pick || !registry.has(pick.entry.id)) return false;
  startBlock(pick.button, registry.get(pick.entry.id), getSettingsRef());
  return true;
}

let getSettingsRef = () => ({});

// A click on a note: play that column alone, and leave the cursor on it.
let onColumn = null;
// Told about every cue as it plays, with the elements lit up (the editor
// and the preview follow along).
let onPlaying = null;
// The block last started with ▶, so Space can start it again.
let lastStarted = null;
const PLAY_LABEL = "▶ Écouter";
const PAUSED_LABEL = "❚❚ En pause";

async function playColumn(entry, { measure, event: eventIndex }, settings) {
  onColumn?.(entry, measure, eventIndex);
  const built = buildEvents(entry, settings);
  const cueEvent = built?.events.find(e => e.kind === "cue" && e.cue.measure === measure && e.cue.event === eventIndex);
  if (!cueEvent) return;
  const from = cueEvent.beat;
  cursor = { id: entry.id, measure, event: eventIndex, beat: from };
  const notes = built.events
    .filter(e => e.kind !== "cue" && Math.abs(e.beat - from) < 1e-6)
    .map(e => ({ ...e, beat: 0, duration: Math.min(e.duration ?? 1, 2) }));
  await ensureRunning();
  setSound(entry.sound ?? settings.sound);
  stopAll();
  transport.play({
    events: [{ beat: 0, kind: "cue", cue: cueEvent.cue }, ...notes],
    bpm: blockSettings(entry, settings).bpm * getSpeed(entry.id),
    totalBeats: 2,
    loop: false,
    id: `${entry.id}:column`,
    onCue: () => showCursor(),
    onEnd: () => stopAll(),
  });
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
  setSound(settings.sound);
  stopAll();
  const events = shapeToEvents(chord.frets, { tuning: settings.tuning, capo: settings.capo, duration: 2 });
  transport.play({ events, bpm: settings.bpm, totalBeats: 2, loop: false, id: `${host.id}:${index}`, onEnd: () => stopAll() });
  setHighlight(item);
}

// `onColumn(entry, measureIndex, eventIndex)` is told about every note
// clicked in a notation block (the editor moves its cursor there).
export function bindPlayback({ preview, getSettings, onColumn: columnHandler = null, onPlaying: playingHandler = null }) {
  previewEl = preview;
  onColumn = columnHandler;
  onPlaying = playingHandler;
  getSettingsRef = getSettings;
  preview.addEventListener("change", async event => {
    const select = event.target.closest(".play-speed");
    if (!select) return;
    const value = Number(select.value);
    const id = speedControlId(select);
    if (!(value > 0) || !id) return;
    speeds.set(id, value);
    // If that block is playing, it picks the new speed up from the top.
    if (activeButton?.dataset.target !== id) return;
    const entry = registry.get(id);
    if (entry) await startBlock(activeButton, entry, getSettings());
  });
  preview.addEventListener("click", async event => {
    const tunerString = event.target.closest(".tuner-string");
    if (tunerString) {
      const ctx = await ensureRunning();
      setSound(getSettings().sound);
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
    const host = event.target.closest(".alphatab-host");
    if (host && preview.classList.contains("web-mode")) {
      const entry = registry.get(host.id);
      const column = alphaTabEventAtPoint(host.id, event.clientX, event.clientY);
      if (entry && column) await playColumn(entry, column, getSettings());
    }
  });
}
