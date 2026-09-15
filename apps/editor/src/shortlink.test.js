import test from "node:test";
import assert from "node:assert/strict";
import { shortenUrl } from "./shortlink.js";

const reply = (status, body) => async () => ({ ok: status === 200, status, text: async () => body });

test("renvoie l'alias TinyURL du lien", async () => {
  let asked;
  const fetchImpl = async url => { asked = url; return reply(200, "https://tinyurl.com/2yv7bqal\n")(); };
  assert.equal(await shortenUrl("https://gms.exostic.com/?doc=abc&mode=web", { fetchImpl }), "https://tinyurl.com/2yv7bqal");
  assert.equal(asked, "https://tinyurl.com/api-create.php?url=https%3A%2F%2Fgms.exostic.com%2F%3Fdoc%3Dabc%26mode%3Dweb");
});

test("refuse une réponse qui n'est pas un alias", async () => {
  await assert.rejects(shortenUrl("https://gms.exostic.com/", { fetchImpl: reply(400, "Error") }), /Raccourcissement impossible \(400 — Error\)/);
  await assert.rejects(shortenUrl("https://gms.exostic.com/", { fetchImpl: reply(200, "<html>oops</html>") }), /Raccourcissement impossible/);
});
