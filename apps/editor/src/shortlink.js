// Short alias for a share link, so that an e-mail carries a few dozen
// characters instead of the whole compressed course. Two shorteners:
// the app's own service (services/shortlink, on Cloud Run) when its
// address is known, TinyURL otherwise or when the own service fails.
// TinyURL's create endpoint needs no key, answers cross-origin (any
// origin, file:// too) and accepts the longest links the app produces.
// Nothing else is sent: the alias points at the share link, which itself
// holds the course.
const TINYURL_ENDPOINT = "https://tinyurl.com/api-create.php";
export const OWN_SERVICE_KEY = "gms:shortlink-api";

// The own service's base URL: the setting saved in the app, else the
// address given at build time, else none.
export function ownServiceUrl() {
  try {
    const saved = localStorage.getItem(OWN_SERVICE_KEY);
    if (saved) return saved.replace(/\/+$/, "");
  } catch {
    // storage unavailable
  }
  const built = import.meta.env?.VITE_SHORTLINK_API;
  return built ? String(built).replace(/\/+$/, "") : "";
}

async function withTimeout(timeoutMs, run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function shortenWithOwnService(url, base, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const root = String(base).replace(/\/+$/, "");
  return withTimeout(timeoutMs, async signal => {
    const response = await fetchImpl(`${root}/api/links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !/^https?:\/\/\S+$/.test(body.url ?? "")) throw new Error(`Raccourcissement impossible (${response.status}${body.error ? ` — ${body.error}` : ""})`);
    return body.url;
  });
}

export async function shortenWithTinyUrl(url, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  return withTimeout(timeoutMs, async signal => {
    const response = await fetchImpl(`${TINYURL_ENDPOINT}?url=${encodeURIComponent(url)}`, { signal });
    const text = (await response.text()).trim();
    if (!response.ok || !/^https:\/\/tinyurl\.com\/[A-Za-z0-9_-]+$/.test(text)) {
      throw new Error(`Raccourcissement impossible (${response.status}${text ? ` — ${text.slice(0, 80)}` : ""})`);
    }
    return text;
  });
}

export async function shortenUrl(url, options = {}) {
  const own = options.ownService ?? ownServiceUrl();
  if (own) {
    try {
      return await shortenWithOwnService(url, own, options);
    } catch (error) {
      console.warn("[share] service de liens courts indisponible, TinyURL utilisé", error);
    }
  }
  return shortenWithTinyUrl(url, options);
}
