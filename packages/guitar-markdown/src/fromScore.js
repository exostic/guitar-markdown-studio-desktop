// Writes this app's Markdown from an alphaTab Score (what alphaTab builds
// from a Guitar Pro file): front matter from the song, then one `tab` block
// per six-string track showing score and tablature together, its bars
// wrapped by width (`maxLineWidth` characters, at most `barsPerLine` bars
// per line; `barsPerBlock` splits a track into several blocks instead). The rhythm is carried by the column
// spacing: each bar is cut into equal cells (the largest note value that
// divides every onset and duration of the bar) and every cell gets the same
// number of characters, which is exactly what the ASCII parser reads back.
//
// alphaTab model conventions used here: a quarter note is 960 ticks, beat
// onsets are relative to their bar, string 1 is the lowest string.

const QUARTER_TICKS = 960;
const SMALLEST_CELL_TICKS = QUARTER_TICKS / 16; // a sixty-fourth
const MAX_CELLS_PER_BAR = 64;
const BARS_PER_LINE = 4;
// Characters of music per line before wrapping (the "e|" label and bar
// lines aside); a wider bar gets a line of its own.
const MAX_LINE_WIDTH = 100;
const STRING_LABELS = ["e", "B", "G", "D", "A", "E"];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const STANDARD_TUNING = [64, 59, 55, 50, 45, 40];

function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x;
}

function noteName(midi) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function tuningText(tuning) {
  if (tuning.every((midi, index) => midi === STANDARD_TUNING[index])) return "Standard";
  return [...tuning].reverse().map(noteName).join(" ");
}

function soundForProgram(program) {
  if (program >= 29 && program <= 31) return "distortion";
  if (program >= 26 && program <= 28) return "electric";
  return "acoustic";
}

// General MIDI families, for naming a track's instrument in a picker.
const GM_FAMILIES = [
  [0, "Piano"], [8, "Percussion chromatique"], [16, "Orgue"], [24, "Guitare nylon"], [25, "Guitare acoustique"],
  [26, "Guitare jazz"], [27, "Guitare électrique claire"], [28, "Guitare étouffée"], [29, "Guitare overdrive"],
  [30, "Guitare distordue"], [31, "Harmoniques"], [32, "Basse"], [40, "Cordes"], [48, "Ensemble"], [56, "Cuivres"],
  [64, "Anches"], [72, "Flûtes"], [80, "Synthé lead"], [88, "Synthé nappe"], [96, "Effets"], [104, "Ethnique"],
  [112, "Percussions"], [120, "Bruitages"],
];

export function instrumentName(program) {
  let name = "Instrument";
  for (const [from, label] of GM_FAMILIES) if (program >= from) name = label;
  return name;
}

// What a file holds, for choosing tracks before converting: `eligible` is
// false for percussion and anything but six strings, with the reason.
export function listScoreTracks(score) {
  return score.tracks.map(track => {
    const staff = track.staves[0];
    const strings = staff?.tuning.length ?? 0;
    const percussion = Boolean(staff?.isPercussion);
    const notes = staff ? staff.bars.reduce((n, bar) => n + bar.voices[0].beats.filter(beat => !beat.isRest).length, 0) : 0;
    let reason = null;
    if (percussion) reason = "percussions";
    else if (strings !== 6) reason = `${strings} cordes`;
    return {
      index: track.index,
      name: track.name || `Piste ${track.index + 1}`,
      instrument: percussion ? "Percussions" : instrumentName(track.playbackInfo.program),
      program: track.playbackInfo.program,
      strings,
      bars: staff?.bars.length ?? 0,
      notes,
      eligible: !reason,
      reason,
    };
  });
}

// Beats worth a column: grace notes have no time of their own.
function playedBeats(bar) {
  return (bar.voices[0]?.beats ?? []).filter(beat => beat.graceType === 0 && beat.playbackDuration > 0);
}

// The document has one meter; a shorter bar (a pickup bar, a 2/4 in a 4/4
// song) is completed with rests so the ASCII parser, which assumes every bar
// spans the document meter, keeps the timing. A pickup is padded before its
// notes, any other short bar after them. An overfull bar (Guitar Pro
// tolerates them) keeps every beat.
function barCell(bar, beats, documentTicks) {
  const own = Math.max(bar.masterBar.calculateDuration(), ...beats.map(beat => beat.playbackStart + beat.playbackDuration));
  const ticks = Math.max(own, documentTicks);
  const lead = own < documentTicks && bar.index === 0 ? documentTicks - own : 0;
  let cell = ticks;
  for (const beat of beats) {
    cell = gcd(cell, lead + beat.playbackStart);
    cell = gcd(cell, beat.playbackDuration);
  }
  cell = Math.max(cell, SMALLEST_CELL_TICKS);
  while (ticks / cell > MAX_CELLS_PER_BAR) cell *= 2;
  return { ticks, cell, cells: Math.max(1, Math.round(ticks / cell)), lead };
}

function meterTicks(numerator, denominator) {
  return (numerator * 4 * QUARTER_TICKS) / denominator;
}

// The meter most bars are in: a pickup bar must not set it for the song.
function documentMeter(masterBars) {
  const counts = new Map();
  for (const bar of masterBars) {
    const key = `${bar.timeSignatureNumerator}/${bar.timeSignatureDenominator}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["4/4"];
  const [numerator, denominator] = best.split("/").map(Number);
  return { numerator, denominator, ticks: meterTicks(numerator, denominator) };
}

// What one note writes: the fret token and the technique letters after it.
function noteToken(note, beat) {
  let text = String(note.fret);
  if (note.isDead) text = "x";
  else if (note.isGhost) text = `(${note.fret})`;
  else if (note.harmonicType) text = `<${note.fret}>`;
  let suffix = "";
  if (note.hasBend && note.bendPoints?.length) {
    const values = note.bendPoints.map(point => point.value);
    const last = values[values.length - 1];
    if (last > 0) suffix += "b";
    else if (Math.max(...values) > 0) suffix += "br";
  }
  if (note.isHammerPullOrigin) {
    const target = note.hammerPullDestination;
    suffix += target && target.fret < note.fret ? "p" : "h";
  } else if (note.slideOutType) {
    const target = note.slideTarget;
    if (target) suffix += target.fret < note.fret ? "\\" : "/";
    else if (note.slideOutType === 4 || note.slideOutType === 5) suffix += "\\";
    else suffix += "/";
  }
  if (note.vibrato || beat.vibrato) suffix += "~";
  return { text, suffix };
}

function barToAscii(bar, stringCount, documentTicks) {
  const beats = playedBeats(bar);
  const { cell, cells, lead } = barCell(bar, beats, documentTicks);
  const grid = Array.from({ length: stringCount }, () => Array(cells).fill(null));
  let chord = "";
  for (const beat of beats) {
    if (!chord && beat.chord?.name) chord = beat.chord.name;
    const column = Math.round((lead + beat.playbackStart) / cell);
    for (const note of beat.notes) {
      if (note.isTieDestination) continue;
      const string = stringCount - note.string; // model counts from the lowest string
      if (string < 0 || string >= stringCount) continue;
      grid[string][column] = noteToken(note, beat);
    }
  }
  // A bar of one cell (a whole rest, a whole note) still gets a readable
  // width. A fret with no technique letter after it needs a dash before the
  // next cell, or two frets would run together ("1012").
  let width = cells === 1 ? 4 : 2;
  for (const row of grid) for (const token of row) if (token) width = Math.max(width, token.text.length + token.suffix.length + (token.suffix ? 0 : 1));
  const rows = grid.map(row =>
    row.map(token => {
      if (!token) return "-".repeat(width);
      const filler = token.suffix.endsWith("~") ? "~" : "-";
      return (token.text + token.suffix).padEnd(width, filler);
    }).join(""),
  );
  return { rows, chord, width: cells * width };
}

// One system: a chord line when there are chord names, then the six rows.
function systemLines(bars, stringCount, documentTicks) {
  const rendered = bars.map(bar => barToAscii(bar, stringCount, documentTicks));
  const lines = [];
  if (rendered.some(bar => bar.chord)) {
    let chordLine = "  ";
    for (const bar of rendered) chordLine += `${bar.chord}`.padEnd(bar.width + 1, " ");
    lines.push(chordLine.replace(/\s+$/, ""));
  }
  for (let string = 0; string < stringCount; string += 1) {
    lines.push(`${STRING_LABELS[string]}|${rendered.map(bar => bar.rows[string]).join("|")}|`);
  }
  return lines;
}

// Bars packed into systems: a system takes bars while it stays within
// `maxLineWidth` characters and `barsPerLine` bars, so dense bars get fewer
// per line than sparse ones and an over-wide bar stands alone.
function packSystems(bars, documentTicks, { barsPerLine, maxLineWidth }) {
  const systems = [];
  let current = [];
  let width = 0;
  for (const bar of bars) {
    const barWidth = barToAscii(bar, 6, documentTicks).width + 1;
    if (current.length && (current.length >= barsPerLine || width + barWidth > maxLineWidth)) {
      systems.push(current);
      current = [];
      width = 0;
    }
    current.push(bar);
    width += barWidth;
  }
  if (current.length) systems.push(current);
  return systems;
}

// A block: its option lines, then the bars wrapped into systems (blank line
// between systems) for readability.
function blockToMarkdown(bars, stringCount, documentTicks, optionLines, { barsPerLine, maxLineWidth }) {
  const systems = packSystems(bars, documentTicks, { barsPerLine, maxLineWidth }).map(group => systemLines(group, stringCount, documentTicks).join("\n"));
  const fence = optionLines.some(line => /^staff:\s*(partition|score)/.test(line)) ? "partition" : "tab";
  return "```" + fence + "\n" + [...optionLines, systems.join("\n\n")].join("\n") + "\n```";
}

// Reads the song: the tracks worth writing, the document meter, the song
// settings, and the warnings about what cannot be carried over.
// `wanted`: track indexes to keep (null = every eligible track). Tracks
// left out on purpose are not reported; unusable ones are.
function analyseScore(score, wanted = null) {
  const warnings = [];
  const tracks = score.tracks.filter(track => {
    const staff = track.staves[0];
    if (wanted && !wanted.includes(track.index)) return false;
    if (!staff || staff.isPercussion || staff.tuning.length !== 6) {
      warnings.push(`Piste ignorée : ${track.name || `piste ${track.index + 1}`} (${staff?.isPercussion ? "percussions" : `${staff?.tuning.length ?? 0} cordes`})`);
      return false;
    }
    return true;
  });
  const first = tracks[0]?.staves[0];
  const meter = documentMeter(score.masterBars);
  const settings = {
    title: score.title || "Sans titre",
    artist: score.artist || "",
    tempo: score.tempo,
    time: `${meter.numerator}/${meter.denominator}`,
    tuning: first ? tuningText(first.tuning) : "Standard",
    capo: first?.capo ?? 0,
    sound: tracks[0] ? soundForProgram(tracks[0].playbackInfo.program) : "acoustic",
  };
  const longer = score.masterBars.filter(bar => meterTicks(bar.timeSignatureNumerator, bar.timeSignatureDenominator) > meter.ticks);
  if (longer.length) warnings.push(`Mesures plus longues que ${meter.numerator}/${meter.denominator}, jouées compressées : ${longer.map(bar => bar.index + 1).join(", ")}`);
  const shorter = score.masterBars.filter(bar => meterTicks(bar.timeSignatureNumerator, bar.timeSignatureDenominator) < meter.ticks);
  if (shorter.length) warnings.push(`Mesures plus courtes que ${meter.numerator}/${meter.denominator}, complétées par des silences : ${shorter.map(bar => bar.index + 1).join(", ")}`);
  if (tracks.length > 1 && tracks.some(track => tuningText(track.staves[0].tuning) !== tuningText(first.tuning))) {
    warnings.push("Les pistes n'ont pas toutes le même accordage : celui de la première piste est utilisé");
  }
  for (const track of tracks) {
    if (track.staves[0].bars.some(bar => bar.voices.slice(1).some(voice => voice.beats.some(beat => !beat.isRest)))) {
      warnings.push(`${track.name || `Piste ${track.index + 1}`} : seule la première voix est reprise`);
    }
  }
  return { tracks, meter, settings, warnings };
}

function trackSections(tracks, meter, { barsPerBlock, barsPerLine, maxLineWidth, optionLines, headings }) {
  const sections = [];
  for (const track of tracks) {
    const bars = track.staves[0].bars;
    const lines = [];
    if (headings) lines.push(`## ${track.name || `Piste ${track.index + 1}`}`, "");
    for (let start = 0; start < bars.length; start += Math.min(barsPerBlock, bars.length)) {
      lines.push(blockToMarkdown(bars.slice(start, start + barsPerBlock), 6, meter.ticks, optionLines, { barsPerLine, maxLineWidth }), "");
    }
    sections.push(lines.join("\n").trimEnd());
  }
  return sections;
}

// A whole document: the song settings go to the front matter. `tracks`
// (indexes) limits the conversion to chosen tracks.
export function scoreToMarkdown(score, options = {}) {
  // One block per track by default; `barsPerBlock` cuts it into several.
  const barsPerBlock = options.barsPerBlock > 0 ? options.barsPerBlock : Infinity;
  const barsPerLine = options.barsPerLine > 0 ? options.barsPerLine : BARS_PER_LINE;
  const maxLineWidth = options.maxLineWidth > 0 ? options.maxLineWidth : MAX_LINE_WIDTH;
  // What each block shows: "tab et partition" unless the caller says otherwise.
  const staffLine = options.staff === undefined ? "tab et partition" : options.staff;
  const { tracks, meter, settings, warnings } = analyseScore(score, Array.isArray(options.tracks) ? options.tracks : null);
  const front = [`title: ${settings.title}`];
  if (settings.artist) front.push(`artist: ${settings.artist}`);
  front.push(`tempo: ${settings.tempo} BPM`, `time: ${settings.time}`);
  if (tracks.length) {
    front.push(`tuning: ${settings.tuning}`);
    if (settings.capo) front.push(`capo: ${settings.capo}`);
    front.push(`sound: ${settings.sound}`);
  }
  const sections = trackSections(tracks, meter, { barsPerBlock, barsPerLine, maxLineWidth, optionLines: staffLine ? [`staff: ${staffLine}`] : [], headings: tracks.length > 1 });
  const body = [];
  if (warnings.length) body.push(warnings.map(text => `> ${text}`).join("\n"), "");
  body.push(sections.join("\n\n"));
  return { markdown: `---\n${front.join("\n")}\n---\n\n${body.join("\n").trimEnd()}\n`, warnings };
}

// Blocks to drop into an existing document: the song settings travel with
// each block as option lines (tempo, time, tuning, capo, sound), so the
// blocks play and engrave right whatever the document's own front matter
// says.
export function scoreToBlocks(score, options = {}) {
  // eslint-disable-next-line no-unused-vars -- `sourceName` accepted for callers, unused now
  void options.sourceName;
  const barsPerBlock = options.barsPerBlock > 0 ? options.barsPerBlock : Infinity;
  const barsPerLine = options.barsPerLine > 0 ? options.barsPerLine : BARS_PER_LINE;
  const maxLineWidth = options.maxLineWidth > 0 ? options.maxLineWidth : MAX_LINE_WIDTH;
  const staffLine = options.staff === undefined ? "tab et partition" : options.staff;
  const { tracks, meter, settings, warnings } = analyseScore(score, Array.isArray(options.tracks) ? options.tracks : null);
  const optionLines = [];
  if (staffLine) optionLines.push(`staff: ${staffLine}`);
  optionLines.push(`tempo: ${settings.tempo}`, `time: ${settings.time}`, `tuning: ${settings.tuning}`);
  if (settings.capo) optionLines.push(`capo: ${settings.capo}`);
  optionLines.push(`sound: ${settings.sound}`);
  const sections = trackSections(tracks, meter, { barsPerBlock, barsPerLine, maxLineWidth, optionLines, headings: tracks.length > 1 });
  const body = warnings.length ? [warnings.map(text => `> ${text}`).join("\n"), "", sections.join("\n\n")] : [sections.join("\n\n")];
  return { markdown: `${body.join("\n").trimEnd()}\n`, warnings };
}
