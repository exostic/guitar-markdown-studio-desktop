// Engraves tab and partition blocks with alphaTab from the alphaTex
// translation of their ASCII. alphaTab is loaded on first use (it is a large
// library with its own music font), so documents without notation never pay
// for it.
import { listScoreTracks, scoreToBlocks, scoreToMarkdown, translateTab } from "@gms/guitar-markdown";

let alphaTabModule = null;
// Told after every block finishes rendering (the app restores the preview
// scroll position once all blocks are back).
let renderedHandler = null;

export function onAlphaTabRendered(handler) {
  renderedHandler = handler;
}
// block id → { api, target, beats } (beats: per bar, ASCII event → beat index)
const instances = new Map();

async function loadAlphaTab() {
  if (!alphaTabModule) alphaTabModule = await import("@coderline/alphatab");
  return alphaTabModule;
}

// Bravura and the layout worker are copied next to the built page; under
// file:// (the desktop app) module workers cannot start, so alphaTab lays
// out on the main thread there.
function coreSettings() {
  const fileProtocol = location.protocol === "file:";
  return {
    useWorkers: !fileProtocol,
    fontDirectory: new URL("font/", document.baseURI).href,
    // Paint every system right away: lazily loaded partials stay blank
    // off-screen, which print and export would keep.
    enableLazyLoading: false,
    logLevel: "warning",
  };
}

export function destroyAlphaTabBlocks() {
  for (const { api } of instances.values()) {
    try {
      api.destroy();
    } catch {
      // already gone with its DOM
    }
  }
  instances.clear();
}

// A box over the bar being played, spanning every staff of the block,
// placed from alphaTab's bounds for that bar (relative to its surface).
// Null until the block is rendered.
export function alphaTabBarHighlight(id, measureIndex) {
  const instance = instances.get(id);
  const bounds = instance?.api.renderer?.boundsLookup?.findMasterBarByIndex(measureIndex);
  const surface = instance?.target.querySelector(".at-surface");
  if (!bounds || !surface) return null;
  let box = instance.target.querySelector(".at-bar-highlight");
  if (!box) {
    box = document.createElement("div");
    box.className = "at-bar-highlight";
    instance.target.appendChild(box);
  }
  const { x, y, w, h } = bounds.realBounds;
  box.style.left = `${surface.offsetLeft + x}px`;
  box.style.top = `${surface.offsetTop + y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  return box;
}

// The SVG groups to colour while one ASCII column plays: alphaTab wraps
// each beat's glyphs (note heads on the staff, numbers on the tab) in a
// `g.b<beat id>`, one per staff shown. Empty until the block is rendered
// or when the event has no beat of its own.
export function alphaTabBeatElements(id, measureIndex, eventIndex) {
  const instance = instances.get(id);
  if (!instance) return [];
  const beatIndex = instance.beats[measureIndex]?.[eventIndex];
  if (beatIndex === null || beatIndex === undefined) return [];
  const beat = instance.api.score?.tracks[0]?.staves[0]?.bars[measureIndex]?.voices[0]?.beats[beatIndex];
  if (!beat) return [];
  return [...instance.target.querySelectorAll(`.at-surface g.b${beat.id}`)];
}

// The ASCII column drawn under a point of the block (client coordinates):
// a click on a rest lands on the next played column. Null off the music.
export function alphaTabEventAtPoint(id, clientX, clientY) {
  const instance = instances.get(id);
  const surface = instance?.target.querySelector(".at-surface");
  const lookup = instance?.api.renderer?.boundsLookup;
  if (!surface || !lookup) return null;
  const rect = surface.getBoundingClientRect();
  const beat = lookup.getBeatAtPos(clientX - rect.left, clientY - rect.top);
  if (!beat) return null;
  const measure = beat.voice.bar.index;
  const eventIndex = (instance.beats[measure] ?? []).findIndex(index => index !== null && index >= beat.index);
  return eventIndex >= 0 ? { measure, event: eventIndex } : null;
}

// A Guitar Pro file (.gp3 to .gp5, .gpx, .gp), parsed by alphaTab: the
// score plus a description of its tracks for choosing which to convert.
export async function loadGuitarPro(bytes) {
  const alphaTab = await loadAlphaTab();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());
  return { score, title: score.title || "", tracks: listScoreTracks(score) };
}

// `tracks`: chosen track indexes (null = every usable one). `embed` writes
// blocks to insert into a document instead of a whole document.
export function guitarProMarkdown(score, { tracks = null, embed = false, sourceName = "" } = {}) {
  return embed ? scoreToBlocks(score, { tracks, sourceName }) : scoreToMarkdown(score, { tracks });
}

export function isGuitarProFile(name) {
  return /\.(gp[345x]?|gp)$/i.test(name ?? "");
}

// alphaTab signs every page with a "rendered by alphaTab" line and offers
// no switch for it. It is a partial of its own at the bottom of the
// surface: drop it and give the height back. alphaTab is credited once in
// the README instead. Runs after every render (alphaTab re-renders on
// resize).
function removeCreditLine(target) {
  const surface = target.querySelector(".at-surface");
  if (!surface) return;
  for (const partial of [...surface.children]) {
    if (partial.textContent.trim() !== "rendered by alphaTab") continue;
    const height = partial.getBoundingClientRect().height;
    partial.remove();
    const current = parseFloat(surface.style.height);
    if (current > height) surface.style.height = `${current - height}px`;
  }
}

// `staff` is what to draw: "score", "tabs" or "score tabs".
export async function renderAlphaTabBlock(target, ast, options) {
  const { tex, beats } = translateTab(ast, options);
  target.dataset.alphatex = tex;
  let alphaTab;
  try {
    alphaTab = await loadAlphaTab();
  } catch (error) {
    target.innerHTML = `<div class="block-error"><strong>alphaTab indisponible</strong><p>${error.message}</p></div>`;
    return null;
  }
  if (!target.isConnected) return null;
  const staveProfile = options.staff === "tabs" ? "tab" : options.staff === "score tabs" ? "scoretab" : "score";
  const api = new alphaTab.AlphaTabApi(target, {
    core: coreSettings(),
    display: { layoutMode: "page", staveProfile, scale: options.scale ?? 0.85, justifyLastSystem: false },
    // The document header already states the tuning, and every block is
    // a guitar: no tuning caption, no "Guitare" label at the left.
    notation: { elements: { guitarTuning: false, trackNames: false } },
    player: { playerMode: "disabled" },
  });
  instances.set(target.id, { api, target, beats });
  api.error.on(error => {
    const message = error?.message ?? String(error);
    console.error("[alphaTab]", target.id, message, error);
    target.insertAdjacentHTML("beforeend", `<div class="block-error"><strong>Rendu alphaTab</strong><p>${message}</p></div>`);
  });
  // alphaTab empties its surface when it re-renders (a resize, the font
  // arriving): keep the block's height meanwhile, or the preview pane would
  // lose its scroll position every time.
  api.renderStarted.on(() => {
    const height = target.getBoundingClientRect().height;
    if (height > 0) target.style.minHeight = `${height}px`;
  });
  api.postRenderFinished.on(() => {
    removeCreditLine(target);
    // The placeholder height (from the rebuild or from renderStarted) is no
    // longer needed.
    target.style.minHeight = "";
    target.dataset.rendered = "1";
    renderedHandler?.(target);
  });
  api.tex(tex);
  return api;
}
