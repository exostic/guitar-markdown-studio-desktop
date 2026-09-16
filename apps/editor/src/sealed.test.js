import test from "node:test";
import assert from "node:assert/strict";
import { sealText, unsealText } from "./sealed.js";

const course = "---\ntitle: Blues en La\n---\n\n# Blues\n\n```chords\nAm x02210\n```\n";

test("scelle et descelle un cours avec le bon mot de passe", async () => {
  const sealed = await sealText(course, "guitare 2026");
  assert.match(sealed, /^[A-Za-z0-9_-]+$/, "base64url, sûr dans une URL");
  assert.equal(await unsealText(sealed, "guitare 2026"), course);
  assert.equal(await sealText(course, "guitare 2026"), sealed, "même cours, même mot de passe : mêmes octets, donc même lien");
  assert.notEqual(await sealText(course + "\n", "guitare 2026"), sealed, "un autre texte donne un autre scellé");
  assert.notEqual(await sealText(course, "autre"), sealed, "un autre mot de passe aussi");
});

test("mauvais mot de passe → null, lien abîmé → erreur", async () => {
  const sealed = await sealText(course, "bon");
  assert.equal(await unsealText(sealed, "mauvais"), null);
  await assert.rejects(unsealText("AAAA", "bon"), /illisible/);
});
