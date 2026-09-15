// Sending a course by Gmail with the .md attached: the message is built
// here (MIME) and handed to the Gmail API with the same client-side OAuth
// as Drive, asking only for the right to send (gmail.send), and only when
// this is used.
import { googleFetch } from "./drive.js";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Base64 broken into 76-character lines, as MIME wants it.
function base64Lines(text) {
  return base64(text).replace(/.{76}/g, "$&\r\n");
}

function encodedWord(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(text)}?=`;
}

export function buildMessage({ to, subject, text, attachment }) {
  const boundary = `gms${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const recipients = (Array.isArray(to) ? to : String(to).split(/[,;\s]+/)).map(address => address.trim()).filter(Boolean);
  if (!recipients.length) throw new Error("Indiquez au moins un destinataire.");
  const invalid = recipients.find(address => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address));
  if (invalid) throw new Error(`Adresse e-mail invalide : ${invalid}`);
  const lines = [
    `To: ${recipients.join(", ")}`,
    `Subject: ${encodedWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(text),
    `--${boundary}`,
    `Content-Type: text/markdown; charset="UTF-8"; name="${attachment.name}"`,
    `Content-Disposition: attachment; filename="${attachment.name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(attachment.content),
    `--${boundary}--`,
    "",
  ];
  return { recipients, raw: lines.join("\r\n") };
}

function base64Url(text) {
  return base64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Sends from the signed-in Gmail account; resolves to the recipients.
export async function sendGmail(message) {
  const { recipients, raw } = buildMessage(message);
  await googleFetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(raw) }),
  }, { scopes: GMAIL_SCOPE, service: "Gmail" });
  return recipients;
}
