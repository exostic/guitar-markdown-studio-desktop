// Option lines a `tab`/`partition` block may start with, one `key: value`
// per line, removed before the ASCII is parsed:
//   sound: clean        instrument for this block (see audio/sound.js)
//   grid: 8             cells per bar for the alphaTex rhythm (8 = eighths in 4/4)
//   staff: tab          what alphaTab draws: tab, partition, or both
import { parseSound } from "./audio/sound.js";

const OPTION_LINE = /^[ \t]*(sound|grid|staff)[ \t]*:[ \t]*(.+?)[ \t]*$/gim;

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
  const options = { sound: null, grid: null, staff: null };
  const cleaned = body.replace(OPTION_LINE, (line, key, value) => {
    if (key.toLowerCase() === "sound") options.sound = parseSound(value);
    if (key.toLowerCase() === "grid") options.grid = Number(value) > 0 ? Math.round(Number(value)) : null;
    if (key.toLowerCase() === "staff") options.staff = parseStaff(value);
    return "";
  });
  return { body: cleaned.replace(/^\n+/, ""), ...options };
}
