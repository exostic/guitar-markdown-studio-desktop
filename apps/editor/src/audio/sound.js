// Names for the instrument used by playback, as written in the front matter
// `sound:` key or on a `sound:` line inside a tab/partition block. English
// and French words both work: acoustic (default), electric / clean / clair,
// distortion / overdrive / saturé.
export function parseSound(text) {
  const value = (text ?? "").toString().trim().toLowerCase();
  if (!value) return null;
  if (/dist|disto|overdrive|drive|satur|crunch|fuzz/.test(value)) return "distortion";
  if (/elec|élec|clean|clair/.test(value)) return "electric";
  return "acoustic";
}

const SOUND_LINE = /^[ \t]*sound[ \t]*:[ \t]*(.+?)[ \t]*$/im;

// Pulls an optional `sound: …` line out of a block body, returning the body
// without it and the parsed sound (null when absent).
export function extractSoundLine(body) {
  const match = SOUND_LINE.exec(body);
  if (!match) return { body, sound: null };
  return { body: body.replace(match[0], "").replace(/^\n/, ""), sound: parseSound(match[1]) };
}
