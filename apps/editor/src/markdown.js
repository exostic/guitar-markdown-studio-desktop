import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import qrcode from "qrcode-generator";
import { parseAsciiTab, parseChordBlock, parseRhythmPattern, parseChordGrid, parseScale } from "@gms/guitar-markdown";

let blockCounter = 0;
let currentTimeSignature = "4/4";
const pendingRenders = [];

const META_LABELS = {
  difficulty: "Difficulté",
  tempo: "Tempo",
  time: "Mesure",
  capo: "Capo",
  tuning: "Accordage",
};

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatChordLabel(cell) {
  const match = cell.match(/^([A-G][#b]?)(.*)$/);
  if (!match || !match[2] || match[2] === "m") return escapeHtml(cell);
  return `${escapeHtml(match[1])}<sub class="chord-ext">${escapeHtml(match[2])}</sub>`;
}

const CHORD_TOKEN = /^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add)?\d{0,2}(?:\/[A-G][#b]?)?$/i;

function isChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(token => CHORD_TOKEN.test(token));
}

// Converts a chord line sitting above a lyric line (chords column-aligned over
// the syllable they're played on) into this renderer's native inline syntax
// ("[Bm]On a dark..."), so both source styles reuse the same `.inline-chord` output.
function mergeChordAndLyricLine(chordLine, lyricLine) {
  const chords = [...chordLine.matchAll(/\S+/g)];
  if (!chords.length) return lyricLine;
  const words = [...lyricLine.matchAll(/\S+/g)];
  const insertions = chords
    .map(chord => {
      const target = words.find(word => word.index >= chord.index) ?? words[words.length - 1];
      return { pos: target ? target.index : lyricLine.length, text: chord[0] };
    })
    .sort((a, b) => b.pos - a.pos);
  return insertions.reduce(
    (result, { pos, text }) => result.slice(0, pos) + `[${text}]` + result.slice(pos),
    lyricLine,
  );
}

function renderGridCell(cell) {
  const splitMatch = cell.match(/^(.+)\/(.+)$/);
  if (!splitMatch) return `<div class="grid-cell">${formatChordLabel(cell)}</div>`;
  const [, first, second] = splitMatch;
  return `<div class="grid-cell grid-cell-split">
    <svg class="split-divider" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="100" x2="100" y2="0" /></svg>
    <span class="split-part split-first">${formatChordLabel(first.trim())}</span>
    <span class="split-part split-second">${formatChordLabel(second.trim())}</span>
  </div>`;
}

export function parseFrontMatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, content: source };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) data[key] = value;
  }
  return { data, content: source.slice(match[0].length) };
}

function renderHeader(data) {
  const { title, artist, logo, qr, ...rest } = data;
  const pills = Object.entries(rest)
    .filter(([, value]) => value)
    .map(([key, value]) => {
      const label = META_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
      const bpm = key === "tempo" ? /(\d+(?:\.\d+)?)/.exec(value)?.[1] : null;
      if (bpm) {
        return `<button type="button" class="meta-pill meta-pill-tempo" data-bpm="${bpm}" title="Écouter le métronome"><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</button>`;
      }
      return `<span class="meta-pill"><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</span>`;
    })
    .join("");
  if (!title && !artist && !pills) return "";
  return `<header class="doc-header">
    <div class="doc-header-top">${logo ? `<img class="doc-logo" src="${escapeHtml(logo)}" alt="" />` : ""}</div>
    <div class="doc-title-block">
      ${title ? `<h1 class="doc-title">${escapeHtml(title)}</h1>` : ""}
      ${artist ? `<p class="doc-artist">${escapeHtml(artist)}</p>` : ""}
      ${pills ? `<div class="doc-meta">${pills}</div>` : ""}
    </div>
  </header>`;
}

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });
const defaultFence = md.renderer.rules.fence.bind(md.renderer.rules);

md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = token.info.trim().toLowerCase();

  if (language === "tab") {
    const id = `gms-tab-${blockCounter++}`;
    try {
      const ast = parseAsciiTab(token.content, { timeSignature: currentTimeSignature });
      pendingRenders.push({ type: "tab", id, ast });
      return `<figure class="guitar-block tab-block"><div id="${id}" class="vex-tab-host"></div><details><summary>Source ASCII</summary><pre><code>${escapeHtml(token.content)}</code></pre></details></figure>`;
    } catch (error) {
      return `<div class="block-error"><strong>Tablature invalide</strong><p>${escapeHtml(error.message)}</p><pre>${escapeHtml(token.content)}</pre></div>`;
    }
  }

  if (language === "partition") {
    const id = `gms-partition-${blockCounter++}`;
    try {
      const ast = parseAsciiTab(token.content, { timeSignature: currentTimeSignature });
      pendingRenders.push({ type: "partition", id, ast });
      return `<figure class="guitar-block partition-block"><div id="${id}" class="vex-score-host"></div><details><summary>Source ASCII</summary><pre><code>${escapeHtml(token.content)}</code></pre></details></figure>`;
    } catch (error) {
      return `<div class="block-error"><strong>Partition invalide</strong><p>${escapeHtml(error.message)}</p><pre>${escapeHtml(token.content)}</pre></div>`;
    }
  }

  if (language === "chords") {
    const id = `gms-chords-${blockCounter++}`;
    try {
      const ast = parseChordBlock(token.content);
      pendingRenders.push({ type: "chords", id, ast });
      return `<figure class="guitar-block chord-block"><div id="${id}" class="svguitar-host"></div></figure>`;
    } catch (error) {
      return `<div class="block-error"><strong>Accords invalides</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  if (language === "scale") {
    const id = `gms-scale-${blockCounter++}`;
    try {
      const ast = parseScale(token.content);
      pendingRenders.push({ type: "scale", id, ast });
      return `<figure class="guitar-block scale-block"><div id="${id}" class="fretboard-host"></div></figure>`;
    } catch (error) {
      return `<div class="block-error"><strong>Diagramme de gamme invalide</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  if (language === "grid") {
    try {
      const grid = parseChordGrid(token.content);
      const rowsHtml = grid.rows
        .map((row, index) => {
          const cellsHtml = row.cells.map(renderGridCell).join("");
          const cls = `grid-row${row.repeat ? " repeat" : ""}`;
          const rowLine = index + 1;
          const rowHtml = `<div class="${cls}" style="--cols:${row.cells.length}; grid-row:${rowLine};">${cellsHtml}</div>`;
          const countHtml = row.repeatCount
            ? `<span class="grid-repeat-count" style="grid-row:${rowLine};">&times; ${escapeHtml(row.repeatCount)}</span>`
            : "";
          return rowHtml + countHtml;
        })
        .join("");
      return `<div class="chord-grid">${rowsHtml}</div>`;
    } catch (error) {
      return `<div class="block-error"><strong>Grille invalide</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  if (language === "rhythm") {
    try {
      const pattern = parseRhythmPattern(token.content);
      const groupsHtml = pattern.groups
        .map((group, index) => {
          const strokesHtml = group
            .map((stroke, strokeIndex) => {
              const strokeHtml = stroke.rest
                ? `<span class="stroke stroke-rest"></span>`
                : `<span class="stroke stroke-${stroke.direction}${stroke.ghost ? " ghost" : ""}">${stroke.direction === "down" ? "B" : "H"}</span>`;
              if (strokeIndex !== 0) return strokeHtml;
              return `<span class="rhythm-first">${strokeHtml}<span class="beat-number">${index + 1}</span></span>`;
            })
            .join("");
          return `<div class="rhythm-group"><div class="rhythm-strokes">${strokesHtml}</div></div>`;
        })
        .join("");
      return `<div class="rhythm-block">${groupsHtml}</div>`;
    } catch (error) {
      return `<div class="block-error"><strong>Rythmique invalide</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }
  if (language === "song") {
    const columns = token.content.split(/\r?\n[ \t]*-{3,}[ \t]*\r?\n/);
    const columnsHtml = columns
      .map(column => {
        const versesHtml = column
          .split(/\r?\n\s*\r?\n/)
          .map(verse => verse.trim())
          .filter(Boolean)
          .map(verse => {
            const rawLines = verse.split(/\r?\n/);
            const mergedLines = [];
            for (let i = 0; i < rawLines.length; i++) {
              const line = rawLines[i];
              const next = rawLines[i + 1];
              if (isChordLine(line) && next !== undefined && !isChordLine(next)) {
                mergedLines.push(mergeChordAndLyricLine(line, next));
                i++;
              } else {
                mergedLines.push(line);
              }
            }
            const linesHtml = mergedLines
              .map(line => {
                const html = escapeHtml(line).replace(
                  /\[([^\]]+)\]/g,
                  (_, chord) => `<span class="inline-chord" data-chord="${chord}"></span>`,
                );
                return `<div class="song-line">${html}</div>`;
              })
              .join("");
            return `<div class="song-verse">${linesHtml}</div>`;
          })
          .join("");
        return `<div class="song-column">${versesHtml}</div>`;
      })
      .join("");
    return `<div class="song-block" style="--song-columns:${columns.length}">${columnsHtml}</div>`;
  }
  if (language === "pagebreak") return `<div class="page-break"></div>`;
  if (language === "columnbreak") return `<div class="column-break"></div>`;
  if (language === "landscapebreak") return `<div class="landscape-page-break"></div>`;
  if (language === "columns") return `<div class="column-section-start"></div>`;
  if (language === "column") return `<div class="column-section-sep"></div>`;
  if (language === "endcolumns") return `<div class="column-section-end"></div>`;
  const zoomMatch = language.match(/^zoom(?:\s+([\d.]+))?$/);
  if (zoomMatch) {
    const factor = zoomMatch[1] ? Number(zoomMatch[1]) : 0.8;
    const scale = Math.min(3, Math.max(0.1, factor));
    return `<div class="zoom-start" data-scale="${scale}"></div>`;
  }
  if (language === "endzoom") return `<div class="zoom-end"></div>`;
  return defaultFence(tokens, index, options, env, self);
};

export function renderQrSvg(data) {
  try {
    const qr = qrcode(0, "M");
    qr.addData(data);
    qr.make();
    return qr.createSvgTag({ scalable: true });
  } catch {
    return "";
  }
}

function extractYoutubeId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  let id = null;
  if (host === "youtu.be") {
    id = parsed.pathname.slice(1).split("/")[0];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parsed.pathname === "/watch") id = parsed.searchParams.get("v");
    else {
      const match = /^\/(?:embed|shorts)\/([^/]+)/.exec(parsed.pathname);
      if (match) id = match[1];
    }
  }
  // Keep this strict — it ends up directly in an embed iframe's src.
  return id && /^[\w-]{6,15}$/.test(id) ? id : null;
}

function isAudioUrl(url) {
  return /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus|weba)(?:[?#].*)?$/i.test(url);
}

// Standard markdown links ([text](url), or a bare autolinked URL via the
// linkify option) render as a normal clickable link in web mode; in the
// print modes (Book/Poster) they instead render as a QR code with the link
// text beside it — or the URL itself when the text IS the URL, i.e. a bare
// autolinked link with no separate title. A YouTube link or a direct audio
// file link additionally embeds a player in web mode instead of showing
// the plain link. All variants are always emitted; CSS shows only the one
// matching the current mode.
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet("href") ?? "";
  const isEmbedded = !!extractYoutubeId(href) || isAudioUrl(href);
  token.attrSet("class", isEmbedded ? "link-web link-web-embedded" : "link-web");
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, index, options);
};
md.renderer.rules.link_close = (tokens, index, options) => {
  let openIndex = index - 1;
  let depth = 0;
  while (openIndex >= 0) {
    if (tokens[openIndex].type === "link_close") depth += 1;
    else if (tokens[openIndex].type === "link_open") {
      if (depth === 0) break;
      depth -= 1;
    }
    openIndex -= 1;
  }
  const href = tokens[openIndex]?.attrGet("href") ?? "";
  const label = tokens
    .slice(openIndex + 1, index)
    .map(token => token.content ?? "")
    .join("")
    .trim() || href;
  const youtubeId = extractYoutubeId(href);
  const embedHtml = youtubeId
    ? `<span class="link-embed"><iframe src="https://www.youtube-nocookie.com/embed/${youtubeId}" title="${escapeHtml(label)}" loading="lazy" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin"></iframe></span>`
    : isAudioUrl(href)
      ? `<span class="link-embed link-embed-audio"><audio controls preload="none" src="${escapeHtml(href)}"></audio><span class="link-embed-audio-label">${escapeHtml(label)}</span></span>`
      : "";
  const qrSvg = renderQrSvg(href);
  return `</a>${embedHtml}<a class="link-print" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"><span class="link-qr">${qrSvg}</span><span class="link-print-label">${escapeHtml(label)}</span></a>`;
};

export function renderMarkdown(source) {
  blockCounter = 0;
  pendingRenders.length = 0;
  const { data, content } = parseFrontMatter(source);
  currentTimeSignature = data.time ?? "4/4";
  const headerHtml = renderHeader(data);
  const bodyHtml = md.render(content);
  return {
    html: DOMPurify.sanitize(headerHtml + bodyHtml, {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: ["target", "allow", "allowfullscreen", "loading", "referrerpolicy"],
    }),
    renders: [...pendingRenders],
  };
}
