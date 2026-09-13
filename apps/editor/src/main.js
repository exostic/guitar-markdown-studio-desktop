import "./style.css";
import styleCssText from "./style.css?raw";
import logoUrl from "./assets/logo.png";
import brandMarkUrl from "./assets/exostic-mark.svg";
import interFontUrl from "./assets/fonts/inter-latin-wght-normal.woff2?url";
import { DEFAULT_MARKDOWN } from "./default-content.js";
import { renderMarkdown, parseFrontMatter, renderQrSvg } from "./markdown.js";
import { renderTablatureSvg, renderScoreSvg } from "@gms/renderer-vexflow";
import { renderChordDiagrams } from "@gms/renderer-svguitar";
import { renderFretboardScale } from "@gms/renderer-fretboard";
import { parseTuning } from "@gms/guitar-markdown";
import { bindPlayback, clearRegistry, registerBlock, stopAll } from "./audio/playback.js";
import LZString from "lz-string";
import { Bravura } from "../../../node_modules/vexflow/build/esm/src/fonts/bravura.js";
import { Academico } from "../../../node_modules/vexflow/build/esm/src/fonts/academico.js";

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = LZString;

const STORAGE_KEY = "gms:vexflow:document";
const EDITOR_WIDTH_KEY = "gms:editor-width";
const DEFAULT_EDITOR_WIDTH = 420;
const EDITOR_MIN_VISIBLE_WIDTH = 220;
const EDITOR_HIDE_THRESHOLD = 160;
const PREVIEW_MIN_VISIBLE_WIDTH = 160;
const RESIZER_WIDTH = 6;
const COMPACT_BREAKPOINT = "(max-width: 1100px)";
const PAGE_HEIGHT_MM = 297;
const PAGE_WIDTH_MM = 210;
const PRINT_MARGIN_MM = 14;
const MM_TO_PX = 96 / 25.4;
const PAGE_CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - 2 * PRINT_MARGIN_MM;
// Poster's own outer margin is 1rem (matching .landscape-column's left
// padding/gap in style.css — see the comment there), not PRINT_MARGIN_MM.
const LANDSCAPE_MARGIN_PX = 16;
const LANDSCAPE_CONTENT_HEIGHT_MM = PAGE_WIDTH_MM - (2 * LANDSCAPE_MARGIN_PX) / MM_TO_PX;
const PREVIEW_GUTTER_PX = 64;
const PAGE_FIT_MIN_SCALE = 0.35;
const RHYTHM_FIT_MIN_SCALE = 0.4;
const GRID_FIT_MIN_SCALE = 0.45;
const app = document.querySelector("#app");
// The working document lives in sessionStorage so it is scoped to one tab:
// a reload keeps it, but a new tab starts from the example (or from the
// ?doc= / ?b64= / ?src= link that opened it) instead of whatever another tab
// last rendered. Earlier builds kept it in localStorage — read that once so
// an open draft is not lost by the upgrade, then drop it.
const legacySaved = localStorage.getItem(STORAGE_KEY);
if (legacySaved !== null) localStorage.removeItem(STORAGE_KEY);
const saved = sessionStorage.getItem(STORAGE_KEY) ?? legacySaved ?? DEFAULT_MARKDOWN;
let currentFilePath = null;
// The URL the current document was loaded from via ?src=, if any — reused
// by the header QR code so it can link to that (short) address instead of
// embedding the full document, which quickly exceeds what a QR code can
// hold. Deliberately not cleared on further local edits; the QR staying
// slightly stale is a better trade-off than it disappearing entirely.
let currentSrcUrl = null;
let fitToPage = false;
let webMode = false;
let viewOnly = false;
let hideEditButton = false;
let hidePrintButtons = false;
let editorWidth = Number(localStorage.getItem(EDITOR_WIDTH_KEY)) || DEFAULT_EDITOR_WIDTH;
let compactView = "preview";
let toolbarOpen = false;

app.innerHTML = `
<main class="app-shell">
  <header class="topbar">
    <div class="brand">
      <img class="brand-mark" src="${brandMarkUrl}" alt="" width="34" height="34" />
      <div><h1>Guitar Markdown Studio</h1><p>Markdown → AST → SVG VexFlow / SVGuitar · <a class="brand-link" href="llms.txt" target="_blank" rel="noopener" title="Référence de la syntaxe, lisible par les agents IA">Doc / agents IA</a></p></div>
    </div>
    <div class="actions">
      <span id="status">Prêt</span>
      <div class="actions-group">
        <button id="open-md">Ouvrir</button>
        <label class="button browser-import">Importer<input id="import-file" type="file" accept=".md,.markdown" hidden></label>
        <button id="download-md">Enregistrer .md</button>
        <button id="reset">Exemple</button>
      </div>
      <span class="actions-divider"></span>
      <div class="actions-group">
        <button id="share-btn" type="button">Partager</button>
        <button id="view-only-btn" type="button">Aperçu client</button>
      </div>
      <button id="print" class="primary">Imprimer / PDF</button>
    </div>
  </header>
  <nav class="insertbar">
    <span class="insert-label">Insérer</span>
    <div class="insert-group">
      <button data-insert="tab">Tablature</button>
      <button data-insert="partition">Partition</button>
      <button data-insert="chords">Accords</button>
      <button data-insert="rhythm">Rythmique</button>
      <button data-insert="grid">Grille</button>
    </div>
    <span class="insert-divider"></span>
    <div class="insert-group">
      <button data-insert="scale">Gamme</button>
      <button data-insert="arpeggio">Arpège</button>
      <button data-insert="key">Tonalité</button>
      <button data-insert="circle">Cercle des quintes</button>
      <button data-insert="tuner">Accordeur</button>
    </div>
    <span class="insert-divider"></span>
    <div class="insert-group">
      <button data-insert="pagebreak">Saut de page</button>
      <button data-insert="landscapebreak">Saut de page (mode optimisé)</button>
      <button data-insert="columnbreak">Saut de colonne (mode optimisé)</button>
      <button data-insert="columns">Colonnes</button>
      <button data-insert="zoom">Zoom</button>
      <button data-insert="link">Lien</button>
    </div>
    <span class="grow"></span>
  </nav>
  <section class="workspace">
    <button id="edit-toggle" class="edit-toggle" type="button" hidden>✎ Éditer</button>
    <section class="pane editor-pane" id="editor-pane">
      <div class="pane-title" id="editor-pane-title">Markdown</div>
      <textarea id="editor" spellcheck="false"></textarea>
    </section>
    <div class="resizer" id="pane-resizer"></div>
    <section class="pane preview-pane">
      <div class="view-only-toolbar" id="view-only-toolbar" hidden>
        <button id="vo-exit-edit" type="button">✎ Éditer</button>
        <button id="vo-print" type="button" hidden>Imprimer / PDF</button>
        <button id="vo-print-book" type="button" hidden>Imprimer (Livret)</button>
        <button id="vo-print-poster" type="button" hidden>Imprimer (Poster)</button>
      </div>
      <div class="pane-title pane-title-row">
        <span id="preview-pane-title">Preview</span>
        <div class="mode-switch" role="group" aria-label="Mode de mise en page">
          <button id="mode-portrait" class="mode-option" type="button">Book</button>
          <button id="mode-landscape" class="mode-option" type="button">Poster</button>
          <button id="mode-web" class="mode-option" type="button">Web</button>
        </div>
      </div>
      <div id="preview-scale-wrapper">
        <article id="preview" class="course-page"></article>
      </div>
    </section>
  </section>
</main>`;

const editor = document.querySelector("#editor");
const preview = document.querySelector("#preview");
const previewWrapper = document.querySelector("#preview-scale-wrapper");
const workspace = document.querySelector(".workspace");
const previewPane = document.querySelector(".preview-pane");
const editorPane = document.querySelector("#editor-pane");
const resizer = document.querySelector("#pane-resizer");
const editToggle = document.querySelector("#edit-toggle");
const insertbar = document.querySelector(".insertbar");
const topbar = document.querySelector(".topbar");
const editorPaneTitle = document.querySelector("#editor-pane-title");
const previewPaneTitle = document.querySelector("#preview-pane-title");
const previewPaneHeader = previewPaneTitle.closest(".pane-title");
const viewOnlyButton = document.querySelector("#view-only-btn");
const shareButton = document.querySelector("#share-btn");
const viewOnlyToolbar = document.querySelector("#view-only-toolbar");
const voExitEditButton = document.querySelector("#vo-exit-edit");
const voPrintButton = document.querySelector("#vo-print");
const voPrintBookButton = document.querySelector("#vo-print-book");
const voPrintPosterButton = document.querySelector("#vo-print-poster");
const compactQuery = window.matchMedia(COMPACT_BREAKPOINT);
const modePortraitButton = document.querySelector("#mode-portrait");
const modeLandscapeButton = document.querySelector("#mode-landscape");
const modeWebButton = document.querySelector("#mode-web");
const printButton = document.querySelector("#print");
const status = document.querySelector("#status");
editor.value = saved;

const snippets = {
  tab: `\n\`\`\`tab\ne|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|\n\`\`\`\n`,
  partition: `\n\`\`\`partition\ne|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|\n\`\`\`\n`,
  chords: `\n\`\`\`chords\nAm x02210\nC  x32010\nG  320003\n\`\`\`\n`,
  rhythm: `\n\`\`\`rhythm\nB H | B h | B H | h B\n\`\`\`\n`,
  grid: `\n\`\`\`grid\n| Am | F | C | G |\n\`\`\`\n`,
  scale: `\n\`\`\`scale\nscale: A minor pentatonic\nposition: 1\nlabels: notes\n\`\`\`\n`,
  arpeggio: `\n\`\`\`scale\narpeggio: Am7\nfrets: 0-12\n\`\`\`\n`,
  key: `\n\`\`\`key G\n\`\`\`\n`,
  circle: `\n\`\`\`circle G\n\`\`\`\n`,
  tuner: `\n\`\`\`tuner\n\`\`\`\n`,
  pagebreak: `\n\`\`\`pagebreak\n\`\`\`\n`,
  landscapebreak: `\n\`\`\`landscapebreak\n\`\`\`\n`,
  columnbreak: `\n\`\`\`columnbreak\n\`\`\`\n`,
  columns: `\n\`\`\`columns\n\`\`\`\n\n\`\`\`column\n\`\`\`\n\n\`\`\`endcolumns\n\`\`\`\n`,
  zoom: `\n\`\`\`zoom 0.8\n\`\`\`\n\n\`\`\`endzoom\n\`\`\`\n`,
  link: `[Continuer en ligne](https://exemple.com)`,
};

const NOTATION_MEASURE_WIDTH = 220;
// Reference width used only for deciding how many measures fit per row (not
// the actual rendered measure width) — tuned so the default web-mode width
// (760px cap minus its padding, ≈704px) yields exactly 4 measures per row.
const NOTATION_ROW_REFERENCE_WIDTH = 176;

function computeMeasuresPerRow() {
  // Based on the preview's actual rendered content width, not a viewport
  // breakpoint — a desktop window is "wide" but the preview area itself can
  // still be narrow (editor dragged wide, or the compact single-pane view),
  // and notation should wrap to fit whatever room it actually has.
  const style = getComputedStyle(preview);
  const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const availableWidth = preview.clientWidth - paddingX;
  return Math.max(1, Math.floor(availableWidth / NOTATION_ROW_REFERENCE_WIDTH));
}

const PRINT_MODE_MEASURES_PER_ROW = 4;

function drawPending(renders) {
  // In web mode, notation reflows to fit the preview's actual width instead
  // of one continuous print-oriented row — additional measures wrap onto new
  // lines below instead of overflowing. Book and Poster modes use fixed page
  // widths (not responsive to the window), so a plain fixed cap applies there
  // instead of the dynamic width measurement.
  const measuresPerRow = webMode ? computeMeasuresPerRow() : PRINT_MODE_MEASURES_PER_ROW;
  clearRegistry();
  for (const render of renders) {
    registerBlock(render.id, render);
    const target = document.getElementById(render.id);
    if (!target) continue;
    if (render.type === "tab") renderTablatureSvg(render.ast, target, { measureWidth: NOTATION_MEASURE_WIDTH, height: 130, measuresPerRow });
    if (render.type === "partition") renderScoreSvg(render.ast, target, { measureWidth: NOTATION_MEASURE_WIDTH, height: 110, measuresPerRow });
    if (render.type === "chords") renderChordDiagrams(render.ast, target);
    if (render.type === "scale") renderFretboardScale(render.ast, target);
  }
}

function renderPageBreaks() {
  preview.querySelectorAll(".page-break-line").forEach(line => line.remove());
  const pageContentHeightPx = PAGE_CONTENT_HEIGHT_MM * MM_TO_PX;
  const manualBreaks = [...preview.querySelectorAll(".page-break")].map(el => el.offsetTop).sort((a, b) => a - b);
  const boundaries = [0, ...manualBreaks, preview.scrollHeight];

  let pageNumber = 1;
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const segmentStart = boundaries[i];
    const segmentHeight = boundaries[i + 1] - segmentStart;
    const autoBreaksInSegment = Math.max(0, Math.ceil(segmentHeight / pageContentHeightPx) - 1);
    for (let j = 1; j <= autoBreaksInSegment; j += 1) {
      pageNumber += 1;
      const line = document.createElement("div");
      line.className = "page-break-line";
      line.style.top = `${(segmentStart + j * pageContentHeightPx) / MM_TO_PX}mm`;
      line.dataset.page = String(pageNumber);
      preview.append(line);
    }
    if (i < boundaries.length - 2) pageNumber += 1;
  }
}

function splitByMarker(nodes, markerClass) {
  const segments = [[]];
  for (const node of nodes) {
    if (node.nodeType === 1 && node.classList.contains(markerClass)) {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(node);
    }
  }
  return segments;
}

function applyColumnSections() {
  const nodes = [...preview.childNodes];
  const output = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (node.nodeType !== 1 || !node.classList.contains("column-section-start")) {
      output.push(node);
      i += 1;
      continue;
    }

    const groups = [[]];
    i += 1;
    while (i < nodes.length && !nodes[i].classList?.contains("column-section-end")) {
      if (nodes[i].classList?.contains("column-section-sep")) {
        groups.push([]);
      } else {
        groups[groups.length - 1].push(nodes[i]);
      }
      i += 1;
    }
    i += 1; // skip the end marker

    const section = document.createElement("div");
    section.className = "column-section";
    section.style.setProperty("--columns", String(groups.length));
    groups.forEach(groupNodes => {
      const column = document.createElement("div");
      column.className = "column-section-column";
      groupNodes.forEach(groupNode => column.append(groupNode));
      section.append(column);
    });
    output.push(section);
  }

  preview.innerHTML = "";
  output.forEach(node => preview.append(node));
}

function wrapZoomSectionsIn(container) {
  const nodes = [...container.childNodes];
  const output = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (node.nodeType !== 1 || !node.classList.contains("zoom-start")) {
      output.push(node);
      i += 1;
      continue;
    }

    const scale = parseFloat(node.dataset.scale) || 0.8;
    const groupNodes = [];
    i += 1;
    while (i < nodes.length && !nodes[i].classList?.contains("zoom-end")) {
      groupNodes.push(nodes[i]);
      i += 1;
    }
    i += 1; // skip the end marker

    const block = document.createElement("div");
    block.className = "zoom-block";
    block.dataset.scale = String(scale);
    const inner = document.createElement("div");
    inner.className = "zoom-inner";
    groupNodes.forEach(groupNode => inner.append(groupNode));
    block.append(inner);
    output.push(block);
  }

  container.innerHTML = "";
  output.forEach(node => container.append(node));
}

function wrapZoomSections() {
  // applyColumnSections() runs first and may have moved zoom markers inside a
  // .column-section-column, so scan those too, not just the top level.
  wrapZoomSectionsIn(preview);
  preview.querySelectorAll(".column-section-column").forEach(wrapZoomSectionsIn);
}

function applyZoomScale(root = document) {
  // Measured last (after tab/chord SVGs are drawn and any landscape column
  // restructuring/scaling has settled), then the wrapper collapses to the
  // post-scale width AND height — like zooming a window — instead of leaving
  // the unscaled footprint reserved.
  root.querySelectorAll(".zoom-block").forEach(block => {
    const scale = parseFloat(block.dataset.scale) || 0.8;
    const inner = block.querySelector(".zoom-inner");
    inner.style.setProperty("--zoom-scale", String(scale));

    // Chord diagrams repack themselves via --zoom-scale (smaller/larger grid
    // tracks let a different number fit per row instead of just visually
    // scaling whatever row count the full-size layout already decided on),
    // so no transform is needed — the intrinsic resize already reclaims/uses
    // the space.
    const onlyChordBlocks = inner.children.length > 0 && [...inner.children].every(child => child.classList.contains("chord-block"));
    if (onlyChordBlocks) {
      block.style.width = "";
      block.style.height = "";
      inner.style.transform = "";
      inner.style.width = "";
      return;
    }

    block.style.width = "";
    inner.style.transform = "";
    inner.style.width = "";
    const naturalWidth = inner.offsetWidth;
    const naturalHeight = inner.scrollHeight;
    // Lock inner to its natural pixel width so resizing the outer block
    // doesn't also resize (and reflow) inner via the default 100% width —
    // only the transform should scale it, not the layout itself.
    inner.style.width = `${naturalWidth}px`;
    inner.style.transformOrigin = "top left";
    inner.style.transform = `scale(${scale})`;
    block.style.width = `${naturalWidth * scale}px`;
    block.style.height = `${naturalHeight * scale}px`;
  });
}

function fitRhythmBlocks(root = document) {
  root.querySelectorAll(".rhythm-block").forEach(block => {
    block.style.setProperty("--rhythm-scale", "1");
    // Padding, gaps and font sizes all shrink together with --rhythm-scale, so a
    // plain width ratio applies. Font metrics don't scale perfectly linearly, so
    // re-measure and correct over a few passes.
    let scale = 1;
    for (let pass = 0; pass < 4; pass += 1) {
      const natural = block.scrollWidth;
      const available = block.clientWidth;
      if (available <= 0 || natural <= available || scale <= RHYTHM_FIT_MIN_SCALE) break;
      scale = Math.max(RHYTHM_FIT_MIN_SCALE, scale * (available / natural) * 0.98);
      block.style.setProperty("--rhythm-scale", String(scale));
    }
  });
}

function fitChordGrids(root = document) {
  root.querySelectorAll(".chord-grid").forEach(grid => {
    grid.style.setProperty("--grid-scale", "1");
    // Grid cells use minmax(0, 1fr), so their tracks shrink instead of the whole
    // grid overflowing — overflow shows up per-cell instead of on the container.
    let scale = 1;
    for (let pass = 0; pass < 4; pass += 1) {
      const cells = [...grid.querySelectorAll(".grid-cell, .grid-repeat-count")];
      const worstRatio = cells.reduce((worst, cell) => {
        return cell.clientWidth > 0 ? Math.max(worst, cell.scrollWidth / cell.clientWidth) : worst;
      }, 1);
      if (worstRatio <= 1.02 || scale <= GRID_FIT_MIN_SCALE) break;
      scale = Math.max(GRID_FIT_MIN_SCALE, (scale / worstRatio) * 0.98);
      grid.style.setProperty("--grid-scale", String(scale));
    }
  });
}

function setPrintOrientation(isLandscape) {
  let styleTag = document.getElementById("dynamic-page-size");
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "dynamic-page-size";
    document.head.append(styleTag);
  }
  styleTag.textContent = isLandscape ? "@media print { @page { size: A4 landscape; margin: 0; } }" : "";
}

function buildLandscapeStructure() {
  // A landscapebreak starts a new physical landscape page; a columnbreak starts
  // a new column within the current page. pagebreak is portrait-only and is
  // left untouched here (hidden via CSS instead). Both consumed marker types
  // never appear in the final DOM. `preview` itself stays attached (but
  // hidden) so getElementById lookups in drawPending keep working on the next
  // render pass, before its content has been redistributed into page boxes.
  const pages = splitByMarker([...preview.childNodes], "landscape-page-break");
  preview.classList.remove("landscape-fit");
  preview.innerHTML = "";
  preview.style.display = "none";
  previewWrapper.innerHTML = "";
  previewWrapper.append(preview);
  previewWrapper.style.height = "";

  pages.forEach(pageNodes => {
    const pageBox = document.createElement("article");
    pageBox.className = "course-page landscape-fit";

    const columnsHost = document.createElement("div");
    columnsHost.className = "landscape-columns";
    splitByMarker(pageNodes, "column-break").forEach(nodes => {
      const column = document.createElement("div");
      column.className = "landscape-column";
      const inner = document.createElement("div");
      inner.className = "landscape-column-inner";
      nodes.forEach(node => inner.append(node));
      column.append(inner);
      columnsHost.append(column);
    });
    pageBox.append(columnsHost);
    previewWrapper.append(pageBox);
  });
}

function rescaleLandscapeColumns() {
  const usableHeightPx = LANDSCAPE_CONTENT_HEIGHT_MM * MM_TO_PX;
  document.querySelectorAll(".course-page.landscape-fit").forEach(pageBox => {
    // Measure at the true physical landscape width (297mm), not whatever width the
    // responsive on-screen preview happens to be at — text reflow depends on width,
    // so measuring at a shrunk viewport width would compute a scale that doesn't
    // match the actual print output.
    pageBox.style.width = `${PAGE_HEIGHT_MM * MM_TO_PX}px`;
    pageBox.querySelectorAll(".landscape-column-inner").forEach(inner => {
      inner.style.transformOrigin = "top left";
      inner.style.transform = "";
      inner.style.width = "";
      // The column's own content-area width (clientWidth minus its padding)
      // — read via the rendered box itself rather than clientWidth directly,
      // since clientWidth includes padding and inner (a normal-flow child)
      // doesn't render inside that padding.
      const columnWidthPx = inner.getBoundingClientRect().width;
      let naturalHeight = inner.scrollHeight;
      // Widening the box to fill the column after scaling (so it doesn't
      // look like it shrunk in both dimensions) can itself change how the
      // content reflows at that new width, which in turn changes how much
      // it needs to shrink — each correction can nudge the next, so iterate
      // a few times until it settles instead of overflowing the column's
      // overflow:hidden bound by a residual few pixels and clipping content.
      for (let i = 0; i < 5; i += 1) {
        const scale = Math.max(PAGE_FIT_MIN_SCALE, Math.min(1, usableHeightPx / naturalHeight));
        inner.style.transform = `scale(${scale})`;
        // A fixed pixel width, not a percentage — a percentage gets
        // re-resolved against the column's width wherever this renders next
        // (a print/PDF pass in particular can resolve it a pixel or two
        // differently than the screen preview did), reflowing the content
        // again and silently invalidating the scale it was computed from.
        inner.style.width = `${columnWidthPx / scale}px`;
        const settledHeight = inner.scrollHeight;
        if (settledHeight === naturalHeight) break;
        naturalHeight = settledHeight;
      }
    });
    pageBox.style.width = "";
  });
}

function fitPosterPageToViewport() {
  // A view-only link is read on a single screen, not scrolled through while
  // editing — maximize each landscape page, using whichever of width/height
  // is the tighter constraint against the A4-landscape page's own ratio.
  // Must run after rescaleLandscapeColumns, which resets pageBox width to ""
  // at the end of every call.
  const pageBoxes = [...document.querySelectorAll(".course-page.landscape-fit")];
  pageBoxes.forEach(pageBox => {
    pageBox.style.transform = "";
    pageBox.style.width = "";
    pageBox.style.height = "";
  });
  if (!viewOnly || pageBoxes.length === 0) return;
  const naturalWidth = pageBoxes[0].offsetWidth;
  const naturalHeight = pageBoxes[0].offsetHeight;
  const availableWidth = previewPane.clientWidth;
  const availableHeight = previewPane.clientHeight;
  const scale = Math.max(
    PAGE_FIT_MIN_SCALE,
    Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight),
  );
  if (scale >= 1) return;
  pageBoxes.forEach(pageBox => {
    pageBox.style.transformOrigin = "top left";
    pageBox.style.transform = `scale(${scale})`;
    pageBox.style.width = `${naturalWidth * scale}px`;
    pageBox.style.height = `${naturalHeight * scale}px`;
  });
}

function resetPreviewVisibility() {
  preview.classList.remove("landscape-fit");
  preview.style.transform = "";
  preview.style.width = "";
  preview.style.display = "";
  previewWrapper.style.width = "";
  previewWrapper.style.height = "";
  previewWrapper.innerHTML = "";
  previewWrapper.append(preview);
}

function fitBookPageToWidth() {
  // Book mode is deliberately not responsive — the A4 page never reflows —
  // but when the available width is narrower than the page (a narrow
  // preview pane, or a phone in view-only mode), scale the whole page down
  // visually instead of forcing horizontal scrolling.
  preview.style.transform = "";
  preview.style.width = "";
  previewWrapper.style.width = "";
  previewWrapper.style.height = "";
  if (fitToPage || webMode) return;
  const naturalWidth = preview.offsetWidth;
  const naturalHeight = preview.offsetHeight;
  const availableWidth = previewPane.clientWidth;
  if (availableWidth >= naturalWidth) return;
  const scale = Math.max(PAGE_FIT_MIN_SCALE, Math.min(1, availableWidth / naturalWidth));
  preview.style.transformOrigin = "top left";
  preview.style.transform = `scale(${scale})`;
  previewWrapper.style.width = `${naturalWidth * scale}px`;
  previewWrapper.style.height = `${naturalHeight * scale}px`;
}

function applyPageFit() {
  workspace.classList.toggle("landscape-active", fitToPage);
  setPrintOrientation(fitToPage);

  if (!fitToPage) {
    resetPreviewVisibility();
    return;
  }

  buildLandscapeStructure();
  rescaleLandscapeColumns();
  fitPosterPageToViewport();
  // Content images load asynchronously — if one hasn't finished yet at
  // measurement time, the column looks shorter than it truly is, so the
  // computed scale ends up too generous and whatever comes after the image
  // (e.g. a later section) overflows the fixed-height column and gets
  // clipped once the image actually expands. Re-measure once everything is
  // settled to correct for that.
  const pendingImages = [...previewWrapper.querySelectorAll("img")]
    .filter(img => !img.complete)
    .map(img => new Promise(resolve => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    }));
  Promise.all([document.fonts.ready, ...pendingImages]).then(() => {
    if (!fitToPage) return;
    rescaleLandscapeColumns();
    fitPosterPageToViewport();
    // The column width this correction settles on can differ from the one
    // fitChordGrids/fitRhythmBlocks already shrank text to fit — re-run
    // them against the final width, or a grid/rhythm block sized for the
    // stale width can end up overflowing its cell with no further check.
    fitChordGrids();
    fitRhythmBlocks();
  });
}

function applyCompactMode() {
  if (viewOnly) {
    // Read-only sharing link (?view=only): show nothing but the rendered
    // preview, full width, no headers or edit affordances — regardless of
    // viewport size, so it overrides the compact/desktop split below. A
    // small floating toolbar (exit + book/poster print) replaces every
    // hidden control, since the topbar's own print button is unreachable.
    workspace.classList.remove("compact", "editor-overlay");
    topbar.hidden = true;
    insertbar.hidden = true;
    editorPane.hidden = true;
    resizer.hidden = true;
    editToggle.hidden = true;
    editorPaneTitle.hidden = true;
    previewPaneHeader.hidden = true;
    previewPane.hidden = false;
    viewOnlyToolbar.hidden = false;
    voExitEditButton.hidden = hideEditButton;
    updatePrintModeButtons();
    return;
  }
  viewOnlyToolbar.hidden = true;
  editorPaneTitle.hidden = false;
  previewPaneHeader.hidden = false;
  workspace.classList.toggle("compact", compactQuery.matches);
  if (!compactQuery.matches) {
    workspace.classList.remove("editor-overlay");
    insertbar.hidden = false;
    topbar.hidden = false;
    editorPaneTitle.classList.remove("expandable", "expanded");
    previewPaneTitle.classList.remove("expandable", "expanded");
    applyEditorWidth();
    return;
  }
  // Tablet/mobile: a single full-width pane at a time — either the editor or
  // the preview (full A4/optimized/web rendering) — toggled by the same
  // floating button used on desktop. The top action bar (Importer/Enregistrer/
  // Exporter…) starts collapsed and drops down from either pane's header —
  // from "Markdown" it comes with the insert buttons too; from "Preview" it's
  // just the actions, with no editing controls.
  resizer.hidden = true;
  const showEditor = compactView === "edit";
  editorPane.hidden = !showEditor;
  editorPane.style.width = "100%";
  previewPane.hidden = showEditor;
  topbar.hidden = !toolbarOpen;
  insertbar.hidden = !(showEditor && toolbarOpen);
  editorPaneTitle.classList.toggle("expandable", showEditor);
  editorPaneTitle.classList.toggle("expanded", showEditor && toolbarOpen);
  previewPaneTitle.classList.toggle("expandable", !showEditor);
  previewPaneTitle.classList.toggle("expanded", !showEditor && toolbarOpen);
  editToggle.hidden = false;
  editToggle.textContent = showEditor ? "👁 Aperçu" : "✎ Éditer";
}

function applyEditorWidth() {
  // The preview always renders at true A4 size and never shrinks to fit the
  // window — the editor absorbs the squeeze instead, shrinking first and then
  // hiding entirely (behind the floating edit-toggle button) once there's no
  // usable width left for it.
  if (compactQuery.matches || workspace.classList.contains("editor-overlay")) return;
  const available = workspace.clientWidth - RESIZER_WIDTH - PREVIEW_MIN_VISIBLE_WIDTH;
  if (available < EDITOR_HIDE_THRESHOLD) {
    editorPane.hidden = true;
    resizer.hidden = true;
    editToggle.hidden = false;
    editToggle.textContent = "✎ Éditer";
    return;
  }
  editorPane.hidden = false;
  resizer.hidden = false;
  editToggle.hidden = true;
  const width = Math.min(Math.max(editorWidth, EDITOR_MIN_VISIBLE_WIDTH), available);
  editorPane.style.width = `${width}px`;
}

// Playback settings derived from the front matter: tempo (BPM = quarter
// notes), time signature (a 6/8 bar is 3 quarter-beats), tuning, capo,
// transposition and the instrument sound. Rebuilt on every render; read
// lazily by the click handler.
let docSettings = { bpm: 80, timeSignature: "4/4", tuning: parseTuning(""), capo: 0, semitones: 0, sound: "acoustic" };

// `sound:` accepts English or French words: acoustic (default), electric /
// clean, distortion / overdrive / saturé.
export function parseSound(text) {
  const value = (text ?? "").toString().trim().toLowerCase();
  if (/dist|disto|overdrive|drive|satur|crunch|fuzz/.test(value)) return "distortion";
  if (/elec|élec|clean|clair/.test(value)) return "electric";
  return "acoustic";
}

function refreshDocSettings(data) {
  const transposeMatch = /^([+-]?\d+)$/.exec((data.transpose ?? "").trim());
  docSettings = {
    bpm: Number(/(\d+(?:\.\d+)?)/.exec(data.tempo ?? "")?.[1]) || 80,
    timeSignature: data.time ?? "4/4",
    tuning: parseTuning(data.tuning ?? "") ?? parseTuning(""),
    capo: Number(/(\d+)/.exec(data.capo ?? "")?.[1] ?? 0),
    semitones: transposeMatch ? Number(transposeMatch[1]) : 0,
    sound: parseSound(data.sound ?? data.guitar ?? data.son),
  };
}

bindPlayback({ preview, getSettings: () => docSettings });

function update() {
  try {
    // Any button the transport is pointing at is about to be destroyed and
    // rebuilt below — an orphaned scheduler with no way to click-to-stop it
    // would otherwise keep playing forever.
    stopAll();
    const result = renderMarkdown(editor.value);
    preview.innerHTML = result.html;
    preview.classList.toggle("web-mode", webMode);
    const { data } = parseFrontMatter(editor.value);
    refreshDocSettings(data);
    // Book/Poster are print-oriented and not clickable — a QR to the same
    // document's Web view lets a reader jump straight to the live version
    // from a printed page. Web mode doesn't need it: it's already that view.
    // Front matter `qr: false` opts out entirely (e.g. for private/local docs).
    const headerTopEl = preview.querySelector(".doc-header-top");
    if (!webMode && headerTopEl && data.qr !== "false") {
      const webUrl = buildHeaderQrUrl();
      const qrSvg = renderQrSvg(webUrl);
      // A too-long document with no known hosted URL overflows what a QR
      // code can hold — renderQrSvg returns "" in that case; skip quietly
      // rather than show a broken code.
      if (qrSvg) {
        headerTopEl.insertAdjacentHTML(
          "beforeend",
          `<a class="doc-header-qr" href="${escapeHtml(webUrl)}" target="_blank" rel="noopener noreferrer" title="Ouvrir la version web"><span class="doc-header-qr-code">${qrSvg}</span><span class="doc-header-qr-label">Version web</span></a>`,
        );
      }
    }
    document.title = data.title ? slugify(data.title) : "Guitar Markdown Studio";
    applyColumnSections();
    wrapZoomSections();
    // Undo any leftover landscape hiding (preview stays display:none, detached
    // into page boxes, while fitToPage was active) BEFORE measuring/drawing —
    // otherwise a mode switch away from Poster reads a stale clientWidth of 0.
    resetPreviewVisibility();
    drawPending(result.renders);
    if (fitToPage || webMode) {
      preview.querySelectorAll(".page-break-line").forEach(line => line.remove());
    } else {
      renderPageBreaks();
    }
    applyPageFit();
    fitRhythmBlocks();
    fitChordGrids();
    if (!webMode) applyZoomScale();
    fitBookPageToWidth();
    sessionStorage.setItem(STORAGE_KEY, editor.value);
    status.textContent = "Sauvegardé";
  } catch (error) {
    status.textContent = "Erreur";
    preview.innerHTML = `<div class="block-error">${error.message}</div>`;
  }
}

let debounce;
editor.addEventListener("input", () => {
  status.textContent = "Rendu…";
  clearTimeout(debounce);
  debounce = setTimeout(update, 140);
});
let resizeDebounce;
window.addEventListener("resize", () => {
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    applyCompactMode();
    if (webMode) {
      // Re-render from scratch so notation re-measures the preview's new
      // width and re-wraps its measures-per-row accordingly.
      update();
      return;
    }
    if (fitToPage) {
      rescaleLandscapeColumns();
      fitPosterPageToViewport();
    } else {
      renderPageBreaks();
    }
    fitRhythmBlocks();
    fitChordGrids();
    applyZoomScale();
    fitBookPageToWidth();
  }, 140);
});
editor.addEventListener("keydown", event => {
  if (event.key === "Tab") {
    event.preventDefault();
    editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
  }
});

// Sync scroll position (by percentage, not by line) between the editor and the
// preview in standard mode only — in landscape/fit-to-page mode the preview's
// content is restructured into columns/pages, so line order no longer matches.
let syncingScroll = false;
function scrollRatio(el) {
  return el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
}
function applyScrollRatio(el, ratio) {
  el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
}
editor.addEventListener("scroll", () => {
  if (fitToPage || syncingScroll) return;
  syncingScroll = true;
  applyScrollRatio(previewPane, scrollRatio(editor));
  syncingScroll = false;
});
previewPane.addEventListener("scroll", () => {
  if (fitToPage || syncingScroll) return;
  syncingScroll = true;
  applyScrollRatio(editor, scrollRatio(previewPane));
  syncingScroll = false;
});

document.querySelectorAll("[data-insert]").forEach(button => button.addEventListener("click", () => {
  editor.setRangeText(snippets[button.dataset.insert], editor.selectionStart, editor.selectionEnd, "end");
  editor.focus();
  update();
}));

document.querySelector("#reset").addEventListener("click", () => { editor.value = DEFAULT_MARKDOWN; update(); });

let resizingPane = false;
resizer.addEventListener("mousedown", event => {
  resizingPane = true;
  resizer.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  event.preventDefault();
});
window.addEventListener("mousemove", event => {
  if (!resizingPane) return;
  const rect = workspace.getBoundingClientRect();
  editorWidth = event.clientX - rect.left;
  applyEditorWidth();
});
window.addEventListener("mouseup", () => {
  if (!resizingPane) return;
  resizingPane = false;
  resizer.classList.remove("dragging");
  document.body.style.cursor = "";
  localStorage.setItem(EDITOR_WIDTH_KEY, String(editorWidth));
  // The preview's width just changed — re-render so notation re-wraps its
  // measures-per-row to fit the new width, or re-scale the Book page to fit.
  if (webMode) update();
  else fitBookPageToWidth();
});
editToggle.addEventListener("click", () => {
  if (compactQuery.matches) {
    compactView = compactView === "edit" ? "preview" : "edit";
    applyCompactMode();
    return;
  }
  const isOverlay = workspace.classList.toggle("editor-overlay");
  editorPane.hidden = false;
  resizer.hidden = true;
  editToggle.textContent = isOverlay ? "Aperçu" : "✎ Éditer";
  if (!isOverlay) applyEditorWidth();
});
compactQuery.addEventListener("change", applyCompactMode);
editorPaneTitle.addEventListener("click", () => {
  if (!compactQuery.matches || compactView !== "edit") return;
  toolbarOpen = !toolbarOpen;
  applyCompactMode();
});
previewPaneTitle.addEventListener("click", () => {
  if (!compactQuery.matches || compactView === "edit") return;
  toolbarOpen = !toolbarOpen;
  applyCompactMode();
});
function updatePrintModeButtons() {
  // The view-only toolbar has no other way to print at all, since the
  // topbar (and its print button) is hidden entirely. In Book/Poster mode
  // the current layout is already print-ready, so one plain print button
  // covers it; in Web mode printing the flowing layout as-is doesn't make
  // sense, so it gets direct Book/Poster PDF shortcuts instead.
  voPrintButton.hidden = webMode || hidePrintButtons;
  voPrintBookButton.hidden = !webMode || hidePrintButtons;
  voPrintPosterButton.hidden = !webMode || hidePrintButtons;
  // Web mode's view-only toolbar sits as a footer instead of a header —
  // Book/Poster keep it at the top, matching where the normal pane header
  // would be.
  previewPane.classList.toggle("web-toolbar-footer", webMode && viewOnly);
}

function optimizeEditorWidthForMode(mode) {
  // Book/Poster are fixed-size A4 pages (not responsive) — snap the editor
  // pane so the preview area matches the page's on-screen width instead of
  // leaving it arbitrarily wide/narrow from a previous manual drag. Web
  // mode's layout is responsive already, so it's left untouched.
  if (mode === "web") return;
  const targetPageWidthPx = (mode === "landscape" ? PAGE_HEIGHT_MM : PAGE_WIDTH_MM) * MM_TO_PX;
  editorWidth = workspace.clientWidth - RESIZER_WIDTH - targetPageWidthPx - PREVIEW_GUTTER_PX;
  applyEditorWidth();
  localStorage.setItem(EDITOR_WIDTH_KEY, String(editorWidth));
}

function setViewMode(mode) {
  const nextFitToPage = mode === "landscape";
  const nextWebMode = mode === "web";
  fitToPage = nextFitToPage;
  webMode = nextWebMode;
  optimizeEditorWidthForMode(mode);
  modePortraitButton.classList.toggle("active", mode === "standard");
  modePortraitButton.setAttribute("aria-pressed", String(mode === "standard"));
  modeLandscapeButton.classList.toggle("active", mode === "landscape");
  modeLandscapeButton.setAttribute("aria-pressed", String(mode === "landscape"));
  modeWebButton.classList.toggle("active", mode === "web");
  modeWebButton.setAttribute("aria-pressed", String(mode === "web"));
  printButton.textContent = webMode ? "Exporter HTML" : "Imprimer / PDF";
  updatePrintModeButtons();
  update();
}

async function printAsMode(targetMode) {
  stopAll();
  const previousFitToPage = fitToPage;
  const previousWebMode = webMode;
  fitToPage = targetMode === "landscape";
  webMode = false;
  update();
  const { data } = parseFrontMatter(editor.value);
  if (window.gmsDesktop) {
    const result = await window.gmsDesktop.exportPdf(`${slugify(data.title)}.pdf`);
    if (result) status.textContent = "PDF exporté";
  } else {
    window.print();
  }
  fitToPage = previousFitToPage;
  webMode = previousWebMode;
  update();
}

async function printCurrent() {
  stopAll();
  const { data } = parseFrontMatter(editor.value);
  if (window.gmsDesktop) {
    const result = await window.gmsDesktop.exportPdf(`${slugify(data.title)}.pdf`);
    if (result) status.textContent = "PDF exporté";
  } else {
    window.print();
  }
}

function currentModeToken() {
  if (webMode) return "web";
  if (fitToPage) return "poster";
  return "book";
}

function toBase64(text) {
  return compressToEncodedURIComponent(text);
}

function fromBase64(doc) {
  const decompressed = decompressFromEncodedURIComponent(doc);
  if (decompressed !== null) return decompressed;
  // Links shared before compression was added encoded plain base64 — keep those working.
  const binary = atob(doc);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ?b64= carries the document as plain base64 (standard or URL-safe alphabet,
// padding optional). It exists so that tools without lz-string — AI agents in
// particular, see public/llms.txt — can build an opening link unambiguously.
function fromPlainBase64(doc) {
  const normalized = doc.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("navigator.clipboard.writeText a échoué :", error);
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    return true;
  } catch (error) {
    console.error("Copie via execCommand a échoué :", error);
    return false;
  }
}

function buildShareUrl(mode) {
  const params = new URLSearchParams();
  params.set("doc", toBase64(editor.value));
  params.set("mode", mode);
  params.set("view", "only");
  params.set("edit", "hide");
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function buildHeaderQrUrl() {
  // Prefer linking back to the document's own hosted URL when known — far
  // shorter than embedding the whole document, which quickly exceeds what
  // a QR code can encode (a few KB at most) for any real lesson.
  const params = new URLSearchParams();
  if (currentSrcUrl) params.set("src", currentSrcUrl);
  else params.set("doc", toBase64(editor.value));
  params.set("mode", "web");
  params.set("view", "only");
  params.set("edit", "hide");
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

shareButton.addEventListener("click", async () => {
  // Always the Web view, regardless of what mode is currently active —
  // that's the format meant for sharing with a student.
  const copied = await copyToClipboard(buildShareUrl("web"));
  status.textContent = copied ? "Lien copié" : "Erreur de copie";
});

function syncViewStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedMode = VIEW_MODE_PARAM[params.get("mode")] ?? "web";
  viewOnly = params.get("view") === "only";
  hideEditButton = params.get("edit") === "hide";
  hidePrintButtons = params.get("print") === "hide";
  applyCompactMode();
  setViewMode(requestedMode);
}
window.addEventListener("popstate", syncViewStateFromUrl);

viewOnlyButton.addEventListener("click", () => {
  viewOnly = true;
  applyCompactMode();
  const params = new URLSearchParams(window.location.search);
  params.set("view", "only");
  params.set("mode", currentModeToken());
  // pushState, not replaceState — so the browser's back button has an
  // actual previous entry (the editing view) to return to.
  history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
});
voExitEditButton.addEventListener("click", () => {
  viewOnly = false;
  applyCompactMode();
  const params = new URLSearchParams(window.location.search);
  params.delete("view");
  const query = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
});
voPrintButton.addEventListener("click", () => printCurrent());
voPrintBookButton.addEventListener("click", () => printAsMode("standard"));
voPrintPosterButton.addEventListener("click", () => printAsMode("landscape"));
modePortraitButton.setAttribute("aria-pressed", "false");
modeLandscapeButton.setAttribute("aria-pressed", "false");
modeWebButton.setAttribute("aria-pressed", "false");
modePortraitButton.addEventListener("click", () => setViewMode("standard"));
modeLandscapeButton.addEventListener("click", () => setViewMode("landscape"));
modeWebButton.addEventListener("click", () => setViewMode("web"));
function slugify(title) {
  const base = (title ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return base || "cours-guitare";
}
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function inlineLogo(html) {
  // The live app's logo <img> points at a dev-server/build URL that only
  // resolves inside the running app — inline it as a data URI so the
  // exported file renders correctly on its own, with no external assets.
  try {
    const response = await fetch(logoUrl);
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return html.replaceAll(logoUrl, dataUrl);
  } catch {
    return html;
  }
}

const NOTATION_FONT_FACES = `
@font-face { font-family: "Bravura"; src: url("${Bravura}") format("woff2"); }
@font-face { font-family: "Academico"; src: url("${Academico}") format("woff2"); }
`;

async function inlineInterFontFace() {
  // style.css declares Inter Variable with a relative url() that only resolves
  // inside the running app; re-declare it after the stylesheet with the font
  // embedded as a data URI so the standalone export keeps the same typeface.
  try {
    const response = await fetch(interFontUrl);
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return `@font-face { font-family: "Inter Variable"; font-style: normal; font-weight: 100 900; src: url("${dataUrl}") format("woff2-variations"); }`;
  } catch {
    return "";
  }
}

async function buildWebExportDocument(title) {
  stopAll();
  const interFontFace = await inlineInterFontFace();
  // The export ships no JavaScript: play buttons and tuner strings would be
  // dead, so the `export-static` class hides them (CSS) and the tuner falls
  // back to its printable table. Highlight state is stripped as well.
  const exported = preview.cloneNode(true);
  exported.querySelectorAll(".playing, .active").forEach(el => el.classList.remove("playing", "active"));
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || "Cours de guitare")}</title>
<meta name="theme-color" content="#0b012e">
<style>${NOTATION_FONT_FACES}${styleCssText}${interFontFace}</style>
</head>
<body style="background:#0b012e; margin:0; padding:1.5rem 0.75rem;">
<article class="course-page web-mode export-static" style="margin:0 auto;">${exported.innerHTML}</article>
</body>
</html>
`;
  return inlineLogo(html);
}

printButton.addEventListener("click", async () => {
  stopAll();
  const { data } = parseFrontMatter(editor.value);
  if (webMode) {
    const html = await buildWebExportDocument(data.title);
    const fileName = `${slugify(data.title)}.html`;
    if (window.gmsDesktop) {
      const result = await window.gmsDesktop.exportHtml(html, fileName);
      if (result) status.textContent = "HTML exporté";
    } else {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = "HTML exporté";
    }
    return;
  }
  if (window.gmsDesktop) {
    const result = await window.gmsDesktop.exportPdf(`${slugify(data.title)}.pdf`);
    if (result) status.textContent = "PDF exporté";
  } else {
    window.print();
  }
});
document.querySelector("#download-md").addEventListener("click", async () => {
  if (window.gmsDesktop) {
    const result = await window.gmsDesktop.saveMarkdown({ content: editor.value, filePath: currentFilePath });
    if (result) {
      currentFilePath = result.filePath;
      status.textContent = "Fichier enregistré";
    }
    return;
  }
  const blob = new Blob([editor.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cours-guitare.md";
  a.click();
  URL.revokeObjectURL(url);
});

const openButton = document.querySelector("#open-md");
if (window.gmsDesktop) {
  document.querySelector(".browser-import")?.remove();
  openButton.addEventListener("click", async () => {
    const result = await window.gmsDesktop.openMarkdown();
    if (!result) return;
    currentFilePath = result.filePath;
    editor.value = result.content;
    update();
    status.textContent = "Fichier ouvert";
  });
} else {
  openButton.remove();
}

document.querySelector("#import-file")?.addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  editor.value = await file.text();
  event.target.value = "";
  update();
});

const VIEW_MODE_PARAM = { book: "standard", poster: "landscape", web: "web" };

function normalizeSrcUrl(url) {
  // github.com/.../blob/... is GitHub's HTML file-viewer page, not raw text
  // — fetching it would load a webpage instead of the markdown source. If
  // it's the URL you'd naturally copy from GitHub's UI, rewrite it to the
  // equivalent raw.githubusercontent.com URL, which does serve plain text.
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/([^?#]+)/.exec(url);
  if (!match) return url;
  const [, owner, repo, ref, path] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

async function loadFromQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const doc = params.get("doc");
  const b64 = params.get("b64");
  const src = params.get("src");
  const requestedMode = VIEW_MODE_PARAM[params.get("mode")] ?? "web";
  viewOnly = params.get("view") === "only";
  hideEditButton = params.get("edit") === "hide";
  hidePrintButtons = params.get("print") === "hide";
  applyCompactMode();
  if (doc) {
    try {
      editor.value = fromBase64(doc);
    } catch (error) {
      status.textContent = "Erreur de chargement";
      console.error("Impossible de décoder le document :", error);
    }
  } else if (b64) {
    try {
      editor.value = fromPlainBase64(b64);
    } catch (error) {
      status.textContent = "Erreur de chargement";
      console.error("Impossible de décoder le document base64 :", error);
    }
  } else if (src) {
    try {
      status.textContent = "Chargement…";
      const response = await fetch(normalizeSrcUrl(src));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      editor.value = await response.text();
      currentSrcUrl = src;
    } catch (error) {
      status.textContent = "Erreur de chargement";
      console.error("Impossible de charger le document distant :", error);
    }
  }
  setViewMode(requestedMode);
}

loadFromQueryParams();
