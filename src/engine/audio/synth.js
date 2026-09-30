// Sounds made from a recipe instead of a file, and the notes of songs.
// Plain functions on numbers: the same code runs in Node and in the
// browser, and the same recipe always gives the same samples.
//
//   synthesize(recipe)       mono samples at SAMPLE_RATE
//   sfxRecipe(kind, seed)    the recipe of a ready-made effect (SFX_*)
//   noteFrequency("C#4")     Hz (A4 = 440)
//   parseNotes(line, drums)  a song track's line of notes, step by step

export const SAMPLE_RATE = 44100;

export const WAVE_SQUARE = 0;
export const WAVE_TRIANGLE = 1;
export const WAVE_SAW = 2;
export const WAVE_SINE = 3;
export const WAVE_NOISE = 4;

export const SFX_COIN = 0;
export const SFX_LASER = 1;
export const SFX_EXPLOSION = 2;
export const SFX_POWERUP = 3;
export const SFX_HIT = 4;
export const SFX_JUMP = 5;
export const SFX_BLIP = 6;
export const SFX_RANDOM = 7;

export const INST_SQUARE = 0;
export const INST_TRIANGLE = 1;
export const INST_SAW = 2;
export const INST_SINE = 3;
export const INST_DRUMS = 4;
export const INST_PLUCK = 5;
export const INST_PAD = 6;
export const INST_BASS = 7;

// One step of a song is a sixteenth note.
export const STEPS_PER_BEAT = 4;

// A small seeded generator (mulberry32).
export function makeRandom(seed)
{
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () =>
  {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One sound as mono samples at SAMPLE_RATE. The recipe:
//   wave        WAVE_*
//   freq        Hz at the start, sliding to freqEnd by the end
//   ms          length in milliseconds
//   volume      0..1
//   attackMs    fade-in time
//   arpAt       0..1 of the length where the pitch jumps by arpMul (coins)
//   vibDepth    0..1, vibrato of vibHz
//   lowpass     a filter cutoff in Hz sliding to lowpassEnd (0: none)
//   seed        for noise
export function synthesize(recipe)
{
  const {
    wave = WAVE_SQUARE, freq = 440, freqEnd = freq, ms = 200, volume = 0.5, attackMs = 4,
    arpAt = 0, arpMul = 1, vibDepth = 0, vibHz = 0, lowpass = 0, lowpassEnd = lowpass, seed = 1
  } = recipe;
  const length = Math.max(1, Math.round(SAMPLE_RATE * Math.max(5, ms) / 1000));
  const out = new Float32Array(length);
  const attack = Math.max(1, Math.round(SAMPLE_RATE * attackMs / 1000));
  const random = makeRandom(seed);
  let phase = 0;
  let noiseValue = random() * 2 - 1;
  let filtered = 0;
  for (let i = 0; i < length; i++)
  {
    const t = i / length;
    let f = freq + (freqEnd - freq) * t;
    if (arpAt > 0 && t >= arpAt) f *= arpMul;
    if (vibDepth > 0) f *= 1 + vibDepth * Math.sin(2 * Math.PI * vibHz * i / SAMPLE_RATE);
    phase += Math.max(1, f) / SAMPLE_RATE;
    if (phase >= 1)
    {
      phase -= Math.floor(phase);
      noiseValue = random() * 2 - 1;     // noise: a new value every period
    }
    let s;
    switch (wave)
    {
      case WAVE_TRIANGLE: s = 1 - 4 * Math.abs(phase - 0.5); break;
      case WAVE_SAW: s = 2 * phase - 1; break;
      case WAVE_SINE: s = Math.sin(2 * Math.PI * phase); break;
      case WAVE_NOISE: s = noiseValue; break;
      default: s = phase < 0.5 ? 0.6 : -0.6; break;   // square, a little quieter
    }
    if (lowpass > 0)
    {
      const cutoff = lowpass + (lowpassEnd - lowpass) * t;
      const a = 1 - Math.exp(-2 * Math.PI * Math.max(20, cutoff) / SAMPLE_RATE);
      filtered += a * (s - filtered);
      s = filtered;
    }
    const env = i < attack ? i / attack : (1 - t) * (1 - t);
    out[i] = s * env * volume;
  }
  return out;
}

// The recipe of one of the ready-made effects; `seed` gives a variation.
export function sfxRecipe(kind, seed = 0)
{
  const r = makeRandom((Number(seed) || 0) * 7919 + (Number(kind) || 0) + 1);
  const vary = (value, amount) => value * (1 + (r() * 2 - 1) * amount);
  switch (Number(kind))
  {
    case SFX_COIN:
      return { wave: WAVE_SQUARE, freq: vary(990, 0.2), ms: vary(260, 0.2), arpAt: 0.22, arpMul: 1.5, volume: 0.45 };
    case SFX_LASER:
      return { wave: r() < 0.5 ? WAVE_SAW : WAVE_SQUARE, freq: vary(1300, 0.3), freqEnd: vary(180, 0.3), ms: vary(170, 0.3), volume: 0.4 };
    case SFX_EXPLOSION:
      return { wave: WAVE_NOISE, freq: vary(900, 0.3), freqEnd: vary(60, 0.3), ms: vary(700, 0.3), lowpass: 5000, lowpassEnd: 200, volume: 0.9, seed: r() * 1e9 };
    case SFX_POWERUP:
      return { wave: WAVE_SQUARE, freq: vary(350, 0.2), freqEnd: vary(1300, 0.2), ms: vary(420, 0.2), vibDepth: 0.06, vibHz: 18, volume: 0.4 };
    case SFX_HIT:
      return { wave: WAVE_NOISE, freq: vary(1600, 0.3), freqEnd: vary(200, 0.3), ms: vary(130, 0.3), lowpass: 3000, volume: 0.7, seed: r() * 1e9 };
    case SFX_JUMP:
      return { wave: WAVE_SQUARE, freq: vary(260, 0.2), freqEnd: vary(720, 0.2), ms: vary(190, 0.2), volume: 0.4 };
    case SFX_BLIP:
      return { wave: WAVE_SQUARE, freq: vary(880, 0.25), ms: vary(60, 0.2), volume: 0.35 };
    default:
    {
      const wave = Math.floor(r() * 5);
      return {
        wave, freq: 100 + r() * 1500, freqEnd: 100 + r() * 1500, ms: 60 + r() * 500,
        arpAt: r() < 0.3 ? 0.3 : 0, arpMul: 1 + r(), vibDepth: r() < 0.3 ? r() * 0.2 : 0, vibHz: 5 + r() * 20,
        lowpass: wave === WAVE_NOISE ? 4000 : 0, lowpassEnd: 300, volume: 0.45, seed: r() * 1e9
      };
    }
  }
}

// The drum sounds of INST_DRUMS tracks: k (kick), s (snare), h (hi-hat).
export const DRUM_RECIPES = {
  k: { wave: WAVE_SINE, freq: 150, freqEnd: 40, ms: 220, volume: 0.9, attackMs: 1 },
  s: { wave: WAVE_NOISE, freq: 6000, ms: 160, lowpass: 7000, lowpassEnd: 2500, volume: 0.5, attackMs: 1, seed: 7 },
  h: { wave: WAVE_NOISE, freq: 12000, ms: 45, volume: 0.22, attackMs: 1, seed: 3 }
};

// ---------------------------------------------------------------- notes

const NOTE_INDEX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// "C4", "C#4", "Eb3" -> Hz (A4 = 440); null for anything else.
export function noteFrequency(token)
{
  const m = /^([a-g])([#b]?)(-?\d)$/i.exec(String(token));
  if (!m) return null;
  let semitone = NOTE_INDEX[m[1].toLowerCase()];
  if (m[2] === '#') semitone += 1;
  else if (m[2] === 'b') semitone -= 1;
  const midi = 12 * (Number(m[3]) + 1) + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// A track's line of notes, one token per step, separated by spaces or "|"
// (to mark bars): a note (C4, F#3, Bb2) starts it, "-" holds the previous
// note one more step, "." is a step of silence. Drum tracks use k, s and
// h, alone or together ("kh").
// Returns { events: [{ step, length, freq | drums }], steps, bad } where
// `bad` is the first token that is none of these (or null).
export function parseNotes(text, drums = false)
{
  const tokens = String(text || '').split(/[\s|]+/).filter((t) => t.length > 0);
  const events = [];
  let last = null;
  let bad = null;
  tokens.forEach((token, step) =>
  {
    if (token === '-')
    {
      if (last) last.length++;
      return;
    }
    last = null;
    if (token === '.') return;
    if (drums)
    {
      const hits = [...token.toLowerCase()];
      if (hits.every((c) => c === 'k' || c === 's' || c === 'h')) events.push({ step, length: 1, drums: [...new Set(hits)] });
      else if (bad === null) bad = token;
      return;
    }
    const freq = noteFrequency(token);
    if (freq === null)
    {
      if (bad === null) bad = token;
      return;
    }
    last = { step, length: 1, freq };
    events.push(last);
  });
  return { events, steps: tokens.length, bad };
}
