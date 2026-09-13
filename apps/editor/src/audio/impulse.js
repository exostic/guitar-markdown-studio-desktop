// Synthesised impulse responses, so the "amp" needs no audio assets: a
// guitar body (a few resonant modes over a short, dense reflection tail), a
// small room, and a speaker cabinet (a fast, low-passed burst with a thump).
// Each render uses fresh noise, so two renders make a stereo pair.

function addMode(data, sampleRate, { frequency, decay, level }, random) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const phase = random() * 2 * Math.PI;
  const tau = decay * sampleRate;
  for (let n = 0; n < data.length; n += 1) {
    data[n] += level * Math.sin(omega * n + phase) * Math.exp(-n / tau);
  }
}

// Low-passed noise fading with time constant `decay` seconds.
function addTail(data, sampleRate, { decay, level, smoothing }, random) {
  const tau = decay * sampleRate;
  let smooth = 0;
  for (let n = 0; n < data.length; n += 1) {
    const noise = random() * 2 - 1;
    smooth = smooth * smoothing + noise * (1 - smoothing);
    data[n] += level * smooth * Math.exp(-n / tau);
  }
}

// Unit energy: a broadband signal keeps its level through the convolution,
// the modes then read as bumps rather than as an overall boost.
function normalizeEnergy(data) {
  let energy = 0;
  for (let n = 0; n < data.length; n += 1) energy += data[n] * data[n];
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 1;
  for (let n = 0; n < data.length; n += 1) data[n] *= scale;
  return data;
}

export const BODY_MODES = [
  { frequency: 102, decay: 0.04, level: 0.06 }, // air (Helmholtz) resonance
  { frequency: 196, decay: 0.03, level: 0.045 }, // top plate
  { frequency: 298, decay: 0.022, level: 0.03 },
  { frequency: 425, decay: 0.018, level: 0.03 },
  { frequency: 640, decay: 0.012, level: 0.025 },
];

export function renderBodyImpulse({ sampleRate, seconds = 0.3, random = Math.random }) {
  const data = new Float32Array(Math.round(sampleRate * seconds));
  for (const mode of BODY_MODES) addMode(data, sampleRate, mode, random);
  addTail(data, sampleRate, { decay: 0.02, level: 1.6, smoothing: 0.35 }, random);
  addTail(data, sampleRate, { decay: 0.09, level: 0.25, smoothing: 0.7 }, random);
  return normalizeEnergy(data);
}

export function renderRoomImpulse({ sampleRate, seconds = 0.35, random = Math.random }) {
  const data = new Float32Array(Math.round(sampleRate * seconds));
  addTail(data, sampleRate, { decay: 0.03, level: 1, smoothing: 0.5 }, random);
  addTail(data, sampleRate, { decay: 0.11, level: 0.35, smoothing: 0.85 }, random);
  return normalizeEnergy(data);
}

export function renderCabinetImpulse({ sampleRate, seconds = 0.03, random = Math.random }) {
  const data = new Float32Array(Math.round(sampleRate * seconds));
  addTail(data, sampleRate, { decay: 0.0025, level: 1, smoothing: 0.72 }, random);
  addMode(data, sampleRate, { frequency: 110, decay: 0.012, level: 0.03 }, random);
  addMode(data, sampleRate, { frequency: 2600, decay: 0.0015, level: 0.12 }, random);
  return normalizeEnergy(data);
}
