// Minimal SoundFont 2 reader: enough of the RIFF structure to find, for a
// General MIDI program, the sample zone that covers a note, with its root
// key, tuning, loop points and volume envelope. Pure: takes an ArrayBuffer,
// returns plain objects and Int16 sample views (no Web Audio here).
const GEN = {
  startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3,
  initialFilterFc: 8, attackVolEnv: 34, holdVolEnv: 35, decayVolEnv: 36, sustainVolEnv: 37, releaseVolEnv: 38,
  instrument: 41, keyRange: 43, velRange: 44, initialAttenuation: 48, coarseTune: 51, fineTune: 52,
  sampleID: 53, sampleModes: 54, overridingRootKey: 58,
};

function readChunks(view, start, end) {
  const chunks = [];
  let offset = start;
  while (offset + 8 <= end) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "LIST" || id === "RIFF") {
      const type = String.fromCharCode(view.getUint8(body), view.getUint8(body + 1), view.getUint8(body + 2), view.getUint8(body + 3));
      chunks.push({ id, type, start: body + 4, end: body + size });
    } else {
      chunks.push({ id, start: body, end: body + size });
    }
    offset = body + size + (size % 2);
  }
  return chunks;
}

function readName(view, offset) {
  let name = "";
  for (let i = 0; i < 20; i += 1) {
    const code = view.getUint8(offset + i);
    if (!code) break;
    name += String.fromCharCode(code);
  }
  return name;
}

function readRecords(view, chunk, size, reader) {
  const records = [];
  for (let offset = chunk.start; offset + size <= chunk.end; offset += size) records.push(reader(offset));
  return records;
}

function timecents(value, fallback) {
  return value === undefined ? fallback : 2 ** (value / 1200);
}

export function parseSoundFont(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const [riff] = readChunks(view, 0, arrayBuffer.byteLength);
  if (!riff || riff.id !== "RIFF" || riff.type !== "sfbk") throw new Error("Pas un fichier SoundFont 2.");
  const lists = readChunks(view, riff.start, riff.end);
  const sdta = lists.find(chunk => chunk.type === "sdta");
  const pdta = lists.find(chunk => chunk.type === "pdta");
  if (!sdta || !pdta) throw new Error("SoundFont incomplet.");
  const smpl = readChunks(view, sdta.start, sdta.end).find(chunk => chunk.id === "smpl");
  const samples16 = new Int16Array(arrayBuffer, smpl.start, (smpl.end - smpl.start) >> 1);
  const parts = Object.fromEntries(readChunks(view, pdta.start, pdta.end).map(chunk => [chunk.id, chunk]));

  const presets = readRecords(view, parts.phdr, 38, o => ({ name: readName(view, o), program: view.getUint16(o + 20, true), bank: view.getUint16(o + 22, true), bagIndex: view.getUint16(o + 24, true) }));
  const presetBags = readRecords(view, parts.pbag, 4, o => ({ genIndex: view.getUint16(o, true) }));
  const presetGens = readRecords(view, parts.pgen, 4, o => ({ oper: view.getUint16(o, true), lo: view.getUint8(o + 2), hi: view.getUint8(o + 3), amount: view.getInt16(o + 2, true), uamount: view.getUint16(o + 2, true) }));
  const instruments = readRecords(view, parts.inst, 22, o => ({ name: readName(view, o), bagIndex: view.getUint16(o + 20, true) }));
  const instBags = readRecords(view, parts.ibag, 4, o => ({ genIndex: view.getUint16(o, true) }));
  const instGens = readRecords(view, parts.igen, 4, o => ({ oper: view.getUint16(o, true), lo: view.getUint8(o + 2), hi: view.getUint8(o + 3), amount: view.getInt16(o + 2, true), uamount: view.getUint16(o + 2, true) }));
  const headers = readRecords(view, parts.shdr, 46, o => ({
    name: readName(view, o), start: view.getUint32(o + 20, true), end: view.getUint32(o + 24, true), loopStart: view.getUint32(o + 28, true), loopEnd: view.getUint32(o + 32, true),
    sampleRate: view.getUint32(o + 36, true), originalPitch: view.getUint8(o + 40), pitchCorrection: view.getInt8(o + 41), type: view.getUint16(o + 44, true),
  }));

  // Zones of a bag range: each a map of generator → record; the first zone
  // without a terminal generator (instrument / sampleID) is the global one.
  function zones(bags, gens, from, to, terminal) {
    const list = [];
    let global = new Map();
    for (let b = from; b < to; b += 1) {
      const zone = new Map();
      for (let g = bags[b].genIndex; g < (bags[b + 1]?.genIndex ?? gens.length); g += 1) zone.set(gens[g].oper, gens[g]);
      if (!zone.has(terminal)) {
        if (b === from) global = zone;
        continue;
      }
      list.push(new Map([...global, ...zone]));
    }
    return list;
  }

  function instrumentZones(index) {
    const from = instruments[index].bagIndex;
    const to = instruments[index + 1]?.bagIndex ?? instBags.length;
    return zones(instBags, instGens, from, to, GEN.sampleID);
  }

  // Every sample zone of a program (bank 0), flattened through its presets.
  function programZones(program, bank = 0) {
    const presetIndex = presets.findIndex(preset => preset.program === program && preset.bank === bank);
    if (presetIndex < 0) return [];
    const from = presets[presetIndex].bagIndex;
    const to = presets[presetIndex + 1]?.bagIndex ?? presetBags.length;
    const result = [];
    for (const presetZone of zones(presetBags, presetGens, from, to, GEN.instrument)) {
      const keyRange = presetZone.get(GEN.keyRange);
      for (const zone of instrumentZones(presetZone.get(GEN.instrument).uamount)) {
        const range = zone.get(GEN.keyRange);
        const lo = Math.max(range?.lo ?? 0, keyRange?.lo ?? 0);
        const hi = Math.min(range?.hi ?? 127, keyRange?.hi ?? 127);
        if (lo > hi) continue;
        const header = headers[zone.get(GEN.sampleID).uamount];
        const modes = zone.get(GEN.sampleModes)?.uamount ?? 0;
        const rootKey = zone.get(GEN.overridingRootKey)?.uamount ?? header.originalPitch;
        result.push({
          lo, hi, name: header.name, sampleRate: header.sampleRate,
          start: header.start + (zone.get(GEN.startAddrsOffset)?.amount ?? 0),
          end: header.end + (zone.get(GEN.endAddrsOffset)?.amount ?? 0),
          loopStart: header.loopStart + (zone.get(GEN.startloopAddrsOffset)?.amount ?? 0),
          loopEnd: header.loopEnd + (zone.get(GEN.endloopAddrsOffset)?.amount ?? 0),
          loops: (modes & 3) === 1 || (modes & 3) === 3,
          rootKey: rootKey > 127 ? header.originalPitch : rootKey,
          // Total tuning in cents: the sample's own correction plus the zone's.
          tuneCents: header.pitchCorrection + (zone.get(GEN.coarseTune)?.amount ?? 0) * 100 + (zone.get(GEN.fineTune)?.amount ?? 0),
          attenuationDb: (zone.get(GEN.initialAttenuation)?.amount ?? 0) / 10,
          filterHz: zone.get(GEN.initialFilterFc) ? 8.176 * 2 ** (zone.get(GEN.initialFilterFc).amount / 1200) : null,
          envelope: {
            attack: timecents(zone.get(GEN.attackVolEnv)?.amount, 0.001),
            hold: timecents(zone.get(GEN.holdVolEnv)?.amount, 0.001),
            decay: timecents(zone.get(GEN.decayVolEnv)?.amount, 0.001),
            // Sustain is an attenuation in centibels: 0 = full level.
            sustain: 10 ** (-(zone.get(GEN.sustainVolEnv)?.amount ?? 0) / 200),
            release: timecents(zone.get(GEN.releaseVolEnv)?.amount, 0.001),
          },
        });
      }
    }
    return result;
  }

  return {
    presets: presets.filter(preset => preset.name !== "EOP").map(({ name, program, bank }) => ({ name, program, bank })),
    programZones,
    // Float samples of a zone, in [-1, 1].
    zoneSamples(zone) {
      const data = new Float32Array(Math.max(0, zone.end - zone.start));
      for (let i = 0; i < data.length; i += 1) data[i] = samples16[zone.start + i] / 32768;
      return data;
    },
  };
}

// The zone whose key range covers `midi`, or the nearest one.
export function zoneForNote(zones, midi) {
  let best = null;
  for (const zone of zones) {
    if (midi >= zone.lo && midi <= zone.hi) return zone;
    const distance = midi < zone.lo ? zone.lo - midi : midi - zone.hi;
    if (!best || distance < best.distance) best = { zone, distance };
  }
  return best?.zone ?? null;
}
