// Look-ahead scheduler (setInterval keeps ~120 ms of audio queued ahead of
// the clock; a requestAnimationFrame loop fires DOM cues when their time
// comes). Events are expressed in beats so the same builders serve any tempo.
import { click, getAudioContext, pluck, strum, stopAllVoices } from "./engine.js";

const LOOKAHEAD_SECONDS = 0.12;
const TICK_MS = 25;
const START_DELAY = 0.08;

function fire(event, time, secondsPerBeat) {
  if (event.kind === "pluck") {
    pluck({
      midi: event.midi,
      time,
      duration: (event.duration ?? 1) * secondsPerBeat,
      velocity: event.velocity ?? 1,
      legato: Boolean(event.legato),
      harmonic: Boolean(event.harmonic),
      vibratoAt: event.vibratoAt === undefined ? null : event.vibratoAt * secondsPerBeat,
      glides: event.glides?.map(glide => ({ midi: glide.midi, at: glide.beat * secondsPerBeat, span: glide.span * secondsPerBeat })),
    });
  } else if (event.kind === "click") {
    click({ time, accent: Boolean(event.accent) });
  } else if (event.kind === "strum") {
    strum({ time, direction: event.direction, ghost: event.ghost });
  } else if (event.kind === "mute") {
    strum({ time, muted: true });
  }
}

export function createTransport() {
  let timer = null;
  let frame = null;
  let playing = false;
  let current = null;

  function stop() {
    if (timer) clearInterval(timer);
    if (frame) cancelAnimationFrame(frame);
    timer = null;
    frame = null;
    playing = false;
    current = null;
    stopAllVoices();
  }

  function play({ events, bpm, totalBeats, loop = false, onCue, onEnd, id = null }) {
    stop();
    if (!events.length || !bpm || !totalBeats) return false;
    const ctx = getAudioContext();
    const secondsPerBeat = 60 / bpm;
    const startTime = ctx.currentTime + START_DELAY;
    const sorted = [...events].sort((a, b) => a.beat - b.beat);
    let iteration = 0;
    let nextIndex = 0;
    let finished = false;
    const cues = [];
    playing = true;
    current = id;

    function schedule() {
      const horizon = ctx.currentTime + LOOKAHEAD_SECONDS;
      while (!finished) {
        if (nextIndex >= sorted.length) {
          if (!loop) {
            finished = true;
            break;
          }
          iteration += 1;
          nextIndex = 0;
        }
        const event = sorted[nextIndex];
        const time = startTime + (event.beat + iteration * totalBeats) * secondsPerBeat;
        if (time > horizon) break;
        fire(event, time, secondsPerBeat);
        if (event.cue !== undefined) cues.push({ time, cue: event.cue });
        nextIndex += 1;
      }
    }

    const endTime = loop ? Infinity : startTime + totalBeats * secondsPerBeat;

    function tick() {
      const now = ctx.currentTime;
      while (cues.length && cues[0].time <= now) {
        const { cue } = cues.shift();
        onCue?.(cue);
      }
      if (now >= endTime) {
        stop();
        onEnd?.();
        return;
      }
      frame = requestAnimationFrame(tick);
    }

    schedule();
    timer = setInterval(schedule, TICK_MS);
    frame = requestAnimationFrame(tick);
    return true;
  }

  return {
    play,
    stop,
    isPlaying: () => playing,
    currentId: () => current,
  };
}
