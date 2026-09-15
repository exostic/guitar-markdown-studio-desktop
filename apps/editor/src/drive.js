// Google Drive: sign in, list, open and save Markdown documents, entirely
// on the client with OAuth and nothing secret: only the app's public OAuth
// client id, kept in localStorage. On the web the token comes from Google
// Identity Services in the page; in the desktop app the main process runs
// the implicit flow through the system browser and hands the token over.
// Drive itself is plain REST with fetch.
const CONFIG_KEY = "gms:drive-config";
// The app's own OAuth client (public by nature); the settings can override it.
const DEFAULT_CLIENT_ID = "1080726648569-q66a774j7fdtk266slf7poar6snphp0r.apps.googleusercontent.com";
const TOKEN_KEY = "gms:drive-token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
// drive.file only: Google does not treat it as sensitive, so there is no
// "unverified app" warning and no verification. The app sees and writes
// only the files it created or saved itself; a course written elsewhere is
// imported once, then saved to Drive, after which it stays visible.
const SCOPES = "https://www.googleapis.com/auth/drive.file";

function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? "null");
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
  return value ?? null;
}

export function getDriveConfig() {
  const saved = storage(CONFIG_KEY) ?? {};
  return { clientId: saved.clientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID };
}

export function setDriveConfig(config) {
  storage(CONFIG_KEY, config);
  storage(TOKEN_KEY, null);
  token = null;
}

export function isDesktop() {
  return Boolean(window.gmsDesktop?.googleAuth);
}

let token = storage(TOKEN_KEY);

// A token granted for other scopes (an earlier version of the app) is not
// reused: Google must ask for the new consent.
function tokenValid() {
  return token && token.accessToken && token.scopes === SCOPES && token.expiresAt > Date.now() + 30000;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Impossible de charger ${src}`));
    document.head.appendChild(script);
  });
}

// An access token, asking Google (a popup on the web, the browser on the
// desktop) only when the cached one has expired.
export async function getAccessToken() {
  if (tokenValid()) return token.accessToken;
  const config = getDriveConfig();
  if (!config.clientId) throw new Error("Identifiant client Google manquant : renseignez-le dans les réglages Drive.");
  let fresh;
  if (isDesktop()) {
    const result = await window.gmsDesktop.googleAuth({ clientId: config.clientId, scopes: SCOPES });
    if (!result?.accessToken) throw new Error(result?.error ?? "Connexion Google annulée.");
    fresh = { accessToken: result.accessToken, scopes: SCOPES, expiresAt: Date.now() + (result.expiresIn ?? 3600) * 1000 };
  } else {
    await loadScript("https://accounts.google.com/gsi/client");
    fresh = await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: SCOPES,
        callback: response => {
          if (response.error) reject(new Error(response.error_description ?? response.error));
          else resolve({ accessToken: response.access_token, scopes: SCOPES, expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000 });
        },
        error_callback: error => reject(new Error(error?.message ?? "Connexion Google annulée.")),
      });
      client.requestAccessToken({ prompt: token?.scopes === SCOPES ? "" : "consent" });
    });
  }
  token = fresh;
  storage(TOKEN_KEY, token);
  return token.accessToken;
}

export function signOut() {
  if (token?.accessToken && window.google?.accounts?.oauth2?.revoke) window.google.accounts.oauth2.revoke(token.accessToken, () => {});
  token = null;
  storage(TOKEN_KEY, null);
}

async function driveFetch(url, options = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(url, { ...options, headers: { ...(options.headers ?? {}), Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) {
    token = null;
    storage(TOKEN_KEY, null);
    throw new Error("Session Google expirée : réessayez.");
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json()).error?.message ?? "";
    } catch {
      // no body
    }
    throw new Error(`Google Drive : ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
  return response;
}

// Markdown files the app may see, newest first.
export async function listMarkdownFiles() {
  const query = "(mimeType='text/markdown' or name contains '.md') and trashed=false";
  const params = new URLSearchParams({ q: query, orderBy: "modifiedTime desc", pageSize: "50", fields: "files(id,name,modifiedTime)", spaces: "drive" });
  const response = await driveFetch(`${DRIVE_API}/files?${params}`);
  return (await response.json()).files ?? [];
}

export async function downloadFile(id) {
  const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`);
  return response.text();
}

// Creates the file (no id) or replaces its content (id); returns { id, name }.
export async function uploadFile({ id = null, name, content }) {
  const boundary = `gms${Date.now().toString(36)}`;
  const metadata = id ? { name } : { name, mimeType: "text/markdown" };
  const body = [
    `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(metadata),
    `--${boundary}`, "Content-Type: text/markdown; charset=UTF-8", "", content, `--${boundary}--`, "",
  ].join("\r\n");
  const url = id ? `${UPLOAD_API}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id,name` : `${UPLOAD_API}/files?uploadType=multipart&fields=id,name`;
  const response = await driveFetch(url, { method: id ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  return response.json();
}

// Gives another Google account access to a file the app created (Drive
// sends the invitation email). `role`: "reader" or "writer".
export async function shareFile(id, { email, role = "reader", message = "" }) {
  const params = new URLSearchParams({ sendNotificationEmail: "true", fields: "id,role,emailAddress" });
  if (message) params.set("emailMessage", message);
  const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}/permissions?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "user", role, emailAddress: email }),
  });
  return response.json();
}
