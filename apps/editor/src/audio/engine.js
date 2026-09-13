// Web Audio engine: one shared AudioContext, a Karplus-Strong plucked string
// (pre-rendered into cached buffers — a DelayNode feedback loop would be
// quantised to 128-sample blocks and drift out of tune above ~300 Hz), a
// metronome click and a noise-burst strum for rhythm patterns.
import { midiToFrequency } from "@gms/guitar-markdown";

let context = null;
let master = null;
const bufferCache = new Map();
const activeVoices = new Set();

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

export function pluck({ midi, time, duration = 2, velocity = 1 }) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = pluckBuffer(Math.round(midi));
  const gain = ctx.createGain();
  const level = Math.max(0.05, Math.min(1, velocity)) * 0.5;
  const hold = Math.max(0.08, Math.min(PLUCK_SECONDS - 0.3, duration));
  gain.gain.setValueAtTime(level, time);
  gain.gain.setValueAtTime(level, time + hold);
  gain.gain.exponentialRampToValueAtTime(0.001, time + hold + 0.18);
  source.connect(gain);
  gain.connect(master);
  source.start(time);
  source.stop(time + hold + 0.2);
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
