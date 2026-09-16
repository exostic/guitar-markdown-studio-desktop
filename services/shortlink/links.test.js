import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, aliasFor, parseAllowedOrigins, resolve, shorten, validateUrl } from "./links.js";

const origins = parseAllowedOrigins("https://gms.exostic.com, http://localhost:5173/");
const link = "https://gms.exostic.com/?doc=LQhQBcEtwGw&mode=web&view=only&edit=hide";

test("le même lien donne le même alias, et il se résout", async () => {
  const store = new MemoryStore();
  const alias = await shorten(store, link, origins);
  assert.match(alias, /^[0-9A-Za-z]{7}$/);
  assert.equal(await shorten(store, link, origins), alias);
  assert.equal(await resolve(store, alias), link);
  assert.equal(await resolve(store, "inconnu"), null);
  assert.equal(await resolve(store, "../x"), null);
});

test("une collision allonge l'alias", async () => {
  const store = new MemoryStore();
  await store.set(aliasFor(link), { url: "https://gms.exostic.com/?doc=autre" });
  const alias = await shorten(store, link, origins);
  assert.equal(alias.length, 8);
  assert.equal(await resolve(store, alias), link);
});

test("seuls les liens de l'application sont acceptés", () => {
  assert.equal(validateUrl("http://localhost:5173/?doc=x", origins), "http://localhost:5173/?doc=x");
  assert.throws(() => validateUrl("https://evil.example/?doc=x", origins), /liens de l'application/);
  assert.throws(() => validateUrl("http://gms.exostic.com/?doc=x", origins), /https/);
  assert.throws(() => validateUrl("pas une url", origins), /invalide/);
  assert.throws(() => validateUrl("", origins), /manquant/);
  assert.throws(() => validateUrl(`https://gms.exostic.com/?doc=${"x".repeat(1_100_000)}`, origins), /trop long/);
});
