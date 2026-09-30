// Sound made from recipes, song notes and WAV headers.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  synthesize, sfxRecipe, noteFrequency, parseNotes, SAMPLE_RATE,
  WAVE_SINE, WAVE_SQUARE, SFX_COIN, SFX_EXPLOSION, SFX_RANDOM
} from '../../src/engine/audio/synth.js';
import { readWavInfo } from '../../src/engine/audio/wav.js';
import { hear, SPEED_OF_SOUND } from '../../src/engine/audio/spatial.js';
import { NullAudio } from '../../src/engine/audio/null/null-audio.js';
import { Mat4, Vec3, Quat } from '../../src/engine/math/index.js';
import { World } from '../../src/engine/scene/world.js';
import { projectPoint } from '../../src/engine/collide/camera.js';
import { assert, near } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

// A 16-bit PCM WAV file of mono samples (-1..1), for tests.
export function makeWav(samples, sampleRate = SAMPLE_RATE)
{
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true));
  return bytes;
}

test('a recipe always makes the same sound; another seed makes another', () =>
{
  for (const kind of [SFX_COIN, SFX_EXPLOSION, SFX_RANDOM])
  {
    const a = synthesize(sfxRecipe(kind, 3));
    const b = synthesize(sfxRecipe(kind, 3));
    const c = synthesize(sfxRecipe(kind, 4));
    assert(a.length === b.length && a.every((v, i) => v === b[i]), `kind ${kind}: not the same twice`);
    assert(a.length !== c.length || a.some((v, i) => v !== c[i]), `kind ${kind}: seed 4 sounds like seed 3`);
  }
});

test('length, loudness and pitch are what the recipe asks for', () =>
{
  const tone = synthesize({ wave: WAVE_SINE, freq: 441, ms: 1000, volume: 0.5, attackMs: 1 });
  assert(tone.length === SAMPLE_RATE, `${tone.length} samples for 1000 ms`);
  const peak = tone.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert(peak <= 0.5 && peak > 0.45, `peak ${peak}`);
  // A 441 Hz sine crosses zero upwards 441 times a second.
  let ups = 0;
  for (let i = 1; i < tone.length; i++) if (tone[i - 1] < 0 && tone[i] >= 0) ups++;
  assert(Math.abs(ups - 441) <= 1, `${ups} upward crossings`);
  const slide = synthesize({ wave: WAVE_SQUARE, freq: 200, freqEnd: 800, ms: 400 });
  const crossings = (from, to) =>
  {
    let n = 0;
    for (let i = from + 1; i < to; i++) if ((slide[i - 1] < 0) !== (slide[i] < 0)) n++;
    return n;
  };
  const quarter = slide.length / 4;
  assert(crossings(3 * quarter, slide.length) > 2 * crossings(0, quarter), 'the pitch does not slide up');
});

test('notes: names, sharps, flats and octaves', () =>
{
  near(noteFrequency('A4'), 440, 1e-9, 'A4');
  near(noteFrequency('a5'), 880, 1e-9, 'a5');
  near(noteFrequency('C4'), 261.6255653, 1e-6, 'C4');
  near(noteFrequency('C#4'), noteFrequency('Db4'), 1e-9, 'C#4 = Db4');
  near(noteFrequency('Bb2'), 116.5409404, 1e-6, 'Bb2');
  for (const bad of ['H4', 'C', '4', 'C##4', 'C44', ''])
  {
    assert(noteFrequency(bad) === null, `${bad} is taken for a note`);
  }
});

test('a line of notes: holds, rests, bars, drums and the first wrong token', () =>
{
  const line = parseNotes('C4 - - . | E4 . G4 -');
  assert(line.steps === 8 && line.bad === null, JSON.stringify(line));
  assert(line.events.map((e) => `${e.step}:${e.length}`).join() === '0:3,4:1,6:2', JSON.stringify(line.events));
  near(line.events[1].freq, noteFrequency('E4'), 1e-9, 'E4');
  const drums = parseNotes('k . h . s . kh kk', true);
  assert(drums.events.map((e) => `${e.step}:${e.drums.join('')}`).join() === '0:k,2:h,4:s,6:kh,7:k', JSON.stringify(drums.events));
  assert(parseNotes('C4 X4 D4').bad === 'X4', 'a wrong note is not reported');
  assert(parseNotes('k x', true).bad === 'x', 'a wrong drum is not reported');
  assert(parseNotes('C4 k', false).bad === 'k', 'a drum in a melody is not reported');
  assert(parseNotes('- - C4').events[0].step === 2, 'a hold with nothing before it');
});

test('WAV headers: files written by Python, and what is not a WAV file', () =>
{
  const dir = mkdtempSync(join(tmpdir(), 'pb-wav-'));
  try
  {
    // 16-bit stereo at 22050 Hz, 8-bit mono at 8000 Hz, via Python's wave.
    execFileSync('python3', ['-c', `
import wave, sys
def write(name, channels, width, rate, frames):
    w = wave.open(name, 'wb')
    w.setnchannels(channels); w.setsampwidth(width); w.setframerate(rate)
    w.writeframes(bytes(channels * width * frames))
    w.close()
write(sys.argv[1], 2, 2, 22050, 11025)
write(sys.argv[2], 1, 1, 8000, 4000)
`, join(dir, 'a.wav'), join(dir, 'b.wav')]);
    const a = readWavInfo(readFileSync(join(dir, 'a.wav')));
    assert(a && a.channels === 2 && a.bits === 16 && a.sampleRate === 22050 && a.frames === 11025, JSON.stringify(a));
    near(a.seconds, 0.5, 1e-12, 'a.wav seconds');
    const b = readWavInfo(readFileSync(join(dir, 'b.wav')));
    assert(b && b.channels === 1 && b.bits === 8 && b.frames === 4000, JSON.stringify(b));
  }
  finally
  {
    rmSync(dir, { recursive: true, force: true });
  }
  // Our own writer, with an odd-sized chunk before the data.
  const plain = makeWav(new Array(441).fill(0.25));
  const info = readWavInfo(plain);
  assert(info && info.frames === 441 && info.sampleRate === SAMPLE_RATE, JSON.stringify(info));
  const odd = new Uint8Array(plain.length + 12);
  odd.set(plain.subarray(0, 36));
  odd.set([...'LIST'].map((c) => c.charCodeAt(0)), 36);
  new DataView(odd.buffer).setUint32(40, 3, true);
  odd.set([1, 2, 3, 0], 44);
  odd.set(plain.subarray(36), 48);
  const withList = readWavInfo(odd);
  assert(withList && withList.frames === 441, `after an odd chunk: ${JSON.stringify(withList)}`);
  for (const bytes of [new Uint8Array(0), new TextEncoder().encode('OggS and more bytes'), plain.subarray(0, 30)])
  {
    assert(readWavInfo(bytes) === null, 'something that is not a WAV file is read as one');
  }
});

const at = (x, y, z, yaw = 0) => new Mat4().compose(new Vec3(x, y, z), new Quat().fromEuler(0, yaw, 0), new Vec3(1, 1, 1));
const still = [0, 0, 0];
const plain = { rolloff: 1, doppler: 1, distance: 1 };

test('3D sound: louder close by, from the side it is on', () =>
{
  const ear = at(0, 0, 0);
  const right = hear(ear, at(5, 0, 0), still, still, plain);
  const left = hear(ear, at(-5, 0, 0), still, still, plain);
  const ahead = hear(ear, at(0, 0, 5), still, still, plain);
  near(right.pan, 1, 1e-12, 'right pan');
  near(left.pan, -1, 1e-12, 'left pan');
  near(ahead.pan, 0, 1e-12, 'ahead pan');
  near(right.gain, 1 / 5, 1e-12, 'gain at 5 m');
  near(hear(ear, at(0, 0, 0.5), still, still, plain).gain, 1, 1e-12, 'gain within a metre');
  near(hear(ear, at(0, 0, 5), still, still, { ...plain, rolloff: 0 }).gain, 1, 1e-12, 'no rolloff');
  near(hear(ear, at(0, 0, 5), still, still, { ...plain, distance: 2 }).gain, 1 / 10, 1e-12, 'a unit is 2 m');
  // The listener turned: what was ahead is now to one side.
  const turned = hear(at(0, 0, 0, 90), at(0, 0, 5), still, still, plain);
  near(Math.abs(turned.pan), 1, 1e-9, 'pan after a quarter turn');
  // A turn does not change the distance.
  near(turned.gain, ahead.gain, 1e-12, 'gain after a turn');
});

test('3D sound: what is drawn on the right of the screen is heard on the right', () =>
{
  const world = new World();
  const camera = world.createEntity('camera');
  for (const [pitch, yaw, roll] of [[0, 0, 0], [0, 90, 0], [0, -135, 0], [20, 30, 0], [0, 0, 180]])
  {
    camera.setRotation(pitch, yaw, roll, false);
    camera.setPosition(1, 2, 3, false);
    for (const [x, y, z] of [[4, 2, 3], [-2, 2, 9], [1, 5, 8], [6, 0, -1]])
    {
      const spot = projectPoint(camera, new Vec3(x, y, z), 800, 600);
      const pan = hear(camera.worldMatrix, at(x, y, z), still, still, plain).pan;
      if (!spot.inFront || Math.abs(spot.x - 400) < 1) continue;
      assert(Math.sign(pan) === Math.sign(spot.x - 400), `camera ${pitch},${yaw},${roll}: point ${x},${y},${z} drawn at x ${spot.x.toFixed(1)} but heard with pan ${pan.toFixed(3)}`);
    }
  }
});

test('3D sound: higher while it comes closer, lower going away (Doppler)', () =>
{
  const ear = at(0, 0, 0);
  const coming = hear(ear, at(0, 0, 50), still, [0, 0, -34.3], plain);
  const going = hear(ear, at(0, 0, 50), still, [0, 0, 34.3], plain);
  near(coming.rate, SPEED_OF_SOUND / (SPEED_OF_SOUND - 34.3), 1e-12, 'approaching');
  near(going.rate, SPEED_OF_SOUND / (SPEED_OF_SOUND + 34.3), 1e-12, 'leaving');
  near(hear(ear, at(0, 0, 50), [0, 0, 34.3], still, plain).rate, (SPEED_OF_SOUND + 34.3) / SPEED_OF_SOUND, 1e-12, 'listener approaching');
  near(hear(ear, at(0, 0, 50), still, [34.3, 0, 0], plain).rate, 1, 1e-12, 'passing across');
  near(hear(ear, at(0, 0, 50), still, [0, 0, -34.3], { ...plain, doppler: 0 }).rate, 1, 1e-12, 'Doppler off');
  const wild = hear(ear, at(0, 0, 50), still, [0, 0, -1e6], plain);
  assert(Number.isFinite(wild.rate) && wild.rate <= 2 + 1e-9, `faster than sound: rate ${wild.rate}`);
});

test('headless channels last as long as their sounds, on the engine clock', async () =>
{
  let now = 0;
  const audio = new NullAudio();
  audio.init(() => now);
  const beep = {};
  audio.addSamples(beep, new Float32Array(SAMPLE_RATE / 2));    // 0.5 s
  audio.play(1, beep, { rate: 1 });
  audio.play(2, beep, { rate: 2 });
  audio.play(3, beep, { rate: 1, loop: true });
  now = 0.3;
  assert(audio.playing(1) && !audio.playing(2) && audio.playing(3), 'at 0.3 s');
  audio.pause(1);
  now = 5;
  assert(audio.playing(1), 'a paused channel is not over');
  audio.resume(1);
  now = 5.19;
  assert(audio.playing(1), 'resumed: 0.2 s were left');
  now = 5.21;
  assert(!audio.playing(1), 'still playing after its end');
  audio.play(4, beep, { rate: 1 });
  now = 5.46;
  audio.set(4, { rate: 0.5 });     // 0.25 s played, 0.25 s left: 0.5 s at half speed
  now = 5.95;
  assert(audio.playing(4), 'the rest plays at the new rate');
  now = 5.97;
  assert(!audio.playing(4), 'longer than the new rate allows');
  const info = await audio.decode({}, makeWav(new Array(4410).fill(0)));
  near(info.seconds, 0.1, 1e-12, 'a WAV file lasts');
  const mp3 = await audio.decode({}, new Uint8Array([0x49, 0x44, 0x33, 4, 0]));
  assert(mp3.seconds === 0 && mp3.sampleRate === SAMPLE_RATE, JSON.stringify(mp3));
  audio.reset();
  assert(!audio.playing(3), 'a loop plays on after reset');
});

test('headless songs keep their tempo and end unless they loop', () =>
{
  let now = 0;
  const audio = new NullAudio();
  audio.init(() => now);
  // 120 bpm: a step (a sixteenth) is 0.125 s; 8 steps are 1 s.
  audio.playSong({ bpm: 120, length: 8 }, true);
  now = 0.3;
  assert(audio.songStep() === 2 && audio.songPlaying(), `step ${audio.songStep()}`);
  now = 1.26;
  assert(audio.songStep() === 2, `looped step ${audio.songStep()}`);
  near(audio.songTime(), 1.26, 1e-12, 'time counts through loops');
  audio.playSong({ bpm: 120, length: 8 }, false);
  now = 2.25;
  assert(audio.songPlaying() && audio.songStep() === 7, 'the last step');
  now = 2.26;
  assert(!audio.songPlaying() && audio.songStep() === -1 && audio.songTime() === 0, 'over once it has played');
});

export default unit;
