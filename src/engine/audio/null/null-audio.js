// The headless audio backend: nothing is heard, but everything a program
// can ask about sound behaves as in the browser, on the engine's clock of
// simulated time. A channel plays for as long as its sound lasts (at its
// rate), a looping one until it is stopped, and songs keep their tempo, so
// programs and tests that wait for a sound or follow a song's beat run the
// same everywhere.
//
// Files: the length and rate of a WAV file are read from its header; other
// formats (OGG, MP3) cannot be measured here: they play for no time at all
// and count as SAMPLE_RATE, as in the browser (which resamples them).

import { AudioBackend } from '../backend.js';
import { readWavInfo } from '../wav.js';
import { SAMPLE_RATE, STEPS_PER_BEAT } from '../synth.js';

export class NullAudio extends AudioBackend
{
  constructor()
  {
    super();
    this.clock = () => 0;
    this.lengths = new Map();    // Sound -> seconds
    this.channels = new Map();   // id -> { start, seconds, rate, loop, pausedAt }
    this.song = null;            // { start, stepTime, length, loop }
  }

  init(clock)
  {
    this.clock = clock;
  }

  addSamples(sound, samples)
  {
    this.lengths.set(sound, samples.length / SAMPLE_RATE);
  }

  decode(sound, bytes)
  {
    const wav = readWavInfo(bytes);
    const info = wav ? { seconds: wav.seconds, sampleRate: wav.sampleRate } : { seconds: 0, sampleRate: SAMPLE_RATE };
    this.lengths.set(sound, info.seconds);
    return Promise.resolve(info);
  }

  freeSound(sound)
  {
    this.lengths.delete(sound);
  }

  play(id, sound, options)
  {
    this.start(id, this.lengths.get(sound) || 0, options.rate || 1, options.loop);
  }

  playMusic(id, bytes, options)
  {
    const wav = readWavInfo(bytes);
    const seconds = wav ? wav.seconds : 0;
    this.start(id, seconds, 1, options.loop);
    return Promise.resolve({ seconds });
  }

  start(id, seconds, rate, loop)
  {
    this.channels.set(id, { start: this.clock(), seconds, rate: Math.max(0.05, Math.min(16, rate)), loop: !!loop && seconds > 0, pausedAt: -1, left: 0 });
  }

  // Seconds of sound left on a channel, as of now (Infinity when looping).
  left(c, now)
  {
    if (c.loop) return Infinity;
    if (c.pausedAt >= 0) return c.left;
    return c.seconds / c.rate - (now - c.start);
  }

  set(id, values)
  {
    const c = this.channels.get(id);
    if (!c || values.rate === undefined) return;
    // The part still to play goes on at the new rate.
    const rate = Math.max(0.05, Math.min(16, values.rate));
    if (!c.loop)
    {
      if (c.pausedAt >= 0) c.left = c.left * c.rate / rate;
      else
      {
        const now = this.clock();
        c.start = now - (now - c.start) * c.rate / rate;
      }
    }
    c.rate = rate;
  }

  stop(id)
  {
    this.channels.delete(id);
  }

  pause(id)
  {
    const c = this.channels.get(id);
    if (!c || c.pausedAt >= 0) return;
    const now = this.clock();
    c.left = this.left(c, now);
    c.pausedAt = now;
  }

  resume(id)
  {
    const c = this.channels.get(id);
    if (!c || c.pausedAt < 0) return;
    const now = this.clock();
    if (!c.loop) c.start = now - (c.seconds / c.rate - c.left);
    c.pausedAt = -1;
  }

  playing(id)
  {
    const c = this.channels.get(id);
    if (!c) return false;
    if (this.left(c, this.clock()) > 1e-9) return true;
    this.channels.delete(id);
    return false;
  }

  playSong(song, loop)
  {
    this.song = { start: this.clock(), stepTime: 60 / song.bpm / STEPS_PER_BEAT, length: song.length, loop: !!loop };
  }

  stopSong()
  {
    this.song = null;
  }

  // The song still being heard, or null (a song that does not loop ends).
  heard()
  {
    const s = this.song;
    if (s && !s.loop && this.clock() - s.start >= s.length * s.stepTime - 1e-9) this.song = null;
    return this.song;
  }

  songPlaying()
  {
    return !!this.heard();
  }

  songTime()
  {
    const s = this.heard();
    return s ? this.clock() - s.start : 0;
  }

  songStep()
  {
    const s = this.heard();
    if (!s) return -1;
    return Math.floor((this.clock() - s.start) / s.stepTime + 1e-9) % s.length;
  }

  reset()
  {
    this.channels.clear();
    this.song = null;
  }
}
