import "./style.css";
import styleCssText from "./style.css?raw";
import logoUrl from "./assets/logo.png";
import brandMarkUrl from "./assets/exostic-mark.svg";
import interFontUrl from "./assets/fonts/inter-latin-wght-normal.woff2?url";
import { DEFAULT_MARKDOWN } from "./default-content.js";
import { renderMarkdown, parseFrontMatter, renderQrSvg } from "./markdown.js";
import { renderChordDiagrams } from "@gms/renderer-svguitar";
import { renderFretboardScale } from "@gms/renderer-fretboard";
import { parseTuning } from "@gms/guitar-markdown";
import { bindPlayback, clearRegistry, registerBlock, stopAll, syncSpeedControls, togglePlayPause } from "./audio/playback.js";
import { parseSound } from "./audio/sound.js";
import { setSampler } from "./audio/engine.js";
import { destroyAlphaTabBlocks, freezeAlphaTabBlocks, guitarProMarkdown, isGuitarProFile, loadGuitarPro, onAlphaTabRendered, renderAlphaTabBlock, thawAlphaTabBlocks } from "./alphatab.js";
import { parseStaff } from "./blockOptions.js";
import { downloadFile, getDriveConfig, getFileInfo, listMarkdownFiles, setDriveConfig, shareFile, signOut as driveSignOut, uploadFile } from "./drive.js";
import { OWN_SERVICE_KEY, ownServiceUrl, shortenUrl } from "./shortlink.js";
import { sealText, sealingAvailable, unsealText } from "./sealed.js";
import LZString from "lz-string";

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
      <div><h1>Guitar Markdown Studio</h1><p><a class="brand-link" href="llms.txt" target="_blank" rel="noopener" title="Référence de la syntaxe, lisible par les agents IA">Doc / agents IA</a> · <a class="brand-link" href="confidentialite/" target="_blank" rel="noopener">Confidentialité</a> · <a class="brand-link" href="conditions/" target="_blank" rel="noopener">Conditions</a></p></div>
    </div>
    <div class="actions">
      <span class="dropdown">
        <button id="file-btn" type="button" aria-haspopup="menu" aria-expanded="false">Fichier ▾</button>
        <div class="dropdown-menu" id="file-menu" role="menu" hidden>
          <button id="open-md">Ouvrir…</button>
          <label class="button browser-import" title="Ouvrir un cours Markdown ou importer un fichier Guitar Pro">Importer…<input id="import-file" type="file" accept=".md,.markdown,.gp,.gp3,.gp4,.gp5,.gpx" hidden></label>
          <button id="download-md">Enregistrer .md</button>
          <button id="reset">Exemple</button>
          <hr>
          <div class="dropdown-heading">Google Drive</div>
          <button type="button" data-drive="open">Ouvrir depuis Drive…</button>
          <button type="button" data-drive="save">Enregistrer sur Drive</button>
          <button type="button" data-drive="save-as">Enregistrer sous… (Drive)</button>
          <button type="button" data-drive="settings">Réglages Google…</button>
          <button type="button" id="install-app" hidden>Installer l'application</button>
          <button type="button" data-drive="sign-out">Se déconnecter</button>
        </div>
      </span>
      <span class="dropdown">
        <button id="share-menu-btn" type="button" aria-haspopup="menu" aria-expanded="false">Partager ▾</button>
        <div class="dropdown-menu" id="share-menu" role="menu" hidden>
          <button id="share-btn" type="button">Copier un lien de partage</button>
          <button id="email-btn" type="button">Envoyer par e-mail…</button>
          <button type="button" data-drive="share">Partager sur Drive avec…</button>
        </div>
      </span>
      <button id="print" class="primary">Imprimer / PDF</button>
    </div>
  </header>
  <section class="workspace">
    <button id="edit-toggle" class="edit-toggle" type="button" hidden>✎ Éditer</button>
    <div class="insert-backdrop" id="insert-backdrop" hidden></div>
    <div class="track-picker drive-settings" id="drive-open" role="dialog" aria-modal="true" hidden>
      <div class="insert-menu-heading">Google Drive</div>
      <h2 class="track-picker-title">Ouvrir le cours depuis Google Drive</h2>
      <p class="drive-help" id="drive-open-help">Google Drive demande d'ouvrir un cours dans l'application. Connectez-vous avec votre compte Google pour le lire : l'application ne demande que l'accès aux fichiers qu'elle a créés ou qu'on lui a demandé d'ouvrir.</p>
      <div class="track-picker-actions">
        <button type="button" id="drive-open-cancel">Plus tard</button>
        <button type="button" id="drive-open-ok" class="primary">Ouvrir avec Google</button>
      </div>
    </div>
    <div class="track-picker drive-settings" id="share-password" role="dialog" aria-modal="true" hidden>
      <div class="insert-menu-heading">Partager</div>
      <h2 class="track-picker-title">Mot de passe de partage</h2>
      <p class="drive-help">Avec un mot de passe, le cours est chiffré dans le lien (AES-256, dans votre navigateur) : le raccourcisseur et le message ne voient que des données illisibles, et le destinataire saisit le mot de passe pour l'ouvrir. Le message e-mail le lui indique ; pour un lien copié, communiquez-le vous-même.</p>
      <label class="drive-field">Mot de passe<input type="password" id="share-password-input" autocomplete="off" placeholder="vide : lien sans mot de passe"></label>
      <div class="track-picker-actions">
        <button type="button" id="share-password-cancel">Annuler</button>
        <button type="button" id="share-password-clear">Sans mot de passe</button>
        <button type="button" id="share-password-ok" class="primary">Protéger</button>
      </div>
    </div>
    <div class="track-picker drive-settings" id="unseal-dialog" role="dialog" aria-modal="true" hidden>
      <div class="insert-menu-heading">Cours protégé</div>
      <h2 class="track-picker-title">Ce cours est protégé par un mot de passe</h2>
      <p class="drive-help">Saisis le mot de passe que t'a donné l'auteur du cours. Il n'est envoyé nulle part : le cours est déchiffré ici, dans ton navigateur.</p>
      <label class="drive-field">Mot de passe<input type="password" id="unseal-input" autocomplete="off"></label>
      <p class="drive-help unseal-error" id="unseal-error" hidden>Mot de passe incorrect.</p>
      <div class="track-picker-actions">
        <button type="button" id="unseal-ok" class="primary">Ouvrir</button>
      </div>
    </div>
    <div class="track-picker drive-picker" id="drive-picker" role="dialog" aria-modal="true" hidden>
      <div class="insert-menu-heading">Google Drive</div>
      <h2 class="track-picker-title">Ouvrir un cours</h2>
      <div class="track-picker-list" id="drive-picker-list"></div>
      <div class="track-picker-actions">
        <button type="button" id="drive-picker-cancel">Annuler</button>
      </div>
    </div>
    <div class="track-picker drive-settings" id="drive-settings" role="dialog" aria-modal="true" hidden>
      <div class="insert-menu-heading">Google Drive</div>
      <h2 class="track-picker-title">Réglages Google et liens courts</h2>
      <p class="drive-help">Tout se passe côté client, avec OAuth seulement : aucune clé ni secret. L'application ne demande que l'accès aux fichiers qu'elle a créés (portée <code>drive.file</code>), sans validation Google. Dans la <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">console Google Cloud</a>, activez l'API Drive et créez un identifiant OAuth de type <em>Application Web</em> avec, en origine JavaScript autorisée, l'adresse du site, et en URI de redirection autorisée <code>http://localhost:43110/</code> pour l'application de bureau.</p>
      <label class="drive-field">Identifiant client OAuth (public)<input type="text" id="drive-client-id" placeholder="xxxx.apps.googleusercontent.com" spellcheck="false"></label>
      <label class="drive-field">Service de liens courts (vide : TinyURL)<input type="url" id="shortlink-api" placeholder="https://l.exostic.com" spellcheck="false"></label>
      <div class="track-picker-actions">
        <button type="button" id="drive-settings-cancel">Annuler</button>
        <button type="button" id="drive-settings-ok" class="primary">Enregistrer</button>
      </div>
    </div>
    <div class="track-picker" id="track-picker" role="dialog" aria-modal="true" aria-labelledby="track-picker-title" hidden>
      <div class="insert-menu-heading">Pistes à importer</div>
      <h2 id="track-picker-title" class="track-picker-title"></h2>
      <div class="track-picker-list" id="track-picker-list"></div>
      <div class="track-picker-actions">
        <button type="button" id="track-picker-cancel">Annuler</button>
        <button type="button" id="track-picker-ok" class="primary">Importer</button>
      </div>
    </div>
    <div class="insert-menu" id="insert-menu" role="menu" aria-label="Insérer un composant" hidden>
      <div class="insert-menu-section">
        <div class="insert-menu-heading">Notation</div>
        <button data-insert="tab">Tablature</button>
        <button data-insert="partition">Partition</button>
        <label class="button insert-file" title="Choisir un fichier Guitar Pro : ses pistes sont insérées ici, portée et tablature">Guitar Pro<input id="insert-gp" type="file" accept=".gp,.gp3,.gp4,.gp5,.gpx" hidden></label>
        <button data-insert="chords">Accords</button>
        <button data-insert="rhythm">Rythmique</button>
        <button data-insert="grid">Grille</button>
      </div>
      <div class="insert-menu-section">
        <div class="insert-menu-heading">Théorie</div>
        <button data-insert="scale">Gamme</button>
        <button data-insert="arpeggio">Arpège</button>
        <button data-insert="key">Tonalité</button>
        <button data-insert="circle">Cercle des quintes</button>
        <button data-insert="tuner">Accordeur</button>
      </div>
      <div class="insert-menu-section">
        <div class="insert-menu-heading">Mise en page</div>
        <button data-insert="pagebreak">Saut de page</button>
        <button data-insert="landscapebreak">Saut de page (Poster)</button>
        <button data-insert="columnbreak">Saut de colonne (Poster)</button>
        <button data-insert="columns">Colonnes</button>
        <button data-insert="zoom">Zoom</button>
        <button data-insert="link">Lien</button>
      </div>
    </div>
    <section class="pane editor-pane" id="editor-pane">
      <div class="pane-title pane-title-row" id="editor-pane-title"><span>Markdown</span><span class="pane-title-actions"><button id="clear-md" class="pane-icon" type="button" title="Tout effacer" aria-label="Tout effacer">🗑</button><button id="insert-open" class="insert-open" type="button" title="Insérer un composant" aria-haspopup="menu" aria-expanded="false">+</button></span></div>
      <textarea id="editor" spellcheck="false" wrap="off"></textarea>
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
        <span class="pane-title-actions"><button id="view-only-btn" class="pane-icon pane-icon-neutral" type="button" title="Aperçu client (plein écran)" aria-label="Aperçu client (plein écran)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button></span>
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
// Trash in the Markdown pane title: empty the document, after confirmation.
document.querySelector("#clear-md").addEventListener("click", () => {
  if (editor.value.trim() && !window.confirm("Effacer tout le document ?")) return;
  editor.value = "";
  currentFilePath = null;
  driveFile = null;
  editor.focus();
  update();
  status.textContent = "Document effacé";
});

// ---- Toolbar dropdowns: "Fichier" and "Partager" ----
// A click on the button toggles its menu; a click anywhere else, Escape,
// or choosing an item closes it (the item keeps its own handler).
const dropdowns = [...document.querySelectorAll(".topbar .dropdown")].map(wrap => ({ button: wrap.querySelector("button[aria-haspopup]"), menu: wrap.querySelector(".dropdown-menu") }));
function closeDropdowns() {
  for (const { button, menu } of dropdowns) {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
}
for (const { button, menu } of dropdowns) {
  button.addEventListener("click", event => {
    event.stopPropagation();
    const open = menu.hidden;
    closeDropdowns();
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  menu.addEventListener("click", event => {
    if (event.target.closest("button, label")) closeDropdowns();
  });
}
document.addEventListener("click", event => {
  if (!event.target.closest(".topbar .dropdown")) closeDropdowns();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeDropdowns();
});

// ---- Google Drive: open, save, save as, settings, sign out ----
const driveMenu = document.querySelector("#file-menu");
const drivePicker = document.querySelector("#drive-picker");
const driveSettings = document.querySelector("#drive-settings");
// The Drive file the document came from or was last saved to.
let driveFile = null;

function showModal(modal) {
  modal.hidden = false;
  insertBackdrop.hidden = false;
}
function hideModal(modal) {
  modal.hidden = true;
  insertBackdrop.hidden = true;
  insertBackdrop.onclick = null;
}

function openDriveSettings() {
  document.querySelector("#drive-client-id").value = getDriveConfig().clientId;
  document.querySelector("#shortlink-api").value = ownServiceUrl();
  showModal(driveSettings);
  return new Promise(resolve => {
    const finish = saved => {
      hideModal(driveSettings);
      resolve(saved);
    };
    document.querySelector("#drive-settings-ok").onclick = () => {
      setDriveConfig({ clientId: document.querySelector("#drive-client-id").value.trim() });
      try {
        const api = document.querySelector("#shortlink-api").value.trim();
        if (api) localStorage.setItem(OWN_SERVICE_KEY, api);
        else localStorage.removeItem(OWN_SERVICE_KEY);
      } catch {
        // storage unavailable
      }
      finish(true);
    };
    document.querySelector("#drive-settings-cancel").onclick = () => finish(false);
    insertBackdrop.onclick = () => finish(false);
  });
}

// "aujourd'hui 20:40", "hier 19:46", "15/09/2026" — short enough for a
// phone next to the file name.
function driveDateLabel(iso) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const dayStart = value => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((dayStart(new Date()) - dayStart(date)) / 86_400_000);
  if (days === 0) return `aujourd'hui ${time}`;
  if (days === 1) return `hier ${time}`;
  return date.toLocaleDateString("fr-FR");
}

// The file to open, from the app's own list of the Drive's Markdown files.
// Resolves to { id, name } or null.
async function chooseDriveFile() {
  status.textContent = "Lecture de Google Drive…";
  const files = await listMarkdownFiles();
  const list = document.querySelector("#drive-picker-list");
  list.innerHTML = files.length
    ? files.map(file => `<button type="button" class="track-picker-row drive-file" data-id="${escapeHtml(file.id)}" data-name="${escapeHtml(file.name)}"><span class="track-picker-name">${escapeHtml(file.name)}</span><span class="track-picker-meta">${escapeHtml(driveDateLabel(file.modifiedTime))}</span></button>`).join("")
    : `<p class="drive-empty">Aucun cours enregistré par l'application sur ce Drive. Pour un fichier créé ailleurs, importez-le (Fichier › Importer…) puis enregistrez-le sur Drive : il apparaîtra ici ensuite.</p>`;
  showModal(drivePicker);
  return new Promise(resolve => {
    const finish = chosen => {
      hideModal(drivePicker);
      resolve(chosen);
    };
    list.onclick = event => {
      const row = event.target.closest(".drive-file");
      if (row) finish({ id: row.dataset.id, name: row.dataset.name });
    };
    document.querySelector("#drive-picker-cancel").onclick = () => finish(null);
    insertBackdrop.onclick = () => finish(null);
  });
}

async function ensureDriveConfigured() {
  if (getDriveConfig().clientId) return true;
  return openDriveSettings() && Boolean(getDriveConfig().clientId);
}

async function driveOpen() {
  if (!(await ensureDriveConfigured())) return;
  const chosen = await chooseDriveFile();
  if (!chosen) {
    status.textContent = "";
    return;
  }
  status.textContent = "Téléchargement…";
  editor.value = await downloadFile(chosen.id);
  driveFile = chosen;
  currentFilePath = null;
  update();
  status.textContent = `Drive · ${chosen.name}`;
}

function suggestedDriveName() {
  const { data } = parseFrontMatter(editor.value);
  return `${slugify(data.title || "cours-guitare")}.md`;
}

async function driveSave({ saveAs = false } = {}) {
  if (!(await ensureDriveConfigured())) return;
  let target = driveFile;
  if (saveAs || !target) {
    const name = window.prompt("Nom du fichier sur Google Drive :", target?.name ?? suggestedDriveName());
    if (name === null) return;
    target = { id: saveAs ? null : target?.id ?? null, name: /\.md$/i.test(name.trim()) ? name.trim() : `${name.trim()}.md` };
  }
  status.textContent = "Enregistrement sur Drive…";
  const saved = await uploadFile({ id: target.id, name: target.name, content: editor.value });
  driveFile = { id: saved.id, name: saved.name ?? target.name };
  status.textContent = `Enregistré sur Drive · ${driveFile.name}`;
}

// Share the document's Drive file with another Google account: saves it
// first when it is not on Drive yet, asks for the address and whether the
// person may edit, then Drive sends the invitation.
async function driveShare() {
  if (!(await ensureDriveConfigured())) return;
  if (!driveFile) {
    await driveSave();
    if (!driveFile) return;
  }
  const email = window.prompt(`Partager « ${driveFile.name} » avec (adresse Google) :`, "");
  if (!email) return;
  const address = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    status.textContent = "Adresse e-mail invalide";
    return;
  }
  const canEdit = window.confirm(`Autoriser ${address} à modifier le document ?\n\nOK : modification. Annuler : lecture seule.`);
  status.textContent = "Partage en cours…";
  const granted = await shareFile(driveFile.id, { email: address, role: canEdit ? "writer" : "reader", message: `${driveFile.name} — cours de guitare partagé depuis Guitar Markdown Studio.` });
  status.textContent = `Partagé avec ${granted.emailAddress ?? address} (${canEdit ? "modification" : "lecture"})`;
}

async function onDriveMenu(event) {
  const action = event.target.closest("[data-drive]")?.dataset.drive;
  if (!action) return;
  try {
    if (action === "open") await driveOpen();
    else if (action === "save") await driveSave();
    else if (action === "save-as") await driveSave({ saveAs: true });
    else if (action === "share") await driveShare();
    else if (action === "settings") await openDriveSettings();
    else if (action === "sign-out") {
      driveSignOut();
      driveFile = null;
      status.textContent = "Déconnecté de Google";
    }
  } catch (error) {
    status.textContent = error.message;
    console.error("[drive]", error);
  }
}
driveMenu.addEventListener("click", onDriveMenu);
document.querySelector("#share-menu").addEventListener("click", onDriveMenu);

// "+" in the Markdown pane title opens the menu of components to insert.
const insertOpen = document.querySelector("#insert-open");
const insertMenu = document.querySelector("#insert-menu");
const insertBackdrop = document.querySelector("#insert-backdrop");
function setInsertMenu(open) {
  insertMenu.hidden = !open;
  insertBackdrop.hidden = !open;
  insertOpen.setAttribute("aria-expanded", String(open));
  insertOpen.textContent = open ? "×" : "+";
}
insertOpen.addEventListener("click", event => {
  event.stopPropagation();
  setInsertMenu(insertMenu.hidden);
});
document.addEventListener("click", event => {
  if (!insertMenu.hidden && !insertMenu.contains(event.target)) setInsertMenu(false);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !insertMenu.hidden) setInsertMenu(false);
});
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
// Feedback for the user: a small toast at the bottom of the window, shown
// only while there is something to say. A message ending in "…" is in
// progress and stays until the next one; any other message goes away by
// itself after a few seconds. Written through `status.textContent` from
// everywhere in the app.
const statusToast = document.createElement("div");
statusToast.id = "status";
statusToast.setAttribute("role", "status");
statusToast.setAttribute("aria-live", "polite");
statusToast.hidden = true;
document.body.appendChild(statusToast);
let statusTimer = null;
const status = {
  get textContent() {
    return statusToast.hidden ? "" : statusToast.textContent;
  },
  set textContent(message) {
    clearTimeout(statusTimer);
    const text = String(message ?? "").trim();
    if (!text || text === "Prêt") {
      statusToast.hidden = true;
      statusToast.textContent = "";
      return;
    }
    statusToast.textContent = text;
    statusToast.hidden = false;
    // A long message (a warning with what to do about it) stays longer.
    if (!text.endsWith("…")) statusTimer = setTimeout(() => { statusToast.hidden = true; }, text.length > 60 ? 10_000 : 4500);
  },
};
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

function drawPending(renders) {
  // Notation is engraved by alphaTab, which wraps bars to the width of its
  // host on its own (the preview pane in Web mode, the fixed page otherwise).
  clearRegistry();
  destroyAlphaTabBlocks();
  syncSpeedControls(preview);
  for (const render of renders) {
    registerBlock(render.id, render);
    const target = document.getElementById(render.id);
    if (!target) continue;
    if (render.type === "tab" || render.type === "partition") {
      // A `tab` block shows the tablature, a `partition` block the staff;
      // the front matter `staff` or the block's own `staff:` line overrides.
      renderAlphaTabBlock(target, render.ast, {
        staff: render.staff ?? docSettings.staff ?? (render.type === "tab" ? "tabs" : "score"),
        tempo: render.tempo ?? docSettings.bpm,
        tuning: render.tuning ?? docSettings.tuning,
        capo: render.capo ?? docSettings.capo,
        timeSignature: render.timeSignature ?? docSettings.timeSignature,
        sound: render.sound ?? docSettings.sound,
        grid: render.grid,
      });
      continue;
    }
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
    previewWrapper.append(landscapePage(splitByMarker(pageNodes, "column-break")));
  });
}

function landscapePage(columns) {
  const pageBox = document.createElement("article");
  pageBox.className = "course-page landscape-fit";
  const columnsHost = document.createElement("div");
  columnsHost.className = "landscape-columns";
  columns.forEach(nodes => {
    const column = document.createElement("div");
    column.className = "landscape-column";
    const inner = document.createElement("div");
    inner.className = "landscape-column-inner";
    nodes.forEach(node => inner.append(node));
    column.append(inner);
    columnsHost.append(column);
  });
  pageBox.append(columnsHost);
  return pageBox;
}

// Resolves once every notation block of the view is engraved: alphaTab
// lays out asynchronously, and measuring or printing before it is done
// would see blank blocks. Gives up after a while so a block alphaTab
// cannot draw never blocks anything.
function notationSettled(timeoutMs = 10_000) {
  return new Promise(resolve => {
    const started = performance.now();
    const check = () => {
      if (!previewWrapper.querySelector(".alphatab-host:not([data-rendered])") || performance.now() - started > timeoutMs) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}

// The fit of the Poster pages in progress: print waits for it, and a
// newer render (a higher token) cancels an older one.
let posterLayoutToken = 0;
let posterLayoutReady = Promise.resolve();

// `noGrow`: a column keeps at most the scale it had — used on the passes
// that follow a re-engraving, since a scale that grew would narrow the
// column again and make its notation taller than what was just measured.
function rescaleLandscapeColumns({ noGrow = false } = {}) {
  const usableHeightPx = LANDSCAPE_CONTENT_HEIGHT_MM * MM_TO_PX;
  document.querySelectorAll(".course-page.landscape-fit").forEach(pageBox => {
    // Measure at the true physical landscape width (297mm), not whatever width the
    // responsive on-screen preview happens to be at — text reflow depends on width,
    // so measuring at a shrunk viewport width would compute a scale that doesn't
    // match the actual print output. The fit to a small screen (a transform and
    // shrunk sizes, see fitPosterPageToViewport) is undone meanwhile too: the
    // column widths read below are in the page's own pixels.
    pageBox.style.width = `${PAGE_HEIGHT_MM * MM_TO_PX}px`;
    pageBox.style.height = "";
    pageBox.style.transform = "";
    pageBox.querySelectorAll(".landscape-column-inner").forEach(inner => {
      inner.style.transformOrigin = "top left";
      inner.style.transform = "";
      inner.style.width = "";
      // The column's own content-area width (clientWidth minus its padding)
      // — read via the rendered box itself rather than clientWidth directly,
      // since clientWidth includes padding and inner (a normal-flow child)
      // doesn't render inside that padding.
      const columnWidthPx = inner.getBoundingClientRect().width;
      const ceiling = noGrow && inner.dataset.scale ? Number(inner.dataset.scale) : 1;
      let naturalHeight = inner.scrollHeight;
      // Widening the box to fill the column after scaling (so it doesn't
      // look like it shrunk in both dimensions) can itself change how the
      // content reflows at that new width, which in turn changes how much
      // it needs to shrink — each correction can nudge the next, so iterate
      // a few times until it settles instead of overflowing the column's
      // overflow:hidden bound by a residual few pixels and clipping content.
      for (let i = 0; i < 5; i += 1) {
        // A couple of pixels of slack: the transform rounds, and a column
        // cut by its overflow:hidden bound loses a descender or a beam.
        const scale = Math.max(PAGE_FIT_MIN_SCALE, Math.min(ceiling, (usableHeightPx - 2) / naturalHeight));
        inner.style.transform = `scale(${scale})`;
        inner.dataset.scale = String(scale);
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
    pageBox.style.marginRight = "";
    pageBox.style.marginBottom = "";
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
  // The page keeps its A4 size for layout (its columns must not reflow to
  // a phone's width) and only looks smaller: the transform shrinks it, and
  // negative margins give the space it no longer covers back to the flow.
  pageBoxes.forEach(pageBox => {
    pageBox.style.transformOrigin = "top left";
    pageBox.style.transform = `scale(${scale})`;
    pageBox.style.marginRight = `${-naturalWidth * (1 - scale)}px`;
    pageBox.style.marginBottom = `${-naturalHeight * (1 - scale)}px`;
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
  posterLayoutReady = settleLandscapePages(++posterLayoutToken);
}

// Fits the landscape columns once their content has its final size: fonts
// and images arrive asynchronously, and so does the notation — which is
// also re-engraved whenever the fit widens a column, so fit, let that
// start, wait for it and fit once more. A stale token (another render
// since) stops it.
async function settleLandscapePages(token) {
  let first = true;
  const settle = () => {
    rescaleLandscapeColumns({ noGrow: !first });
    first = false;
    fitPosterPageToViewport();
    // The column width this correction settles on can differ from the one
    // fitChordGrids/fitRhythmBlocks already shrank text to fit — re-run
    // them against the final width, or a grid/rhythm block sized for the
    // stale width can end up overflowing its cell with no further check.
    fitChordGrids();
    fitRhythmBlocks();
    applyZoomScale();
  };
  const pendingImages = [...previewWrapper.querySelectorAll("img")]
    .filter(img => !img.complete)
    .map(img => new Promise(resolve => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    }));
  await Promise.all([document.fonts.ready, ...pendingImages]);
  for (let pass = 0; pass < 2; pass += 1) {
    if (token !== posterLayoutToken || !fitToPage) return;
    settle();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await notationSettled();
  }
  if (token !== posterLayoutToken || !fitToPage) return;
  settle();
  // A column shrunk to the floor still overflows: say which pages, so the
  // author knows where a landscapebreak is due.
  const crowded = [...previewWrapper.querySelectorAll(".course-page.landscape-fit")]
    .map((pageBox, index) => ([...pageBox.querySelectorAll(".landscape-column-inner")].some(inner => Number(inner.dataset.scale) <= PAGE_FIT_MIN_SCALE && inner.getBoundingClientRect().height > inner.parentElement.clientHeight + 1) ? index + 1 : null))
    .filter(Boolean);
  if (crowded.length) status.textContent = `Poster : page${crowded.length > 1 ? "s" : ""} ${crowded.join(", ")} trop chargée${crowded.length > 1 ? "s" : ""}, ajoutez un saut de page (Poster)`;
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
  // A view-only link shows the preview alone: the editor stays hidden
  // whatever the mode (Book and Poster snap the editor width on entry).
  if (viewOnly || compactQuery.matches || workspace.classList.contains("editor-overlay")) return;
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
// The app's banks, fetched once, in the background, at startup: a sampled
// steel-string acoustic (see public/samples/README.md) for the acoustic
// sound, then the General MIDI bank alphaTab ships (copied next to the page
// by its vite plugin) for the electric guitar and any program the first
// bank lacks.
const DEFAULT_SOUNDFONT_URLS = ["samples/acoustic-steel.sf2", "soundfont/sonivox.sf2"].map(path => new URL(path, document.baseURI).href);
setSampler({ enabled: true, urls: DEFAULT_SOUNDFONT_URLS });

let docSettings = { bpm: 80, timeSignature: "4/4", tuning: parseTuning(""), capo: 0, semitones: 0, sound: "acoustic", staff: null };

function refreshDocSettings(data) {
  const transposeMatch = /^([+-]?\d+)$/.exec((data.transpose ?? "").trim());
  docSettings = {
    bpm: Number(/(\d+(?:\.\d+)?)/.exec(data.tempo ?? "")?.[1]) || 80,
    timeSignature: data.time ?? "4/4",
    tuning: parseTuning(data.tuning ?? "") ?? parseTuning(""),
    capo: Number(/(\d+)/.exec(data.capo ?? "")?.[1] ?? 0),
    semitones: transposeMatch ? Number(transposeMatch[1]) : 0,
    sound: parseSound(data.sound ?? data.guitar ?? data.son) ?? "acoustic",
    // `staff: tab` / `partition` / `tab et partition`: what every notation
    // block draws, instead of tab for `tab` and staff for `partition`; a
    // block's own `staff:` line overrides it.
    staff: parseStaff(data.staff ?? data.portee ?? data.portée),
    // `samples: off` keeps the synthesized string; `soundfont: <url>` plays
    // from another SoundFont first, the app's banks filling in what it lacks.
    samples: !/^(off|non|false|0|synth)$/i.test((data.samples ?? "").trim()),
    soundfont: (data.soundfont ?? "").trim() || null,
  };
  setSampler({ enabled: docSettings.samples, urls: docSettings.soundfont ? [new URL(docSettings.soundfont, document.baseURI).href, ...DEFAULT_SOUNDFONT_URLS] : DEFAULT_SOUNDFONT_URLS });
}

// A note clicked in the preview: select its fret in the Markdown and
// scroll the editor to it (the scroll sync is held off meanwhile, or the
// preview would jump too).
function revealColumn(entry, measureIndex, eventIndex) {
  if (editorPane.hidden) return;
  const at = columnPosition(entry, measureIndex, eventIndex);
  if (!at) return;
  const lines = editor.value.split("\n");
  if (at.line >= lines.length) return;
  let offset = 0;
  for (let index = 0; index < at.line; index += 1) offset += lines[index].length + 1;
  const start = offset + at.column;
  const end = start + at.length;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(start, end);
  // The preview must stay where the reader clicked: the scroll event this
  // raises is dispatched later, so the sync is held off until it has passed.
  ignoreEditorScroll = true;
  editor.scrollTop = Math.max(0, caretTop(editor, start) - editor.clientHeight / 2);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ignoreEditorScroll = false;
  }));
}

// Vertical position of a character in the textarea, soft wraps included: a
// hidden mirror with the same font, width and wrapping holds the text up to
// that character, and a marker at its end gives the height.
function caretTop(textarea, index) {
  const mirror = document.createElement("div");
  const style = getComputedStyle(textarea);
  for (const property of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "borderTopWidth", "borderBottomWidth", "boxSizing", "tabSize"]) {
    mirror.style[property] = style[property];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.width = `${textarea.clientWidth}px`;
  // Same wrapping as the textarea: none (long tab lines scroll sideways).
  mirror.style.whiteSpace = textarea.wrap === "off" ? "pre" : "pre-wrap";
  mirror.style.overflowWrap = textarea.wrap === "off" ? "normal" : "break-word";
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

// Where a column sits in the editor: document line, and character column
// on that line. Null when the block cannot be traced back.
function columnPosition(entry, measureIndex, eventIndex) {
  if (entry.sourceLine === null || entry.sourceLine === undefined) return null;
  const measure = entry.ast.measures[measureIndex];
  const position = measure?.events[eventIndex]?.positions[0];
  const source = position && measure.sources?.[position.string];
  if (!source) return null;
  return { line: entry.sourceLine + source.line, column: source.column + position.column, length: position.length ?? 1, position };
}

// While a block plays in Web mode, the preview keeps what is lit up in its
// middle band (a note, a chord diagram, a grid cell, a stroke). The editor
// never moves on its own during playback.
function followPreview(elements) {
  if (!webMode || fitToPage || !elements.length) return;
  const paneRect = previewPane.getBoundingClientRect();
  let top = Infinity;
  let bottom = -Infinity;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (!rect.height) continue;
    top = Math.min(top, rect.top - paneRect.top + previewPane.scrollTop);
    bottom = Math.max(bottom, rect.bottom - paneRect.top + previewPane.scrollTop);
  }
  if (top === Infinity) return;
  const view = previewPane.clientHeight;
  if (top >= previewPane.scrollTop + view * 0.2 && bottom <= previewPane.scrollTop + view * 0.8) return;
  ignorePreviewScroll = true;
  previewPane.scrollTop = Math.max(0, (top + bottom) / 2 - view / 2);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ignorePreviewScroll = false;
  }));
}

bindPlayback({
  preview,
  getSettings: () => docSettings,
  onColumn: revealColumn,
  onPlaying: (entry, cue, elements) => followPreview(elements),
});

// Space pauses and resumes playback (or starts the last block again) when
// the focus is not in a text field.
document.addEventListener("keydown", event => {
  if (event.key !== " " || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target.closest?.("input, textarea, select, button, [contenteditable=\"true\"]")) return;
  if (togglePlayPause()) event.preventDefault();
});

function update() {
  try {
    // Any button the transport is pointing at is about to be destroyed and
    // rebuilt below — an orphaned scheduler with no way to click-to-stop it
    // would otherwise keep playing forever.
    stopAll();
    // Rebuilding the preview must not move it: alphaTab blocks come back
    // empty for a moment, which would shrink the pane and clamp its scroll
    // (a long score would jump to its top at every keystroke). Each new host
    // keeps its previous height as a placeholder until it is engraved, the
    // scroll position is put back after the rebuild, and the editor is not
    // synced to any scroll event the rebuild raises.
    const savedScroll = previewPane.scrollTop;
    const previousHeights = new Map([...preview.querySelectorAll(".alphatab-host")].map(host => [host.id, host.getBoundingClientRect().height]));
    ignorePreviewScroll = true;
    const result = renderMarkdown(editor.value);
    preview.innerHTML = result.html;
    for (const host of preview.querySelectorAll(".alphatab-host")) {
      const height = previousHeights.get(host.id);
      if (height) host.style.minHeight = `${height}px`;
    }
    preview.classList.toggle("web-mode", webMode);
    const { data } = parseFrontMatter(editor.value);
    refreshDocSettings(data);
    // Book/Poster are print-oriented and not clickable — a QR to the same
    // document's Web view lets a reader jump straight to the live version
    // from a printed page. Web mode doesn't need it: it's already that view.
    // Front matter `qr: false` opts out entirely (e.g. for private/local docs).
    const headerTopEl = preview.querySelector(".doc-header-top");
    if (!webMode && headerTopEl && data.qr !== "false") {
      // The short link made for this exact content at the last print or
      // export, else the full link (fine for a small course); a course too
      // long for a QR code shows a placeholder until printing, when the
      // short link is fetched — never while typing, so that the shortener
      // only stores links that were actually handed out.
      const webUrl = headerQr?.content === editor.value ? headerQr.url : buildHeaderQrUrl();
      const qrSvg = renderQrSvg(webUrl);
      if (qrSvg) {
        headerTopEl.insertAdjacentHTML(
          "beforeend",
          `<a class="doc-header-qr" href="${escapeHtml(webUrl)}" target="_blank" rel="noopener noreferrer" title="Ouvrir la version web"><span class="doc-header-qr-code">${qrSvg}</span><span class="doc-header-qr-label">Version web</span></a>`,
        );
      } else {
        headerTopEl.insertAdjacentHTML(
          "beforeend",
          `<span class="doc-header-qr doc-header-qr-pending" title="Le QR code est généré à l'impression, avec un lien court"><span class="doc-header-qr-code doc-header-qr-placeholder"></span><span class="doc-header-qr-label">QR généré à l'impression</span></span>`,
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
    // Put the scroll back now, and again once every block is engraved: a
    // block without a placeholder (new, or grown) leaves the pane too short
    // for the position until then.
    previewPane.scrollTop = savedScroll;
    pendingPreviewScroll = preview.querySelector(".alphatab-host:not([data-rendered])") ? savedScroll : null;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ignorePreviewScroll = false;
    }));
    // The draft is kept in session storage for a reload; no status for it,
    // "saved" would read as saved to a file.
    sessionStorage.setItem(STORAGE_KEY, editor.value);
  } catch (error) {
    ignorePreviewScroll = false;
    status.textContent = "Erreur";
    preview.innerHTML = `<div class="block-error">${error.message}</div>`;
  }
}

let debounce;
editor.addEventListener("input", () => {
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
// Set while the editor is scrolled programmatically (a note revealed from
// the preview): that scroll must not drag the preview along. The same for
// the preview while it is rebuilt.
let ignoreEditorScroll = false;
let ignorePreviewScroll = false;
// Preview scroll position to restore when the last block finishes engraving.
let pendingPreviewScroll = null;
onAlphaTabRendered(() => {
  if (pendingPreviewScroll === null || preview.querySelector(".alphatab-host:not([data-rendered])")) return;
  const target = pendingPreviewScroll;
  pendingPreviewScroll = null;
  ignorePreviewScroll = true;
  previewPane.scrollTop = target;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ignorePreviewScroll = false;
  }));
});
function scrollRatio(el) {
  return el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
}
function applyScrollRatio(el, ratio) {
  el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
}
editor.addEventListener("scroll", () => {
  if (fitToPage || syncingScroll || ignoreEditorScroll) return;
  syncingScroll = true;
  applyScrollRatio(previewPane, scrollRatio(editor));
  syncingScroll = false;
});
previewPane.addEventListener("scroll", () => {
  if (fitToPage || syncingScroll || ignorePreviewScroll) return;
  syncingScroll = true;
  applyScrollRatio(editor, scrollRatio(previewPane));
  syncingScroll = false;
});

document.querySelectorAll("[data-insert]").forEach(button => button.addEventListener("click", () => {
  editor.setRangeText(snippets[button.dataset.insert], editor.selectionStart, editor.selectionEnd, "end");
  setInsertMenu(false);
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

// The header QR of the last print or export: the short link and the
// content it was made for.
let headerQr = null;

// Before printing or exporting: the short link of the content as it is
// now (same content, same alias, so nothing new is stored for a reprint).
// A course opened from a hosted URL keeps its ?src= link, which is short
// already. Failures fall back to the full link or the placeholder.
async function prepareHeaderQr() {
  const { data } = parseFrontMatter(editor.value);
  if (data.qr === "false" || currentSrcUrl) return;
  if (headerQr?.content === editor.value) return;
  const content = editor.value;
  status.textContent = "Préparation du QR code…";
  try {
    const link = await shareLink();
    if (link?.url) headerQr = { content, url: link.url };
  } catch (error) {
    console.warn("[qr] lien court impossible :", error);
  }
  status.textContent = "";
}

// Before printing: every notation block engraved, and the Poster pages
// fitted.
async function previewSettled() {
  await notationSettled();
  await posterLayoutReady;
}

// Prints (or exports to PDF on the desktop) with the notation blocks
// frozen meanwhile — see freezeAlphaTabBlocks. Cmd+P goes through the
// same freeze by the beforeprint/afterprint events.
async function printFrozen(fileName) {
  freezeAlphaTabBlocks();
  try {
    if (window.gmsDesktop) {
      const result = await window.gmsDesktop.exportPdf(fileName);
      if (result) status.textContent = "PDF exporté";
    } else {
      window.print();
    }
  } finally {
    thawAlphaTabBlocks();
  }
}
window.addEventListener("beforeprint", freezeAlphaTabBlocks);
window.addEventListener("afterprint", thawAlphaTabBlocks);

async function printAsMode(targetMode) {
  stopAll();
  await prepareHeaderQr();
  const previousFitToPage = fitToPage;
  const previousWebMode = webMode;
  fitToPage = targetMode === "landscape";
  webMode = false;
  update();
  await previewSettled();
  const { data } = parseFrontMatter(editor.value);
  await printFrozen(`${slugify(data.title)}.pdf`);
  fitToPage = previousFitToPage;
  webMode = previousWebMode;
  update();
}

async function printCurrent() {
  stopAll();
  await prepareHeaderQr();
  update();
  await previewSettled();
  const { data } = parseFrontMatter(editor.value);
  await printFrozen(`${slugify(data.title)}.pdf`);
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

// The document travels in the URL fragment (#doc=…): the fragment is
// never sent to the server, so the link escapes the 8 KB limit GitHub
// Pages puts on the query string; only the browser's own limit (2 MB in
// Chrome) remains. Older links carried it in the query (?doc=…): both are
// read, the fragment taking precedence.
function urlParams() {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.includes("=")) for (const [key, value] of new URLSearchParams(hash)) params.set(key, value);
  return params;
}

// Rewrites the view-state parameters where the document lives: in the
// fragment when the URL carries one, else in the query.
function writeViewParams(mutate, { push = false } = {}) {
  const hash = window.location.hash.replace(/^#/, "");
  const inHash = hash.includes("=");
  const params = new URLSearchParams(inHash ? hash : window.location.search);
  mutate(params);
  const text = params.toString();
  const url = inHash
    ? `${window.location.pathname}${window.location.search}${text ? `#${text}` : ""}`
    : `${window.location.pathname}${text ? `?${text}` : ""}${window.location.hash}`;
  (push ? history.pushState : history.replaceState).call(history, null, "", url);
}

function buildShareUrl(mode) {
  const params = new URLSearchParams();
  params.set("doc", toBase64(editor.value));
  params.set("mode", mode);
  params.set("view", "only");
  params.set("edit", "hide");
  return `${window.location.origin}${window.location.pathname}#${params.toString()}`;
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
  return `${window.location.origin}${window.location.pathname}#${params.toString()}`;
}

// Every "Copier un lien" and "Envoyer par e-mail…" first asks for a
// password (Annuler / Sans mot de passe / Protéger); the last one used is
// offered again for the session. `proceed(password)` runs inside the
// button's own click, so the clipboard and the mail tab keep a user
// gesture (Safari refuses to copy outside one).
let lastSharePassword = "";

function askSharePassword(proceed) {
  const dialog = document.querySelector("#share-password");
  const input = document.querySelector("#share-password-input");
  input.value = lastSharePassword;
  showModal(dialog);
  input.focus();
  const finish = value => {
    hideModal(dialog);
    if (value === null) {
      status.textContent = "";
      return;
    }
    lastSharePassword = value;
    proceed(value);
  };
  document.querySelector("#share-password-ok").onclick = () => finish(input.value);
  document.querySelector("#share-password-clear").onclick = () => finish("");
  document.querySelector("#share-password-cancel").onclick = () => finish(null);
  insertBackdrop.onclick = () => finish(null);
  input.onkeydown = event => { if (event.key === "Enter") finish(input.value); };
}

// The share link for the Web view: sealed under `password` when one is
// given, and as a short alias when the shortener answers, the full link
// otherwise. Resolves to { url, short, sealed }.
async function shareLink(password = "") {
  let full = buildShareUrl("web");
  const sealed = Boolean(password);
  if (sealed) {
    if (!sealingAvailable()) throw new Error("Chiffrement indisponible dans ce navigateur (page non sécurisée ?).");
    const params = new URLSearchParams(new URL(full).hash.slice(1));
    params.delete("doc");
    params.set("enc", await sealText(editor.value, password));
    full = `${window.location.origin}${window.location.pathname}#${params}`;
  }
  try {
    return { url: await shortenUrl(full), short: true, sealed };
  } catch (error) {
    console.warn("[share] lien court impossible, lien complet utilisé", error);
    return { url: full, short: false, sealed };
  }
}

function linkStatus(link, done) {
  const kind = link.short ? "lien court" : "lien court indisponible";
  return `${done} (${kind}${link.sealed ? ", protégé par mot de passe" : ""})`;
}

shareButton.addEventListener("click", () => askSharePassword(copyShareLink));

async function copyShareLink(password) {
  // Always the Web view, regardless of what mode is currently active —
  // that's the format meant for sharing with a student.
  status.textContent = "Préparation du lien…";
  const pending = shareLink(password);
  // Safari only writes to the clipboard within the click: a ClipboardItem
  // fed by a promise keeps the gesture while the alias is being made.
  if (navigator.clipboard?.write && typeof ClipboardItem === "function" && ClipboardItem.supports?.("text/plain") !== false) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": pending.then(link => new Blob([link.url], { type: "text/plain" })) })]);
      status.textContent = linkStatus(await pending, "Lien copié");
      return;
    } catch (error) {
      console.warn("[share] ClipboardItem impossible, copie classique", error);
    }
  }
  let link;
  try {
    link = await pending;
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  const copied = await copyToClipboard(link.url);
  status.textContent = copied ? linkStatus(link, "Lien copié") : "Erreur de copie";
}

// "Envoyer par e-mail…": the mail client opens (new tab on the web) on a
// friendly message with a link to the course, never the course itself:
// Gmail receives a mailto as a URL and answers 400 beyond about 8 KB. The
// link is a short alias of the share link; when the alias cannot be
// made (offline, service down) the full share link goes when it fits,
// and beyond that the Markdown is copied to the clipboard and the
// message asks to paste it.
const MAILTO_LIMIT = 7600;
const EMAIL_RULE = "――――――――――――――――――――――――――――――";

function mailtoFits(mailto) {
  return encodeURIComponent(mailto).length < MAILTO_LIMIT;
}

function emailMessage(link, { sealed = false, password = "" } = {}) {
  const { data } = parseFrontMatter(editor.value);
  const title = data.title || "Cours de guitare";
  const subject = `🎸 Cours de guitare : ${title}`;
  const intro = ["Bonjour,", "", `Je te partage « ${title} », un cours de guitare préparé avec Guitar Markdown Studio.`, ""];
  const features = "Tu y retrouveras les accords, les grilles, les rythmiques, les tablatures et les partitions, et tu pourras écouter chaque morceau note par note.";
  const outro = ["", "Bonne musique ! 🎸", ""];
  // The link alone on its line: a mailto body is plain text, mail clients
  // turn a bare URL into a link when they display the message.
  const withLink = [...intro, "Ouvre-le ici, il s'affiche directement :", "", link, "", ...(sealed ? [`Le cours est protégé par un mot de passe : ${password}`, ""] : []), features, ...outro];
  const paste = [
    ...intro,
    `Pour le lire, l'écouter et l'imprimer : ouvre https://gms.exostic.com, efface l'exemple (la corbeille du panneau Markdown) et colle le texte qui suit le trait ci-dessous. ${features}`,
    ...outro,
    EMAIL_RULE,
    "",
  ];
  return { subject, withLink: withLink.join("\n"), paste: paste.join("\n") };
}

async function shareByEmail(password) {
  status.textContent = "Préparation du lien…";
  const link = await shareLink(password);
  const message = emailMessage(link.url, { sealed: link.sealed, password });
  const mailtoFor = body => `mailto:?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(body)}`;
  let mailto = mailtoFor(message.withLink);
  let note = linkStatus(link, "Message prêt dans ta messagerie");
  if (!mailtoFits(mailto)) {
    const copied = await copyToClipboard(editor.value);
    if (!copied) throw new Error("Lien court indisponible, cours trop long pour un e-mail et copie impossible : partage-le par Drive.");
    mailto = mailtoFor(message.paste);
    note = "Cours copié : colle-le à la fin du message";
  }
  if (window.gmsDesktop?.shareByEmail) await window.gmsDesktop.shareByEmail({ mailto });
  else window.open(mailto, "_blank", "noopener");
  status.textContent = note;
}
document.querySelector("#email-btn").addEventListener("click", () => askSharePassword(password => shareByEmail(password).catch(error => { status.textContent = error.message; console.error("[share]", error); })));

function syncViewStateFromUrl() {
  const params = urlParams();
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
  // pushState, not replaceState — so the browser's back button has an
  // actual previous entry (the editing view) to return to.
  writeViewParams(params => {
    params.set("view", "only");
    params.set("mode", currentModeToken());
  }, { push: true });
});
voExitEditButton.addEventListener("click", () => {
  viewOnly = false;
  applyCompactMode();
  writeViewParams(params => params.delete("view"));
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

async function fetchDataUrl(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// alphaTab draws its music symbols as text in a font it registers as
// "alphaTab" (Bravura) through a stylesheet of its own; the export has no
// such stylesheet, so declare the family again with the font embedded.
async function inlineAlphaTabFontFace() {
  if (!preview.querySelector(".at-surface")) return "";
  try {
    const dataUrl = await fetchDataUrl(new URL("font/Bravura.woff2", document.baseURI));
    // Prefer alphaTab's own rules (glyph size, overflow) with the font
    // sources swapped for the embedded one; fall back to a copy of them.
    const live = [...document.querySelectorAll("style")].map(el => el.textContent).find(text => /font-family:\s*'alphaTab'/.test(text));
    if (live) return live.replace(/src:\s*url\([^;]*;/, `src: url("${dataUrl}") format("woff2");`);
    return `@font-face { font-family: "alphaTab"; font-display: block; src: url("${dataUrl}") format("woff2"); }
.at-surface.at .at { font-family: "alphaTab"; speak: none; font-style: normal; font-weight: normal; font-variant: normal; text-transform: none; line-height: 1; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; font-size: 36px; overflow: visible !important; }`;
  } catch {
    return "";
  }
}

async function inlineInterFontFace() {
  // style.css declares Inter Variable with a relative url() that only resolves
  // inside the running app; re-declare it after the stylesheet with the font
  // embedded as a data URI so the standalone export keeps the same typeface.
  try {
    const dataUrl = await fetchDataUrl(interFontUrl);
    return `@font-face { font-family: "Inter Variable"; font-style: normal; font-weight: 100 900; src: url("${dataUrl}") format("woff2-variations"); }`;
  } catch {
    return "";
  }
}

async function buildWebExportDocument(title) {
  stopAll();
  const interFontFace = await inlineInterFontFace();
  const alphaTabFontFace = await inlineAlphaTabFontFace();
  // The export ships no JavaScript: play buttons and tuner strings would be
  // dead, so the `export-static` class hides them (CSS) and the tuner falls
  // back to its printable table. Highlight state is stripped as well.
  const exported = preview.cloneNode(true);
  exported.querySelectorAll(".playing, .active").forEach(el => el.classList.remove("playing", "active"));
  exported.querySelectorAll(".at-bar-highlight, .at-beat-cursor").forEach(el => el.remove());
  exported.querySelectorAll("[data-alphatex]").forEach(el => delete el.dataset.alphatex);
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || "Cours de guitare")}</title>
<meta name="theme-color" content="#0b012e">
<style>${styleCssText}${interFontFace}${alphaTabFontFace}</style>
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
  await prepareHeaderQr();
  update();
  await previewSettled();
  await printFrozen(`${slugify(data.title)}.pdf`);
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
    if (result.bytes) {
      // A Guitar Pro file: translated and added to the current document.
      await importGuitarPro(Uint8Array.from(atob(result.bytes), char => char.charCodeAt(0)), { sourceName: result.filePath.split(/[\\/]/).pop() });
      return;
    }
    currentFilePath = result.filePath;
    editor.value = result.content;
    update();
    status.textContent = "Fichier ouvert";
  });
} else {
  openButton.remove();
}

// Which tracks of a Guitar Pro file to convert. One usable track needs no
// question; otherwise a dialog lists them all, the usable ones ticked, and
// resolves to the chosen indexes, or null when cancelled.
const trackPicker = document.querySelector("#track-picker");
const trackPickerList = document.querySelector("#track-picker-list");
function chooseTracks(title, tracks) {
  const usable = tracks.filter(track => track.eligible);
  if (usable.length <= 1) return Promise.resolve(usable.map(track => track.index));
  document.querySelector("#track-picker-title").textContent = title || "Fichier Guitar Pro";
  trackPickerList.innerHTML = tracks.map(track => `<label class="track-picker-row${track.eligible ? "" : " disabled"}">
    <input type="checkbox" value="${track.index}" ${track.eligible ? "checked" : "disabled"}>
    <span class="track-picker-name">${escapeHtml(track.name)}</span>
    <span class="track-picker-meta">${escapeHtml(track.instrument)} · ${track.bars} mesures · ${track.notes} notes${track.reason ? ` · ${escapeHtml(track.reason)}` : ""}</span>
  </label>`).join("");
  trackPicker.hidden = false;
  insertBackdrop.hidden = false;
  return new Promise(resolve => {
    const finish = chosen => {
      trackPicker.hidden = true;
      insertBackdrop.hidden = true;
      document.querySelector("#track-picker-ok").onclick = null;
      document.querySelector("#track-picker-cancel").onclick = null;
      insertBackdrop.onclick = null;
      resolve(chosen);
    };
    document.querySelector("#track-picker-ok").onclick = () => finish([...trackPickerList.querySelectorAll("input:checked")].map(input => Number(input.value)));
    document.querySelector("#track-picker-cancel").onclick = () => finish(null);
    insertBackdrop.onclick = () => finish(null);
  });
}

// Guitar Pro → Markdown, never at the expense of what is already written:
// the song goes in as blocks carrying their own settings, at the cursor
// (`at: "cursor"`, the "+" menu) or as a new section at the end of the
// document (`at: "end"`, Importer/Ouvrir). Only an empty editor gets a
// whole new document with front matter. Warnings (ignored tracks, meter
// changes) are written above the blocks.
async function importGuitarPro(bytes, { at = "end", sourceName = "" } = {}) {
  status.textContent = "Import Guitar Pro…";
  try {
    const { score, title, tracks } = await loadGuitarPro(bytes);
    const chosen = await chooseTracks(title, tracks);
    if (!chosen) {
      status.textContent = "Import annulé";
      return;
    }
    const empty = editor.value.trim() === "";
    const { markdown, warnings } = guitarProMarkdown(score, { tracks: chosen, embed: !empty, sourceName });
    if (empty) {
      currentFilePath = null;
      editor.value = markdown;
    } else if (at === "cursor") {
      const before = editor.selectionStart > 0 && editor.value[editor.selectionStart - 1] !== "\n" ? "\n\n" : "\n";
      editor.setRangeText(`${before}${markdown}\n`, editor.selectionStart, editor.selectionEnd, "end");
      editor.focus();
    } else {
      const heading = `## ${title || sourceName || "Guitar Pro"}`;
      editor.value = `${editor.value.replace(/\s+$/, "")}\n\n${heading}\n\n${markdown}`;
      editor.setSelectionRange(editor.value.length, editor.value.length);
    }
    update();
    const verb = empty ? "importé" : at === "cursor" ? "inséré" : "ajouté";
    status.textContent = warnings.length ? `Guitar Pro ${verb} (${warnings.length} remarque${warnings.length > 1 ? "s" : ""})` : `Guitar Pro ${verb}`;
  } catch (error) {
    status.textContent = "Fichier Guitar Pro illisible";
    console.error("[import guitar pro]", error);
  }
}

// "Guitar Pro" component: the file's tracks are inserted at the cursor
// as blocks carrying their own tempo, meter, tuning and sound.
document.querySelector("#insert-gp").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  setInsertMenu(false);
  if (!file) return;
  await importGuitarPro(new Uint8Array(await file.arrayBuffer()), { at: "cursor", sourceName: file.name });
});

document.querySelector("#import-file")?.addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = "";
  if (isGuitarProFile(file.name)) {
    await importGuitarPro(new Uint8Array(await file.arrayBuffer()), { sourceName: file.name });
    return;
  }
  editor.value = await file.text();
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
  const params = urlParams();
  const doc = params.get("doc");
  const b64 = params.get("b64");
  const src = params.get("src");
  const enc = params.get("enc");
  const driveState = parseDriveState(params.get("state"));
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
  } else if (enc) {
    setViewMode(requestedMode);
    await openSealedDocument(enc);
    return;
  } else if (driveState) {
    setViewMode(requestedMode);
    await openFromDriveUi(driveState);
    return;
  }
  setViewMode(requestedMode);
}

// Drive's "Ouvrir avec" menu opens the app with ?state={"ids":[…],
// "action":"open"} ("create" from its "Nouveau" menu, with a folderId);
// Google grants the app access to those files for this user.
function parseDriveState(text) {
  if (!text) return null;
  try {
    const state = JSON.parse(text);
    if (state.action === "open" && Array.isArray(state.ids) && state.ids.length) return { action: "open", id: String(state.ids[0]) };
    if (state.action === "create") return { action: "create", folderId: state.folderId ?? null };
  } catch {
    // not Drive's state
  }
  return null;
}

// Google must be asked from a click (the sign-in opens a popup), so a
// dialog explains and offers to open the file. Once read, the file
// becomes the document's Drive file: "Enregistrer (Drive)" writes it
// back when the person may edit it.
async function openFromDriveUi(state) {
  history.replaceState(null, "", window.location.pathname);
  if (state.action === "create") {
    status.textContent = "Nouveau cours : enregistrez-le sur Drive quand il est prêt";
    return;
  }
  const dialog = document.querySelector("#drive-open");
  showModal(dialog);
  const accepted = await new Promise(resolve => {
    document.querySelector("#drive-open-ok").onclick = () => resolve(true);
    document.querySelector("#drive-open-cancel").onclick = () => resolve(false);
    insertBackdrop.onclick = () => resolve(false);
  });
  hideModal(dialog);
  if (!accepted) return;
  try {
    status.textContent = "Ouverture depuis Google Drive…";
    const info = await getFileInfo(state.id);
    editor.value = await downloadFile(state.id);
    driveFile = info.canEdit ? { id: info.id, name: info.name } : null;
    update();
    status.textContent = info.canEdit ? `Ouvert depuis Drive · ${info.name}` : `Ouvert depuis Drive en lecture seule · ${info.name} (Enregistrer sous… pour votre copie)`;
  } catch (error) {
    status.textContent = `Impossible d'ouvrir ce cours : ${error.message}`;
    console.error("[drive] ouverture depuis Drive :", error);
  }
}

// A password-protected link: ask for the password until the course opens.
async function openSealedDocument(enc) {
  const dialog = document.querySelector("#unseal-dialog");
  const input = document.querySelector("#unseal-input");
  const errorLine = document.querySelector("#unseal-error");
  editor.value = "";
  update();
  showModal(dialog);
  insertBackdrop.onclick = null;
  input.focus();
  const attempt = async () => {
    errorLine.hidden = true;
    if (!input.value) return;
    status.textContent = "Déchiffrement…";
    try {
      const text = await unsealText(enc, input.value);
      if (text === null) {
        errorLine.hidden = false;
        status.textContent = "";
        input.select();
        return;
      }
      hideModal(dialog);
      editor.value = text;
      update();
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message;
      console.error("[share] lien protégé :", error);
    }
  };
  document.querySelector("#unseal-ok").onclick = attempt;
  input.onkeydown = event => { if (event.key === "Enter") attempt(); };
}

loadFromQueryParams();
// A link to the same page that differs only by its fragment does not
// reload the page: when such a link carries a document, load it.
window.addEventListener("hashchange", () => {
  if (/(^#|&)(doc|enc|b64|src)=/.test(window.location.hash)) loadFromQueryParams();
});

// Installable web app: the service worker (production, web only) makes
// Chrome offer "Installer" in the address bar; the Fichier menu offers it
// too once the browser says the app qualifies.
if (import.meta.env.PROD && "serviceWorker" in navigator && !window.gmsDesktop) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(error => console.warn("[pwa] service worker", error));
}
const installButton = document.querySelector("#install-app");
let installPrompt = null;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = true;
  status.textContent = outcome === "accepted" ? "Application installée" : "";
});
window.addEventListener("appinstalled", () => { installButton.hidden = true; });
