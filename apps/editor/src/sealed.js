// Password-protected share links: the course is compressed, then sealed
// with AES-GCM under a key derived from the password (PBKDF2-SHA-256), and
// the result travels in the link's `enc` parameter. Everything happens in
// the browser: the link, the shortener and the mail only ever carry the
// sealed bytes, and the password is never sent anywhere.
import LZString from "lz-string";

const ITERATIONS = 150_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const VERSION = 1;

const subtle = () => globalThis.crypto?.subtle;

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function deriveKey(password, salt, usage) {
  const material = await subtle().importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
}

export function sealingAvailable() {
  return Boolean(subtle());
}

// Salt and IV derived from the password and the text rather than drawn
// at random: the same course under the same password always seals to the
// same bytes, so its link (and the short alias made from it) is stable
// and a reprint stores nothing new. A different text gives a different
// salt, hence a different key: the IV is never reused under one key.
async function deterministicBytes(label, password, text, length) {
  const digest = await subtle().digest("SHA-256", new TextEncoder().encode(`${label}\n${password.normalize("NFKC")}\n${text}`));
  return new Uint8Array(digest).subarray(0, length);
}

// Resolves to the `enc` value: version byte, salt, iv, ciphertext.
export async function sealText(text, password) {
  if (!password) throw new Error("Mot de passe vide.");
  const salt = await deterministicBytes("gms-salt", password, text, SALT_BYTES);
  const iv = await deterministicBytes("gms-iv", password, text, IV_BYTES);
  const key = await deriveKey(password, salt, "encrypt");
  const plain = LZString.compressToUint8Array(text);
  const sealed = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(1 + SALT_BYTES + IV_BYTES + sealed.length);
  out[0] = VERSION;
  out.set(salt, 1);
  out.set(iv, 1 + SALT_BYTES);
  out.set(sealed, 1 + SALT_BYTES + IV_BYTES);
  return toBase64Url(out);
}

// Resolves to the text, or null when the password is wrong (or the link
// damaged: AES-GCM cannot tell the two apart).
export async function unsealText(payload, password) {
  const bytes = fromBase64Url(payload);
  if (bytes[0] !== VERSION || bytes.length < 1 + SALT_BYTES + IV_BYTES + 16) throw new Error("Lien protégé illisible.");
  const salt = bytes.subarray(1, 1 + SALT_BYTES);
  const iv = bytes.subarray(1 + SALT_BYTES, 1 + SALT_BYTES + IV_BYTES);
  const sealed = bytes.subarray(1 + SALT_BYTES + IV_BYTES);
  const key = await deriveKey(password, salt, "decrypt");
  try {
    const plain = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv }, key, sealed));
    return LZString.decompressFromUint8Array(plain);
  } catch {
    return null;
  }
}
