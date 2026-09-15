// Short alias for a share link, so that an e-mail carries a few dozen
// characters instead of the whole compressed course. TinyURL's create
// endpoint needs no key, answers cross-origin (any origin, file:// too)
// and accepts the longest links the app produces. Nothing else is sent:
// the alias points at the share link, which itself holds the course.
const CREATE_ENDPOINT = "https://tinyurl.com/api-create.php";

export async function shortenUrl(url, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${CREATE_ENDPOINT}?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    const text = (await response.text()).trim();
    if (!response.ok || !/^https:\/\/tinyurl\.com\/[A-Za-z0-9_-]+$/.test(text)) {
      throw new Error(`Raccourcissement impossible (${response.status}${text ? ` — ${text.slice(0, 80)}` : ""})`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}
