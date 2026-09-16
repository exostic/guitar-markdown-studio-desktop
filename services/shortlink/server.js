// HTTP front of the shortener, for Cloud Run:
//   POST /api/links  {"url": "https://gms.exostic.com/?doc=…"}  → {"url": "https://<host>/<alias>"}
//   GET  /<alias>                                                 → 302 to the link
//   GET  /                                                        → a word, for health checks
// Environment: PORT (Cloud Run sets it), ALLOWED_ORIGINS (comma-separated
// origins allowed as link targets and as CORS callers; default: the app),
// PUBLIC_BASE_URL (the short links' prefix, default: the request host),
// STORE=memory for local runs without Firestore.
import { createServer } from "node:http";
import { MemoryStore, parseAllowedOrigins, resolve, shorten } from "./links.js";

const PORT = Number(process.env.PORT ?? 8080);
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS ?? "https://gms.exostic.com,http://localhost:5173,http://localhost:4173");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
const MAX_BODY = 1_100_000;
const RATE_LIMIT = { windowMs: 60_000, max: 30 };
const hits = new Map();

async function makeStore() {
  if (process.env.STORE === "memory") return new MemoryStore();
  const { Firestore } = await import("@google-cloud/firestore");
  const collection = new Firestore().collection(process.env.FIRESTORE_COLLECTION ?? "links");
  return {
    async get(alias) {
      const doc = await collection.doc(alias).get();
      return doc.exists ? doc.data() : null;
    },
    async set(alias, record) {
      await collection.doc(alias).set(record);
    },
  };
}

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) ?? { start: now, count: 0 };
  if (now - entry.start > RATE_LIMIT.windowMs) Object.assign(entry, { start: now, count: 0 });
  entry.count += 1;
  hits.set(ip, entry);
  if (hits.size > 10_000) hits.clear();
  return entry.count > RATE_LIMIT.max;
}

function cors(request, response) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "86400");
}

function send(response, status, body, type = "application/json; charset=utf-8") {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Requête trop volumineuse."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("JSON invalide."));
      }
    });
    request.on("error", reject);
  });
}

export function createApp(store) {
  return async (request, response) => {
    cors(request, response);
    const url = new URL(request.url, "http://localhost");
    if (request.method === "OPTIONS") return send(response, 204, "");
    if (request.method === "POST" && url.pathname === "/api/links") {
      const ip = request.headers["x-forwarded-for"]?.split(",")[0].trim() || request.socket.remoteAddress || "?";
      if (rateLimited(ip)) return send(response, 429, { error: "Trop de demandes, réessayez dans une minute." });
      try {
        const body = await readJson(request);
        const alias = await shorten(store, body.url, ALLOWED_ORIGINS);
        const base = PUBLIC_BASE_URL || `${request.headers["x-forwarded-proto"] ?? "http"}://${request.headers.host}`;
        return send(response, 200, { url: `${base}/${alias}`, alias });
      } catch (error) {
        return send(response, 400, { error: error.message });
      }
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/") return send(response, 200, "gms-shortlink", "text/plain; charset=utf-8");
      const target = await resolve(store, url.pathname.slice(1));
      if (!target) return send(response, 404, "Lien inconnu.", "text/plain; charset=utf-8");
      response.writeHead(302, { Location: target, "Cache-Control": "public, max-age=300" });
      return response.end();
    }
    return send(response, 405, { error: "Méthode non autorisée." });
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const store = await makeStore();
  createServer(createApp(store)).listen(PORT, () => console.log(`gms-shortlink sur le port ${PORT} (${process.env.STORE === "memory" ? "mémoire" : "Firestore"})`));
}
