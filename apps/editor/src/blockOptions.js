// Option lines a `tab`/`partition` block may start with, one `key: value`
// per line, removed before the ASCII is parsed:
//   sound: clean        instrument for this block (see audio/sound.js)
//   grid: 8             cells per bar for the alphaTex rhythm (8 = eighths in 4/4)
//   staff: tab          what alphaTab draws: tab, partition, or both
//   tempo: 120          this block's own tempo, meter, tuning and capo (a
//   time: 3/4           song dropped into a document with other settings,
//   tuning: Drop D      e.g. an imported Guitar Pro track)
//   capo: 2
import { parseTuning } from "@gms/guitar-markdown";
import { parseSound } from "./audio/sound.js";

const OPTION_LINE = /^[ \t]*(sound|grid|staff|tempo|time|tuning|capo)[ \t]*:[ \t]*(.+?)[ \t]*$/gim;

// "tab", "partition"/"score"/"portée", or both in any order and wording
// ("tab et partition", "tab+score", "both", "les deux") → alphaTex staff.
export function parseStaff(text) {
  const value = (text ?? "").toString().trim().toLowerCase();
  if (!value) return null;
  const tab = /tab/.test(value);
  const score = /partition|score|port[ée]e|notation/.test(value);
  if (/both|deux|les 2|two|\+/.test(value) || (tab && score)) return "score tabs";
  if (tab) return "tabs";
  return "score";
}

export function extractBlockOptions(body) {
  const options = { sound: null, grid: null, staff: null, tempo: null, timeSignature: null, tuning: null, capo: null };
  const cleaned = body.replace(OPTION_LINE, (line, key, value) => {
    const name = key.toLowerCase();
    if (name === "sound") options.sound = parseSound(value);
    if (name === "grid") options.grid = Number(value) > 0 ? Math.round(Number(value)) : null;
    if (name === "staff") options.staff = parseStaff(value);
    if (name === "tempo") options.tempo = Number(/(\d+(?:\.\d+)?)/.exec(value)?.[1]) || null;
    if (name === "time") options.timeSignature = /^\d+\s*\/\s*\d+$/.test(value.trim()) ? value.trim().replace(/\s+/g, "") : null;
    if (name === "tuning") options.tuning = parseTuning(value);
    if (name === "capo") options.capo = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
    return "";
  });
  // Option lines become blank lines rather than vanishing, so line numbers
  // in `body` still match the block's source (notes can be traced back).
  return { body: cleaned, ...options };
}
