import { circleIndexOfKey, circleOfFifths, parseKey } from "@gms/guitar-markdown";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatChord(name) {
  const match = String(name).match(/^([A-G][#b]?)(.*)$/);
  if (!match || !match[2] || match[2] === "m") return escapeHtml(name);
  return `${escapeHtml(match[1])}<sub class="chord-ext">${escapeHtml(match[2])}</sub>`;
}

function accidentalsLabel(accidentals) {
  if (!accidentals.count) return "aucune altération";
  const unit = accidentals.kind === "flat" ? "bémol" : "dièse";
  return `${accidentals.count} ${unit}${accidentals.count > 1 ? "s" : ""}`;
}

// chart = diatonicChords(...) result: { key, sevenths, chords, harmonicDominant }
export function renderKeyChartHtml(chart) {
  const { key, sevenths, chords, harmonicDominant } = chart;
  const rows = chords
    .map(
      entry => `<tr>
        <td class="key-degree">${entry.degree}</td>
        <td class="key-numeral">${escapeHtml(entry.numeral)}</td>
        <td class="key-chord">${formatChord(entry.chord)}</td>
        ${sevenths ? `<td class="key-chord">${formatChord(entry.seventh)}</td>` : ""}
        <td class="key-notes">${entry.notes.map(escapeHtml).join(" · ")}</td>
        <td class="key-function">${escapeHtml(entry.functionFr)}</td>
      </tr>`,
    )
    .join("");
  const relativeLabel = key.mode === "major" ? "Relative mineure" : "Relative majeure";
  const caption = [
    `${relativeLabel} : ${escapeHtml(key.relative)}`,
    `Armure : ${accidentalsLabel(key.accidentals)}`,
    harmonicDominant ? `Dominante (mineur harmonique) : ${escapeHtml(harmonicDominant)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `<figure class="guitar-block key-chart-block">
    <table class="key-chart">
      <caption><strong>${escapeHtml(key.label)}</strong> <span class="key-chart-solfege">(${escapeHtml(key.solfege)})</span></caption>
      <thead><tr><th>Degré</th><th>Chiffre</th><th>Accord</th>${sevenths ? "<th>7e</th>" : ""}<th>Notes</th><th>Fonction</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <figcaption class="key-chart-caption">${caption}</figcaption>
  </figure>`;
}

function polar(cx, cy, radius, angle) {
  return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
}

function sectorPath(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
  const [x1, y1] = polar(cx, cy, outerRadius, startAngle);
  const [x2, y2] = polar(cx, cy, outerRadius, endAngle);
  const [x3, y3] = polar(cx, cy, innerRadius, endAngle);
  const [x4, y4] = polar(cx, cy, innerRadius, startAngle);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${outerRadius} ${outerRadius} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${innerRadius} ${innerRadius} 0 0 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

export function renderCircleOfFifthsSvg(keyText, { size = 320 } = {}) {
  const key = keyText ? parseKey(keyText) : null;
  const activeIndex = key ? circleIndexOfKey(keyText) : null;
  const sectors = circleOfFifths();
  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2 - 4;
  const middle = outer * 0.68;
  const inner = outer * 0.42;
  const step = (Math.PI * 2) / 12;
  const parts = [];

  sectors.forEach(sector => {
    const start = (sector.index - 0.5) * step;
    const end = (sector.index + 0.5) * step;
    const distance = activeIndex === null ? null : Math.min((sector.index - activeIndex + 12) % 12, (activeIndex - sector.index + 12) % 12);
    const majorState = distance === 0 ? (key.mode === "major" ? "cof-key" : "cof-neighbor") : distance === 1 ? "cof-neighbor" : "";
    const minorState = distance === 0 ? (key.mode === "minor" ? "cof-key" : "cof-neighbor") : distance === 1 ? "cof-neighbor" : "";
    const majorLabelClass = majorState === "cof-key" ? " cof-label-active" : "";
    const minorLabelClass = minorState === "cof-key" ? " cof-label-active" : "";
    const majorClass = `cof-sector cof-major${majorState ? ` ${majorState}` : ""}`;
    const minorClass = `cof-sector cof-minor${minorState ? ` ${minorState}` : ""}`;
    const [mx, my] = polar(cx, cy, (outer + middle) / 2, sector.index * step);
    const [nx, ny] = polar(cx, cy, (middle + inner) / 2, sector.index * step);
    parts.push(`<path class="${majorClass}" d="${sectorPath(cx, cy, middle, outer, start, end)}" />`);
    parts.push(`<path class="${minorClass}" d="${sectorPath(cx, cy, inner, middle, start, end)}" />`);
    parts.push(`<text class="cof-label cof-label-major${majorLabelClass}" x="${mx.toFixed(2)}" y="${my.toFixed(2)}" text-anchor="middle" dominant-baseline="central">${escapeHtml(sector.major)}</text>`);
    parts.push(`<text class="cof-label cof-label-minor${minorLabelClass}" x="${nx.toFixed(2)}" y="${ny.toFixed(2)}" text-anchor="middle" dominant-baseline="central">${escapeHtml(sector.minor)}</text>`);
  });

  const centreLabel = key ? escapeHtml(key.name) : "";
  const centreSub = key ? escapeHtml(accidentalsLabel(key.accidentals)) : "Quintes";
  parts.push(`<text class="cof-centre" x="${cx}" y="${cy - (key ? 6 : 0)}" text-anchor="middle" dominant-baseline="central">${centreLabel}</text>`);
  parts.push(`<text class="cof-centre-sub" x="${cx}" y="${cy + (key ? 14 : 0)}" text-anchor="middle" dominant-baseline="central">${centreSub}</text>`);

  const caption = key
    ? `${escapeHtml(key.label)} : voisines ${escapeHtml(sectors[(activeIndex + 11) % 12].major)} et ${escapeHtml(sectors[(activeIndex + 1) % 12].major)}, relative ${escapeHtml(key.relative)}.`
    : "Cercle des quintes : majeures à l'extérieur, relatives mineures à l'intérieur.";

  return `<figure class="guitar-block circle-block">
    <svg class="circle-of-fifths" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cercle des quintes">${parts.join("")}</svg>
    <figcaption class="circle-caption">${caption}</figcaption>
  </figure>`;
}

function formatFrequency(value) {
  return `${value.toFixed(2).replace(".", ",")} Hz`;
}

export function renderTunerHtml(ast) {
  const buttons = ast.strings
    .map(
      string => `<button type="button" class="tuner-string" data-midi="${string.midi}" data-frequency="${string.frequency}" title="Jouer la corde ${string.number} (${escapeHtml(string.note)})">
        <span class="tuner-number">${string.number}</span>
        <span class="tuner-note">${escapeHtml(string.note)}</span>
        <span class="tuner-frequency">${formatFrequency(string.frequency)}</span>
      </button>`,
    )
    .join("");
  const rows = ast.strings
    .map(string => `<tr><td>${string.number}</td><td>${escapeHtml(string.note)}</td><td>${formatFrequency(string.frequency)}</td></tr>`)
    .join("");
  return `<figure class="guitar-block tuner-block">
    <div class="tuner-header"><strong>Accordeur</strong> <span class="tuner-tuning">${escapeHtml(ast.tuning.label)}</span></div>
    <div class="tuner-strings block-web">${buttons}</div>
    <table class="tuner-table block-print"><thead><tr><th>Corde</th><th>Note</th><th>Fréquence</th></tr></thead><tbody>${rows}</tbody></table>
  </figure>`;
}
