// Pitch detection for the microphone tuner: normalised autocorrelation on
// a block of samples, the first strong peak after the zero-lag one gives the
// period, refined by parabolic interpolation. Returns null when the block
// is too quiet or has no clear period (silence, noise, a chord).
const MIN_FREQUENCY = 60; // below the low E of a dropped tuning
const MAX_FREQUENCY = 1400;
const RMS_GATE = 0.01;
const CLARITY_GATE = 0.85;

export function detectPitch(samples, sampleRate) {
  const size = samples.length;
  let rms = 0;
  for (let i = 0; i < size; i += 1) rms += samples[i] * samples[i];
  rms = Math.sqrt(rms / size);
  if (rms < RMS_GATE) return null;

  const minLag = Math.floor(sampleRate / MAX_FREQUENCY);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_FREQUENCY), size - 1);
  // Normalised square difference (McLeod-style), so clarity is 0..1.
  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let acf = 0;
    let m = 0;
    for (let i = 0; i + lag < size; i += 1) {
      acf += samples[i] * samples[i + lag];
      m += samples[i] * samples[i] + samples[i + lag] * samples[i + lag];
    }
    nsdf[lag] = m > 0 ? (2 * acf) / m : 0;
  }
  // First peak that stands out, not the highest overall: the octave below
  // would otherwise win on strong harmonics.
  let bestLag = -1;
  let bestValue = 0;
  let lag = minLag;
  while (lag <= maxLag && nsdf[lag] > 0) lag += 1; // leave the zero-lag lobe
  while (lag <= maxLag) {
    if (nsdf[lag] > 0) {
      let peakLag = lag;
      while (lag + 1 <= maxLag && nsdf[lag + 1] > 0) {
        lag += 1;
        if (nsdf[lag] > nsdf[peakLag]) peakLag = lag;
      }
      if (bestLag < 0 || nsdf[peakLag] > bestValue) {
        if (nsdf[peakLag] >= CLARITY_GATE || bestLag < 0) {
          bestLag = peakLag;
          bestValue = nsdf[peakLag];
        }
      }
      if (bestValue >= CLARITY_GATE) break;
    }
    lag += 1;
  }
  if (bestLag < 0 || bestValue < CLARITY_GATE) return null;
  const y0 = nsdf[bestLag - 1] ?? bestValue;
  const y2 = nsdf[bestLag + 1] ?? bestValue;
  const denominator = y0 - 2 * bestValue + y2;
  const shift = denominator ? (0.5 * (y0 - y2)) / denominator : 0;
  const frequency = sampleRate / (bestLag + shift);
  return { frequency, clarity: bestValue, rms };
}

// Nearest equal-tempered note and the offset from it in cents.
export function noteFromFrequency(frequency, a4 = 440) {
  const midi = 69 + 12 * Math.log2(frequency / a4);
  const nearest = Math.round(midi);
  return { midi: nearest, cents: Math.round((midi - nearest) * 100) };
}
