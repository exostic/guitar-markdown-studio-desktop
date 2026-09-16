import test from "node:test";
import assert from "node:assert/strict";
import { shortenUrl } from "./shortlink.js";

const reply = (status, body, json) => async () => ({ ok: status === 200, status, text: async () => body, json: async () => json ?? JSON.parse(body) });

test("renvoie l'alias TinyURL du lien", async () => {
  let asked;
  const fetchImpl = async url => { asked = url; return reply(200, "https://tinyurl.com/2yv7bqal\n")(); };
  assert.equal(await shortenUrl("https://gms.exostic.com/?doc=abc&mode=web", { fetchImpl, ownService: "" }), "https://tinyurl.com/2yv7bqal");
  assert.equal(asked, "https://tinyurl.com/api-create.php?url=https%3A%2F%2Fgms.exostic.com%2F%3Fdoc%3Dabc%26mode%3Dweb");
});

test("préfère le service de l'application quand il est configuré", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init?.method ?? "GET", init?.body]); return reply(200, JSON.stringify({ url: "https://l.exostic.com/Ab3dEf9", alias: "Ab3dEf9" }))(); };
  assert.equal(await shortenUrl("https://gms.exostic.com/?doc=abc", { fetchImpl, ownService: "https://l.exostic.com/" }), "https://l.exostic.com/Ab3dEf9");
  assert.deepEqual(calls, [["https://l.exostic.com/api/links", "POST", JSON.stringify({ url: "https://gms.exostic.com/?doc=abc" })]]);
});

test("retombe sur TinyURL si le service de l'application échoue", async () => {
  const fetchImpl = async url => String(url).includes("tinyurl") ? reply(200, "https://tinyurl.com/zz")() : reply(503, "{}", { error: "down" })();
  assert.equal(await shortenUrl("https://gms.exostic.com/?doc=abc", { fetchImpl, ownService: "https://l.exostic.com" }), "https://tinyurl.com/zz");
});

test("refuse une réponse qui n'est pas un alias", async () => {
  await assert.rejects(shortenUrl("https://gms.exostic.com/", { fetchImpl: reply(400, "Error"), ownService: "" }), /Raccourcissement impossible \(400 — Error\)/);
  await assert.rejects(shortenUrl("https://gms.exostic.com/", { fetchImpl: reply(200, "<html>oops</html>"), ownService: "" }), /Raccourcissement impossible/);
});
