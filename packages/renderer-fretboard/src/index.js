const STRING_COUNT = 6;
const FRET_SPACING = 42;
const STRING_SPACING = 26;
const MARGIN_X = 28;
const MARGIN_TOP = 18;
const MARGIN_BOTTOM = 34;
const RADIUS = 10;

function noteX(fret, fretMin) {
  return MARGIN_X + (fret - fretMin + 0.5) * FRET_SPACING;
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// String 1 (aigu / high e) is drawn as the top row, string 6 (grave / low E)
// as the bottom row, matching the top-to-bottom order already used by the
// ASCII tab blocks elsewhere in this app.
function stringY(string) {
  return MARGIN_TOP + (string - 1) * STRING_SPACING;
}

export function renderFretboardScale(ast, target) {
  const [fretMin, fretMax] = ast.fretRange;
  const fretCount = fretMax - fretMin + 1;
  const width = MARGIN_X * 2 + fretCount * FRET_SPACING;
  const fretboardBottom = MARGIN_TOP + (STRING_COUNT - 1) * STRING_SPACING;
  const height = fretboardBottom + MARGIN_BOTTOM;

  const parts = [];

  for (let fret = fretMin; fret <= fretMax + 1; fret += 1) {
    const x = MARGIN_X + (fret - fretMin) * FRET_SPACING;
    const isNut = fret === fretMin && fretMin === 0;
    parts.push(
      `<line x1="${x}" y1="${MARGIN_TOP}" x2="${x}" y2="${fretboardBottom}" stroke="${isNut ? "#1f2937" : "#d1d5db"}" stroke-width="${isNut ? 3 : 1}" />`,
    );
  }

  for (let string = 1; string <= STRING_COUNT; string += 1) {
    const y = stringY(string);
    parts.push(`<line x1="${MARGIN_X}" y1="${y}" x2="${width - MARGIN_X}" y2="${y}" stroke="#9ca3af" stroke-width="1" />`);
  }

  for (let fret = fretMin; fret <= fretMax; fret += 1) {
    const x = noteX(fret, fretMin);
    parts.push(
      `<text x="${x}" y="${fretboardBottom + 22}" font-size="13" font-weight="600" text-anchor="middle" fill="#4b5563">${fret}</text>`,
    );
  }

  function drawNotes(notesByString, color) {
    for (const [string, notes] of Object.entries(notesByString)) {
      const y = stringY(Number(string));
      for (const note of notes) {
        if (note.fret < fretMin || note.fret > fretMax) continue;
        const x = noteX(note.fret, fretMin);
        // A group per note with its string and fret: a click can play it.
        parts.push(`<g class="fret-note" data-string="${string}" data-fret="${note.fret}">`);
        parts.push(`<circle cx="${x}" cy="${y}" r="${RADIUS}" fill="${note.color ?? color}" />`);
        if (note.label) {
          parts.push(
            `<text x="${x}" y="${y + 3}" font-size="9" font-weight="600" text-anchor="middle" fill="${note.textColor ?? "#ffffff"}">${escapeXml(note.label)}</text>`,
          );
        }
        parts.push("</g>");
      }
    }
  }

  drawNotes(ast.dim, "#d1d5db");
  drawNotes(ast.highlight, "#1f2937");

  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
  return target;
}
