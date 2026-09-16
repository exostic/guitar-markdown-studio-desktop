// The shortener's logic, independent of HTTP and of the store: an alias is
// derived from the link (same link → same alias, no lookup needed to
// deduplicate), only links to the app itself are accepted (the service is
// not an open redirector), and the store is a tiny get/set interface so
// tests run in memory and production on Firestore.
import { createHash } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ALIAS_LENGTH = 7;
const MAX_URL_LENGTH = 65_536;

function base62(bytes) {
  let out = "";
  for (const byte of bytes) out += BASE62[byte % 62];
  return out;
}

export function aliasFor(url, extra = 0) {
  const digest = createHash("sha256").update(url).digest();
  return base62(digest.subarray(0, ALIAS_LENGTH + extra));
}

export function parseAllowedOrigins(text) {
  return (text ?? "").split(/[\s,]+/).map(origin => origin.trim().replace(/\/+$/, "")).filter(Boolean);
}

// The link the app asks to shorten: absolute https URL on one of the
// allowed origins, of reasonable size. Returns the normalized URL.
export function validateUrl(candidate, allowedOrigins) {
  if (typeof candidate !== "string" || !candidate) throw new Error("Lien manquant.");
  if (candidate.length > MAX_URL_LENGTH) throw new Error("Lien trop long.");
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Lien invalide.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) throw new Error("Seuls les liens https sont acceptés.");
  if (!allowedOrigins.includes(url.origin)) throw new Error("Ce service ne raccourcit que les liens de l'application.");
  return url.href;
}

export class MemoryStore {
  #links = new Map();
  async get(alias) { return this.#links.get(alias) ?? null; }
  async set(alias, record) { this.#links.set(alias, record); }
}

// Creates (or finds) the alias for a link. On the vanishingly rare
// collision with another link, the alias grows by one character.
export async function shorten(store, url, allowedOrigins, now = () => new Date()) {
  const href = validateUrl(url, allowedOrigins);
  for (let extra = 0; extra < 8; extra++) {
    const alias = aliasFor(href, extra);
    const existing = await store.get(alias);
    if (!existing) {
      await store.set(alias, { url: href, createdAt: now().toISOString() });
      return alias;
    }
    if (existing.url === href) return alias;
  }
  throw new Error("Impossible de créer un alias.");
}

export async function resolve(store, alias) {
  if (!/^[0-9A-Za-z]{7,15}$/.test(alias)) return null;
  const record = await store.get(alias);
  return record?.url ?? null;
}
