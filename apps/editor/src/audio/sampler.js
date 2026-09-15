// Sampled guitars from a SoundFont: the bank is fetched once, parsed, and
// each zone's samples become an AudioBuffer on first use. `voiceFor` gives
// the engine what it needs to play a note from a sample: the buffer, the
// playback rate that puts it on pitch, the loop and the envelope.
import { parseSoundFont, zoneForNote } from "./soundfont.js";

// General MIDI programs for the app's three sounds. The electric sounds use
// the clean guitar: the amp (cabinet, distortion) is the engine's own.
export const PROGRAMS = { acoustic: 25, electric: 27, distortion: 27 };

let bank = null;
let loading = null;
let loadedUrl = null;
const buffers = new Map();
const zonesByProgram = new Map();

export function isSamplerReady() {
  return bank !== null;
}

// Starts (or restarts, for another file) the download of the bank. Resolves
// to true when the bank is usable, false when it could not be loaded; the
// engine keeps using its synthesized string in that case.
export function loadSampler(url) {
  if (loadedUrl === url && (bank || loading)) return loading ?? Promise.resolve(true);
  loadedUrl = url;
  bank = null;
  buffers.clear();
  zonesByProgram.clear();
  loading = fetch(url)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(data => {
      const parsed = parseSoundFont(data);
      if (loadedUrl !== url) return false;
      bank = parsed;
      return true;
    })
    .catch(error => {
      console.warn("[sampler] SoundFont indisponible, corde synthétisée utilisée :", error.message);
      return false;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

function zonesFor(program) {
  if (!zonesByProgram.has(program)) zonesByProgram.set(program, bank.programZones(program));
  return zonesByProgram.get(program);
}

function bufferFor(ctx, zone) {
  const key = `${zone.name}:${zone.start}:${zone.end}`;
  if (!buffers.has(key)) {
    const data = bank.zoneSamples(zone);
    const buffer = ctx.createBuffer(1, Math.max(1, data.length), zone.sampleRate);
    buffer.copyToChannel(data, 0);
    buffers.set(key, buffer);
  }
  return buffers.get(key);
}

export function voiceFor(ctx, sound, midi) {
  if (!bank) return null;
  const zone = zoneForNote(zonesFor(PROGRAMS[sound] ?? PROGRAMS.acoustic), midi);
  if (!zone) return null;
  return {
    buffer: bufferFor(ctx, zone),
    rate: 2 ** ((midi - zone.rootKey) / 12 + zone.tuneCents / 1200),
    loop: zone.loops && zone.loopEnd > zone.loopStart ? { start: (zone.loopStart - zone.start) / zone.sampleRate, end: (zone.loopEnd - zone.start) / zone.sampleRate } : null,
    gain: 10 ** (-zone.attenuationDb / 20),
    envelope: zone.envelope,
  };
}
