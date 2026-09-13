// Web Audio engine: one shared AudioContext, a Karplus-Strong plucked string
// (pre-rendered into cached buffers, see string.js), synthesised body, room
// and cabinet impulse responses (impulse.js), a metronome click and a
// noise-burst strum for rhythm patterns.
import { midiToFrequency } from "@gms/guitar-markdown";
import { renderBodyImpulse, renderCabinetImpulse, renderRoomImpulse } from "./impulse.js";
import { guessString, renderPluck } from "./string.js";

let context = null;
let master = null;
const bufferCache = new Map();
const activeVoices = new Set();

// Instrument sound: the plucked string is the same, what changes is what it
// goes through. `acoustic` adds a guitar body; `electric` rolls off the top
// like a pickup into a clean amp and cabinet; `distortion` drives every
// voice through one shared waveshaper (chords intermodulate like on a real
// amp) then the cabinet. All three get a touch of room.
export const SOUNDS = ["acoustic", "electric", "distortion"];
let currentSound = "acoustic";
const buses = new Map();

const PLUCK_SECONDS = 3;
// Each (pitch, string) is rendered a few times with different noise so
// repeated notes are not stamped out of one mould.
const PLUCK_VARIANTS = 2;
const BUFFER_CACHE_LIMIT = 96;
// Human timing: a few milliseconds early or late, a little softer sometimes.
const HUMAN_JITTER_SECONDS = 0.004;
const HUMAN_VELOCITY_SPREAD = 0.1;

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

function gainNode(value) {
  const node = getAudioContext().createGain();
  node.gain.value = value;
  return node;
}

function chain(nodes) {
  for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

// Two independent renders make a stereo pair, which is what gives the
// acoustic its width.
function convolver(render) {
  const ctx = getAudioContext();
  const left = render({ sampleRate: ctx.sampleRate });
  const right = render({ sampleRate: ctx.sampleRate });
  const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
  buffer.copyToChannel(left, 0);
  buffer.copyToChannel(right, 1);
  const node = ctx.createConvolver();
  node.normalize = false;
  node.buffer = buffer;
  return node;
}

// `from` reaches the master twice: straight, and through an impulse response.
function mixToMaster(from, render, dry, wet) {
  chain([from, gainNode(dry), master]);
  chain([from, convolver(render), gainNode(wet), master]);
}

function buildBus(name) {
  const ctx = getAudioContext();
  const input = ctx.createGain();
  if (name === "electric") {
    const amp = chain([input, biquad(ctx, "highpass", 70), biquad(ctx, "lowpass", 4500, 0.8), convolver(renderCabinetImpulse), gainNode(1.1)]);
    mixToMaster(amp, renderRoomImpulse, 0.85, 0.25);
  } else if (name === "distortion") {
    const drive = gainNode(14);
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(6);
    shaper.oversample = "4x";
    const amp = chain([
      input,
      biquad(ctx, "highpass", 90),
      drive,
      shaper,
      // Cabinet: tame the fizz, add a little body around 500 Hz.
      biquad(ctx, "peaking", 500, 1),
      convolver(renderCabinetImpulse),
      biquad(ctx, "lowpass", 3800, 0.8),
      gainNode(0.28),
    ]);
    mixToMaster(amp, renderRoomImpulse, 0.85, 0.2);
  } else {
    mixToMaster(input, renderBodyImpulse, 0.8, 0.5);
  }
  return input;
}

function instrumentBus() {
  if (!buses.has(currentSound)) buses.set(currentSound, buildBus(currentSound));
  return buses.get(currentSound);
}

function pluckBuffer(midi, string, variant) {
  const ctx = getAudioContext();
  const cacheKey = `${midi}:${string}:${variant}@${ctx.sampleRate}`;
  const cached = bufferCache.get(cacheKey);
  if (cached) {
    // Most recently used goes last, so the eviction below drops the stalest.
    bufferCache.delete(cacheKey);
    bufferCache.set(cacheKey, cached);
    return cached;
  }
  const data = renderPluck({ midi, string, sampleRate: ctx.sampleRate, seconds: PLUCK_SECONDS });
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.copyToChannel(data, 0);
  bufferCache.set(cacheKey, buffer);
  if (bufferCache.size > BUFFER_CACHE_LIMIT) bufferCache.delete(bufferCache.keys().next().value);
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

// Short filtered noise into the instrument bus: the sounds a hand makes on
// the strings besides the note itself.
function noiseCue({ time, seconds, level, filter }) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + seconds);
  chain([source, filter, gain, instrumentBus()]);
  source.start(time);
  source.stop(time + seconds + 0.01);
  track(source);
}

// The pick leaving the string: a bright click just before the tone.
function pickTransient(time, velocity) {
  noiseCue({ time, seconds: 0.006, level: 0.05 * velocity, filter: biquad(getAudioContext(), "highpass", 2500) });
}

// Finger squeak as the hand moves along the string for a slide.
function slideNoise(time, velocity) {
  noiseCue({ time, seconds: 0.05, level: 0.04 * velocity, filter: biquad(getAudioContext(), "bandpass", 1500, 2.5) });
}

export function pluck({ midi, time, duration = 2, velocity = 1, string = null, legato = false, harmonic = false, vibratoAt = null, glides = [] }) {
  const ctx = getAudioContext();
  const baseMidi = Math.round(midi);
  const humanVelocity = velocity * (1 - HUMAN_VELOCITY_SPREAD * Math.random());
  const onset = Math.max(ctx.currentTime, time + (Math.random() * 2 - 1) * HUMAN_JITTER_SECONDS);
  if (harmonic) {
    chime({ midi: baseMidi, time: onset, duration, velocity: humanVelocity, vibratoAt, glides });
    return;
  }
  const source = ctx.createBufferSource();
  source.buffer = pluckBuffer(baseMidi, string ?? guessString(baseMidi), Math.floor(Math.random() * PLUCK_VARIANTS));
  const gain = ctx.createGain();
  const level = Math.max(0.05, Math.min(1, humanVelocity)) * 0.5;
  const hold = Math.max(0.08, Math.min(PLUCK_SECONDS - 0.3, duration));
  const stopAt = onset + hold + 0.2;
  if (legato) {
    gain.gain.setValueAtTime(0.001, onset);
    gain.gain.exponentialRampToValueAtTime(level, onset + LEGATO_FADE_SECONDS);
  } else {
    gain.gain.setValueAtTime(level, onset);
  }
  gain.gain.setValueAtTime(level, onset + hold);
  gain.gain.exponentialRampToValueAtTime(0.001, onset + hold + 0.18);

  scheduleGlides(source.playbackRate, 1, baseMidi, glides, onset, hold);

  // Soft picking is darker as well as quieter; a hammered note has no pick
  // edge at all.
  const tone = biquad(ctx, "lowpass", legato ? LEGATO_CUTOFF_HZ : 2200 + 9000 * humanVelocity ** 2, 0.7);
  chain([source, tone, gain, instrumentBus()]);

  if (!legato) pickTransient(onset, humanVelocity);
  for (const glide of glides) {
    if (glide.type === "slide-up" || glide.type === "slide-down") {
      slideNoise(onset + Math.max(0, Math.min(glide.at, hold) - (glide.span ?? 0.1)), humanVelocity);
    }
  }
  if (vibratoAt !== null && vibratoAt !== undefined) addVibrato(source.detune, onset, vibratoAt, stopAt);

  source.start(onset);
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
