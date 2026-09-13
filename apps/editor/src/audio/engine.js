// Web Audio engine: one shared AudioContext, a Karplus-Strong plucked string
// (pre-rendered into cached buffers — a DelayNode feedback loop would be
// quantised to 128-sample blocks and drift out of tune above ~300 Hz), a
// metronome click and a noise-burst strum for rhythm patterns.
import { midiToFrequency } from "@gms/guitar-markdown";

let context = null;
let master = null;
const bufferCache = new Map();
const activeVoices = new Set();

// Instrument sound: the plucked string is the same, what changes is the
// "amp" it goes through. `acoustic` is the bare string; `electric` rolls off
// the top like a pickup into a clean amp; `distortion` drives every voice
// through one shared waveshaper (chords intermodulate like on a real amp)
// and a cabinet-style low-pass.
export const SOUNDS = ["acoustic", "electric", "distortion"];
let currentSound = "acoustic";
const buses = new Map();

const PLUCK_SECONDS = 3;

export function getAudioContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    context = new AudioContextClass();
    const gain = context.createGain();
    gain.gain.value = 0.8;
    const compressor = context.createDynamicsCompressor();
    gain.connect(compressor);
    compressor.connect(context.destination);
    master = gain;
  }
  return context;
}

export async function ensureRunning() {
  const ctx = getAudioContext();
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      // Autoplay policy: the click that reached us should be enough, but a
      // browser may still refuse — the caller simply schedules silence.
    }
  }
  return ctx;
}

export function setSound(name) {
  currentSound = SOUNDS.includes(name) ? name : "acoustic";
}

export function getSound() {
  return currentSound;
}

function distortionCurve(drive, samples = 4096) {
  const curve = new Float32Array(samples);
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

function biquad(ctx, type, frequency, q = 0.7) {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  return filter;
}

function chain(nodes) {
  for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
  return nodes[0];
}

function buildBus(name) {
  const ctx = getAudioContext();
  const input = ctx.createGain();
  if (name === "electric") {
    const level = ctx.createGain();
    level.gain.value = 1.1;
    chain([input, biquad(ctx, "highpass", 70), biquad(ctx, "lowpass", 3800, 0.9), level, master]);
  } else if (name === "distortion") {
    const drive = ctx.createGain();
    drive.gain.value = 14;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(6);
    shaper.oversample = "4x";
    const level = ctx.createGain();
    level.gain.value = 0.28;
    chain([
      input,
      biquad(ctx, "highpass", 90),
      drive,
      shaper,
      // Cabinet: tame the fizz, add a little body around 500 Hz.
      biquad(ctx, "peaking", 500, 1),
      biquad(ctx, "lowpass", 3200, 0.8),
      level,
      master,
    ]);
  } else {
    input.connect(master);
  }
  return input;
}

function instrumentBus() {
  if (!buses.has(currentSound)) buses.set(currentSound, buildBus(currentSound));
  return buses.get(currentSound);
}

function pluckBuffer(midi) {
  const ctx = getAudioContext();
  const cacheKey = `${midi}@${ctx.sampleRate}`;
  if (bufferCache.has(cacheKey)) return bufferCache.get(cacheKey);
  const sampleRate = ctx.sampleRate;
  const frequency = midiToFrequency(midi);
  const period = Math.max(2, Math.round(sampleRate / frequency));
  const length = Math.round(sampleRate * PLUCK_SECONDS);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const ring = new Float32Array(period);
  // Slightly low-passed noise as the excitation: a raw white burst sounds
  // like a harpsichord, a softened one closer to a fingered nylon/steel string.
  let previous = 0;
  for (let i = 0; i < period; i += 1) {
    const noise = Math.random() * 2 - 1;
    ring[i] = (noise + previous) * 0.5;
    previous = noise;
  }
  // Per-sample loss so that low notes fade over ~2.5 s. Higher notes decay
  // faster on their own because the two-point average damps them harder.
  const decay = Math.exp(Math.log(0.01) / (sampleRate * 2.5));
  for (let n = 0; n < length; n += 1) {
    const index = n % period;
    const next = (n + 1) % period;
    const sample = ring[index];
    data[n] = sample;
    ring[index] = (sample + ring[next]) * 0.5 * decay;
  }
  bufferCache.set(cacheKey, buffer);
  return buffer;
}

function track(node) {
  activeVoices.add(node);
  node.addEventListener("ended", () => activeVoices.delete(node));
  return node;
}

// Pitch techniques ride on the voice: a faster playback rate is a higher
// note, so slides, bends and releases are rate ramps (`glides`, seconds from
// the onset); vibrato is an LFO on `detune` from `vibratoAt` seconds in; a
// hammered/pulled/tapped note (`legato`) gets a duller, fade-in attack
// instead of the pick transient; a natural harmonic is a sine chime.
const VIBRATO_HZ = 5.5;
const VIBRATO_CENTS = 25;
const LEGATO_CUTOFF_HZ = 1800;
const LEGATO_FADE_SECONDS = 0.015;
const HARMONIC_SECONDS = 1.6;

function rateForInterval(fromMidi, toMidi) {
  return 2 ** ((toMidi - fromMidi) / 12);
}

// Schedules the pitch curve on an AudioParam whose rest value is `unit`
// (playbackRate 1, or the oscillator's base frequency).
function scheduleGlides(param, unit, baseMidi, glides, time, hold) {
  let value = unit;
  param.setValueAtTime(value, time);
  for (const glide of glides) {
    const arrive = time + Math.min(glide.at, hold);
    const span = Math.max(0.01, Math.min(glide.span ?? 0.1, glide.at));
    param.setValueAtTime(value, Math.max(time, arrive - span));
    value = unit * rateForInterval(baseMidi, glide.midi);
    param.exponentialRampToValueAtTime(value, arrive);
  }
}

function addVibrato(target, time, startAt, stopAt) {
  const ctx = getAudioContext();
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.value = VIBRATO_HZ;
  // Ease the wobble in so the attack still reads as one clear pitch.
  const from = time + Math.max(0, startAt);
  depth.gain.setValueAtTime(0, time);
  depth.gain.setValueAtTime(0, from);
  depth.gain.linearRampToValueAtTime(VIBRATO_CENTS, from + 0.25);
  lfo.connect(depth);
  depth.connect(target);
  lfo.start(time);
  lfo.stop(stopAt);
  track(lfo);
}

// A harmonic rings like a small bell: a sine with a touch of octave, dying
// out on its own rather than being held.
function chime({ midi, time, duration, velocity, vibratoAt, glides }) {
  const ctx = getAudioContext();
  const frequency = midiToFrequency(midi);
  const length = Math.max(0.3, Math.min(HARMONIC_SECONDS, duration + 0.2));
  const stopAt = time + length;
  const gain = ctx.createGain();
  const level = Math.max(0.05, Math.min(1, velocity)) * 0.35;
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, stopAt);
  gain.connect(instrumentBus());
  const partials = [
    { ratio: 1, level: 1 },
    { ratio: 2, level: 0.18 },
  ];
  for (const partial of partials) {
    const oscillator = ctx.createOscillator();
    oscillator.type = "sine";
    scheduleGlides(oscillator.frequency, frequency * partial.ratio, midi, glides, time, length);
    const partialGain = ctx.createGain();
    partialGain.gain.value = partial.level;
    oscillator.connect(partialGain);
    partialGain.connect(gain);
    if (vibratoAt !== null && vibratoAt !== undefined) addVibrato(oscillator.detune, time, vibratoAt, stopAt);
    oscillator.start(time);
    oscillator.stop(stopAt);
    track(oscillator);
  }
}

export function pluck({ midi, time, duration = 2, velocity = 1, legato = false, harmonic = false, vibratoAt = null, glides = [] }) {
  const ctx = getAudioContext();
  const baseMidi = Math.round(midi);
  if (harmonic) {
    chime({ midi: baseMidi, time, duration, velocity, vibratoAt, glides });
    return;
  }
  const source = ctx.createBufferSource();
  source.buffer = pluckBuffer(baseMidi);
  const gain = ctx.createGain();
  const level = Math.max(0.05, Math.min(1, velocity)) * 0.5;
  const hold = Math.max(0.08, Math.min(PLUCK_SECONDS - 0.3, duration));
  const stopAt = time + hold + 0.2;
  if (legato) {
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + LEGATO_FADE_SECONDS);
  } else {
    gain.gain.setValueAtTime(level, time);
  }
  gain.gain.setValueAtTime(level, time + hold);
  gain.gain.exponentialRampToValueAtTime(0.001, time + hold + 0.18);

  scheduleGlides(source.playbackRate, 1, baseMidi, glides, time, hold);

  if (legato) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = LEGATO_CUTOFF_HZ;
    source.connect(filter);
    filter.connect(gain);
  } else {
    source.connect(gain);
  }
  gain.connect(instrumentBus());

  if (vibratoAt !== null && vibratoAt !== undefined) addVibrato(source.detune, time, vibratoAt, stopAt);

  source.start(time);
  source.stop(stopAt);
  track(source);
}

export function click({ time, accent = false }) {
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.value = accent ? 1400 : 1000;
  gain.gain.setValueAtTime(accent ? 0.5 : 0.4, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(time);
  oscillator.stop(time + 0.05);
  track(oscillator);
}

let noiseBuffer = null;

function getNoiseBuffer() {
  const ctx = getAudioContext();
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.round(ctx.sampleRate * 0.08);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

// A strum "chk": filtered noise burst. Down-strokes sweep a low-pass down
// (fuller), up-strokes are a thinner band-passed tick, ghost strokes quieter.
export function strum({ time, direction = "down", ghost = false, muted = false }) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer();
  const filter = ctx.createBiquadFilter();
  if (direction === "down" || muted) {
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(muted ? 600 : 900, time);
    filter.frequency.exponentialRampToValueAtTime(250, time + 0.06);
  } else {
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    filter.Q.value = 1.2;
  }
  const gain = ctx.createGain();
  const level = (ghost || muted ? 0.12 : 0.35);
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(time);
  source.stop(time + 0.08);
  track(source);
}

export function stopAllVoices() {
  for (const node of activeVoices) {
    try {
      node.stop();
    } catch {
      // already stopped
    }
  }
  activeVoices.clear();
}
