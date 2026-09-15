// Microphone tuner: the mic feeds an analyser, a pitch is read from it a
// few times a second, and the panel shows the note, the offset in cents,
// a needle, and which string of the tuning is closest. One tuner at a time.
import { midiToNoteName } from "@gms/guitar-markdown";
import { getAudioContext } from "./engine.js";
import { detectPitch, noteFromFrequency } from "./pitch.js";

const FFT_SIZE = 4096;
const IN_TUNE_CENTS = 5;
const HISTORY = 5;

let session = null;

export function isMicTunerRunning() {
  return Boolean(session);
}

export function stopMicTuner() {
  if (!session) return;
  const { stream, source, frame, panel } = session;
  cancelAnimationFrame(frame);
  source.disconnect();
  for (const track of stream.getTracks()) track.stop();
  panel.classList.remove("listening");
  panel.querySelector(".mic-tuner-toggle").textContent = "🎤 Accorder au micro";
  panel.querySelector(".mic-tuner-readout").hidden = true;
  for (const button of panel.closest(".tuner-block")?.querySelectorAll(".tuner-string") ?? []) button.classList.remove("target", "in-tune");
  session = null;
}

// `strings`: [{ midi, frequency, element }] of the tuning, from the buttons.
export async function startMicTuner(panel, strings) {
  stopMicTuner();
  const toggle = panel.querySelector(".mic-tuner-toggle");
  const readout = panel.querySelector(".mic-tuner-readout");
  const noteEl = panel.querySelector(".mic-tuner-note");
  const centsEl = panel.querySelector(".mic-tuner-cents");
  const hzEl = panel.querySelector(".mic-tuner-hz");
  const hintEl = panel.querySelector(".mic-tuner-hint");
  const needle = panel.querySelector(".mic-tuner-needle");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (error) {
    hintEl.textContent = "Micro indisponible : autorisez l'accès au microphone.";
    readout.hidden = false;
    console.error("[mic tuner]", error);
    return false;
  }
  const ctx = getAudioContext();
  if (ctx.state !== "running") await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  source.connect(analyser);
  const samples = new Float32Array(FFT_SIZE);
  const history = [];
  panel.classList.add("listening");
  toggle.textContent = "■ Arrêter";
  readout.hidden = false;
  noteEl.textContent = "—";
  centsEl.textContent = "";
  hzEl.textContent = "";
  hintEl.textContent = "Jouez une corde à vide…";
  needle.style.left = "50%";

  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    const found = detectPitch(samples, ctx.sampleRate);
    if (found) {
      history.push(found.frequency);
      if (history.length > HISTORY) history.shift();
      // Median of the last readings: steady against the odd octave slip.
      const sorted = [...history].sort((a, b) => a - b);
      const frequency = sorted[Math.floor(sorted.length / 2)];
      const { midi, cents } = noteFromFrequency(frequency);
      noteEl.textContent = midiToNoteName(midi);
      hzEl.textContent = `${frequency.toFixed(1)} Hz`;
      centsEl.textContent = `${cents > 0 ? "+" : ""}${cents} cents`;
      needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
      // The nearest string of the tuning, in cents.
      let closest = null;
      for (const string of strings) {
        const offset = 1200 * Math.log2(frequency / string.frequency);
        if (!closest || Math.abs(offset) < Math.abs(closest.offset)) closest = { ...string, offset };
      }
      for (const string of strings) string.element.classList.remove("target", "in-tune");
      if (closest && Math.abs(closest.offset) <= 250) {
        const inTune = Math.abs(closest.offset) <= IN_TUNE_CENTS;
        closest.element.classList.add("target");
        if (inTune) closest.element.classList.add("in-tune");
        const rounded = Math.round(closest.offset);
        hintEl.textContent = inTune
          ? `Corde ${closest.number} (${closest.note}) : juste ✓`
          : `Corde ${closest.number} (${closest.note}) : ${rounded > 0 ? `trop haut de ${rounded} cents, détendez` : `trop bas de ${-rounded} cents, tendez`}`;
        panel.classList.toggle("in-tune", inTune);
      } else {
        hintEl.textContent = "Loin de toute corde de l'accordage.";
        panel.classList.remove("in-tune");
      }
    }
    session.frame = requestAnimationFrame(tick);
  };
  session = { stream, source, panel, frame: 0 };
  session.frame = requestAnimationFrame(tick);
  return true;
}
