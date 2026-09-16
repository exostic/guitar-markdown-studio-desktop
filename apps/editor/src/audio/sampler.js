// Sampled guitars from SoundFonts: the banks are fetched once, parsed, and
// each zone's samples become an AudioBuffer on first use. `voiceFor` gives
// the engine what it needs to play a note from a sample: the buffer, the
// playback rate that puts it on pitch, the loop and the envelope.
import { parseSoundFont, zoneForNote } from "./soundfont.js";

// General MIDI programs for the app's three sounds. The electric sounds use
// the clean guitar: the amp (cabinet, distortion) is the engine's own.
export const PROGRAMS = { acoustic: 25, electric: 27, distortion: 27 };

// The banks, in order of preference: a program is taken from the first
// loaded bank that has it. Each entry: { url, bank (parsed or null) }.
let banks = [];
let loadedKey = null;
const buffers = new Map();
const zonesByProgram = new Map();

export function isSamplerReady() {
  return banks.some(entry => entry.bank);
}

// Starts (or restarts, for other files) the download of the banks, all in
// parallel. Resolves to true when at least one bank is usable, false when
// none could be loaded; the engine keeps using its synthesized string for
// the notes no bank covers.
export function loadSampler(urls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  const key = list.join("\n");
  if (loadedKey === key) return Promise.all(banks.map(entry => entry.loading)).then(() => isSamplerReady());
  loadedKey = key;
  buffers.clear();
  zonesByProgram.clear();
  banks = list.map(url => {
    const entry = { url, bank: null, loading: null };
    entry.loading = fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(data => {
        const parsed = parseSoundFont(data);
        if (loadedKey !== key) return false;
        entry.bank = parsed;
        zonesByProgram.clear();
        return true;
      })
      .catch(error => {
        console.warn(`[sampler] SoundFont indisponible (${url}) :`, error.message);
        return false;
      });
    return entry;
  });
  return Promise.all(banks.map(entry => entry.loading)).then(() => isSamplerReady());
}

// The zones of a program from the first bank that has it, with the bank
// they come from.
function zonesFor(program) {
  if (!zonesByProgram.has(program)) {
    let found = null;
    for (const entry of banks) {
      if (!entry.bank) continue;
      const zones = entry.bank.programZones(program);
      if (zones.length) {
        found = { bank: entry.bank, url: entry.url, zones };
        break;
      }
    }
    zonesByProgram.set(program, found);
  }
  return zonesByProgram.get(program);
}

function bufferFor(ctx, source, zone) {
  const key = `${source.url}:${zone.name}:${zone.start}:${zone.end}`;
  if (!buffers.has(key)) {
    const data = source.bank.zoneSamples(zone);
    const buffer = ctx.createBuffer(1, Math.max(1, data.length), zone.sampleRate);
    buffer.copyToChannel(data, 0);
    buffers.set(key, buffer);
  }
  return buffers.get(key);
}

export function voiceFor(ctx, sound, midi) {
  const source = zonesFor(PROGRAMS[sound] ?? PROGRAMS.acoustic);
  if (!source) return null;
  const zone = zoneForNote(source.zones, midi);
  if (!zone) return null;
  return {
    buffer: bufferFor(ctx, source, zone),
    rate: 2 ** ((midi - zone.rootKey) / 12 + zone.tuneCents / 1200),
    loop: zone.loops && zone.loopEnd > zone.loopStart ? { start: (zone.loopStart - zone.start) / zone.sampleRate, end: (zone.loopEnd - zone.start) / zone.sampleRate } : null,
    gain: 10 ** (-zone.attenuationDb / 20),
    envelope: zone.envelope,
    bank: source.url,
  };
}
