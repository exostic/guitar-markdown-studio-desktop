// Extended Karplus-Strong plucked string, rendered offline into a
// Float32Array that the engine plays back as a buffer (a live DelayNode loop
// is quantised to 128-sample blocks and drifts out of tune above ~300 Hz).
//
// Loop: fractional delay (linear interpolation) → loss filter
// (1-b)·x[n] + b·x[n-1] → per-pass decay. The loss filter's phase delay
// (≈ b samples) and the interpolation fraction both count towards the
// period, so the fundamental lands within a couple of cents at any fret —
// the old integer period was ~20 cents sharp high on the first string.
import { midiToFrequency } from "@gms/guitar-markdown";

// Per-string character (1 = high e … 6 = low E). Wound strings are darker,
// ring longer and are picked farther from the bridge; plain strings are
// bright and thin. `excite` low-passes the noise burst, `pluckPoint` is the
// pick position as a fraction of the string length (a comb on the burst).
export const STRING_CHARACTER = {
  1: { brightness: 0.34, decay: 3.0, pluckPoint: 0.13, excite: 0.15 },
  2: { brightness: 0.36, decay: 3.2, pluckPoint: 0.14, excite: 0.2 },
  3: { brightness: 0.38, decay: 3.4, pluckPoint: 0.15, excite: 0.25 },
  4: { brightness: 0.42, decay: 3.6, pluckPoint: 0.16, excite: 0.35 },
  5: { brightness: 0.45, decay: 3.8, pluckPoint: 0.17, excite: 0.42 },
  6: { brightness: 0.48, decay: 4.0, pluckPoint: 0.18, excite: 0.5 },
};

// When the caller does not know the string (chord voicings, the tuner), take
// the one a guitarist would most likely play that pitch on.
export function guessString(midi) {
  if (midi < 50) return 6;
  if (midi < 55) return 5;
  if (midi < 60) return 4;
  if (midi < 64) return 3;
  if (midi < 69) return 2;
  return 1;
}

export function renderPluck({ midi, string, sampleRate, seconds = 3, random = Math.random }) {
  const character = STRING_CHARACTER[string] ?? STRING_CHARACTER[guessString(midi)];
  const frequency = midiToFrequency(midi);
  const period = sampleRate / frequency;
  // High notes make many more loop passes per second, so ease the loss
  // filter off as the pitch rises or they would die in a blink.
  const b = character.brightness * Math.min(1, (220 / frequency) ** 0.5);
  const delayLength = Math.max(2, Math.floor(period - b));
  const fraction = Math.min(0.999, Math.max(0, period - b - delayLength));
  // Per pass, so the fundamental reaches -40 dB after `decay` seconds
  // whatever the pitch.
  const decay = 0.01 ** (1 / (character.decay * frequency));
  const length = Math.round(sampleRate * seconds);
  const data = new Float32Array(length);

  // Excitation: one period of softened noise, comb-filtered at the pluck
  // point (the pick cancels the harmonics with a node under it).
  const burstLength = delayLength + 1;
  const burst = new Float32Array(burstLength);
  let smooth = 0;
  for (let i = 0; i < burstLength; i += 1) {
    const noise = random() * 2 - 1;
    smooth = smooth * character.excite + noise * (1 - character.excite);
    burst[i] = smooth;
  }
  const combDelay = Math.max(1, Math.round(period * character.pluckPoint));
  const excitation = new Float32Array(burstLength + combDelay);
  for (let i = 0; i < excitation.length; i += 1) {
    excitation[i] = (burst[i] ?? 0) - 0.9 * (i >= combDelay ? burst[i - combDelay] ?? 0 : 0);
  }

  let previous = 0;
  let peak = 0;
  for (let n = 0; n < length; n += 1) {
    const a = n >= delayLength ? data[n - delayLength] : 0;
    const c = n > delayLength ? data[n - delayLength - 1] : 0;
    const delayed = a + (c - a) * fraction;
    const filtered = (1 - b) * delayed + b * previous;
    previous = delayed;
    const sample = (n < excitation.length ? excitation[n] : 0) + decay * filtered;
    data[n] = sample;
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  if (peak > 0) {
    const scale = 0.8 / peak;
    for (let n = 0; n < length; n += 1) data[n] *= scale;
  }
  return data;
}
