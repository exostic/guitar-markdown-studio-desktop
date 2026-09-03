function parseStroke(token) {
  if (token === "-") {
    return { rest: true };
  }
  if (!/^[bh]$/i.test(token)) {
    throw new Error(`Frappe invalide « ${token} » : utilisez B (bas), H (haut) ou - (silence). Minuscule = frappe fantôme.`);
  }
  return {
    direction: token.toLowerCase() === "b" ? "down" : "up",
    ghost: token === token.toLowerCase(),
  };
}

export function parseRhythmPattern(source) {
  const groups = source
    .trim()
    .split("|")
    .map(group => group.trim())
    .filter(Boolean)
    .map(group => group.split(/\s+/).filter(Boolean).map(parseStroke));

  if (!groups.length) {
    throw new Error("Rythmique invalide : aucun temps trouvé. Format : B H | B h | H B");
  }

  return { type: "rhythm", groups };
}
