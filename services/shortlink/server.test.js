import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "./server.js";
import { MemoryStore } from "./links.js";

async function withServer(run) {
  const server = createServer(createApp(new MemoryStore()));
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.close();
  }
}

test("POST /api/links crée l'alias, GET /<alias> redirige", () => withServer(async base => {
  const link = "https://gms.exostic.com/?doc=LQhQBcEtwGw&mode=web";
  const created = await fetch(`${base}/api/links`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://gms.exostic.com" }, body: JSON.stringify({ url: link }) });
  assert.equal(created.status, 200);
  assert.equal(created.headers.get("access-control-allow-origin"), "https://gms.exostic.com");
  const { url, alias } = await created.json();
  assert.equal(url, `${base}/${alias}`);
  const redirect = await fetch(url, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), link);
  const refused = await fetch(`${base}/api/links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://evil.example/" }) });
  assert.equal(refused.status, 400);
  const missing = await fetch(`${base}/nope1234`, { redirect: "manual" });
  assert.equal(missing.status, 404);
  const health = await fetch(base);
  assert.equal(await health.text(), "gms-shortlink");
}));

test("un lien trop long pour un en-tête Location est ouvert par une page", () => withServer(async base => {
  const link = `https://gms.exostic.com/#mode=web&doc=${"A".repeat(12_000)}&view=only`;
  const created = await fetch(`${base}/api/links`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: link }) });
  const { url } = await created.json();
  const page = await fetch(url, { redirect: "manual" });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  const html = await page.text();
  assert.ok(html.includes(`content="0;url=${link.replace(/&/g, "&amp;")}"`), "meta refresh vers le lien");
  assert.ok(html.includes(`location.replace(${JSON.stringify(link)})`), "script vers le lien");
}));
