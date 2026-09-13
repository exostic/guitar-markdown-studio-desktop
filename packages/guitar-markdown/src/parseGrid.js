import { parseKey } from "./theory.js";

function parseRow(line) {
  let content = line;
  let repeatCount = null;

  const countMatch = content.match(/\s*[x×]\s*(\d+)\s*$/i);
  if (countMatch) {
    repeatCount = countMatch[1];
    content = content.slice(0, countMatch.index);
  }

  const repeatStart = content.startsWith("||:");
  if (repeatStart) content = content.slice(3);
  const repeatEnd = content.endsWith(":||");
  if (repeatEnd) content = content.slice(0, -3);

  const cells = content.split("|").map(cell => cell.trim()).filter(Boolean);
  if (!cells.length) throw new Error(`Ligne de grille invalide : « ${line} »`);

  return { cells, repeat: repeatStart || repeatEnd, repeatCount };
}

export function parseChordGrid(source) {
  let key = null;
  const rows = source
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => {
      const keyMatch = line.match(/^(?:key|tonalit[eé])\s*:\s*(.+)$/i);
      if (!keyMatch) return true;
      const parsed = parseKey(keyMatch[1]);
      if (!parsed) throw new Error(`Tonalité inconnue « ${keyMatch[1].trim()} ».`);
      key = parsed.name;
      return false;
    })
    .map(parseRow);

  if (!rows.length) {
    throw new Error("Grille invalide : aucune ligne trouvée.");
  }

  return { type: "grid", key, rows };
}
