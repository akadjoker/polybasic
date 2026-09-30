// Sound for PolyBasic programs: the engine's side. It keeps the sounds
// (loaded from files or made from recipes), the channels that play them,
// the songs, and the 3D listener with the sounds placed in the world, and
// tells an audio backend (backend.js) what to play.
//
// Sounds and songs are handles in the world's handle space, like entities.
// Channels are numbers of their own: a channel that has finished is
// forgotten after a while, and asking about it then is not an error (it
// just is not playing).

import { synthesize, sfxRecipe, parseNotes, SAMPLE_RATE, INST_DRUMS } from './synth.js';
import { hear } from './spatial.js';
import { Mat4 } from '../math/mat4.js';
import { STEP_MS } from '../../runtime/runtime.js';

// Finished channels are forgotten once there are more than this many.
const KEEP_CHANNELS = 256;

export class Sound
{
  constructor()
  {
    this.handleKind = 'a sound';
    this.handle = 0;
    this.file = '';
    this.loaded = false;
    this.failed = false;
    this.seconds = 0;
    this.sampleRate = SAMPLE_RATE;
    // How PlaySound plays it (LoopSound, SoundVolume, SoundPitch, SoundPan).
    this.loop = false;
    this.volume = 1;
    this.pitch = 0;          // Hz to play it at; 0: as recorded
    this.pan = 0;
    this.recipeKey = null;   // made from a recipe: its cache key
  }

  // Playback rate for a frequency in Hz (0: as recorded).
  rateFor(hz)
  {
    return hz > 0 ? hz / this.sampleRate : 1;
  }
}

export class Song
{
  constructor(bpm)
  {
    this.handleKind = 'a song';
    this.handle = 0;
    this.bpm = bpm;
    this.tracks = [];
  }

  // Steps before it starts again: the longest track's.
  get length()
  {
    return this.tracks.reduce((m, t) => Math.max(m, t.steps), 0);
  }
}

export class Audio
{
  constructor(engine, backend)
  {
    this.engine = engine;
    this.world = engine.world;
    this.backend = backend;
    // Simulated time: steps so far. The browser plays on its own audio
    // clock; this one is for the headless backend and 3D velocities.
    backend.init(() => engine.steps * STEP_MS / 1000);
    this.recipes = new Map();      // recipe key -> Sound
    this.channels = new Map();     // id -> { sound, music, volume, rate, pan, emitter }
    this.nextChannel = 1;
    this.song = null;
    this.listener = null;          // { entity, rolloff, doppler, distance, last: Mat4, velocity }
    this.effectsVolume = 1;
    this.musicVolume = 1;
  }

  // -------------------------------------------------------------- sounds

  // Starts loading a sound file; returns the Sound at once. Like textures,
  // files started in the main body are in by the first Update.
  load(file, url)
  {
    const sound = new Sound();
    sound.file = file;
    this.world.addHandle(sound);
    const failed = (text) =>
    {
      sound.failed = true;
      this.engine.warn(text);
    };
    if (!this.engine.loadFile)
    {
      failed(`LoadSound: could not load "${file}"`);
      return sound;
    }
    this.engine.track(this.engine.loadFile(url).then(
      (bytes) => this.backend.decode(sound, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).then((info) =>
      {
        sound.seconds = info.seconds;
        sound.sampleRate = info.sampleRate;
        sound.loaded = true;
      }, () => failed(`LoadSound: "${file}" is not a sound file that can be played here (WAV, OGG or MP3)`)),
      () => failed(`LoadSound: could not load "${file}"`)));
    return sound;
  }

  // A sound made from a recipe (synth.js). The same recipe gives the same
  // Sound: making an effect for every shot does not pile up sounds.
  fromRecipe(recipe)
  {
    const key = JSON.stringify(recipe);
    const known = this.recipes.get(key);
    if (known && known.handle) return known;
    const samples = synthesize(recipe);
    const sound = new Sound();
    sound.recipeKey = key;
    sound.seconds = samples.length / SAMPLE_RATE;
    sound.loaded = true;
    this.world.addHandle(sound);
    this.backend.addSamples(sound, samples);
    this.recipes.set(key, sound);
    return sound;
  }

  effect(kind, seed)
  {
    return this.fromRecipe(sfxRecipe(kind, seed));
  }

  free(sound)
  {
    for (const [id, c] of this.channels)
    {
      if (c.sound === sound)
      {
        this.backend.stop(id);
        this.channels.delete(id);
      }
    }
    if (sound.recipeKey) this.recipes.delete(sound.recipeKey);
    this.backend.freeSound(sound);
    this.world.removeHandle(sound);
    sound.handle = 0;
  }

  // ------------------------------------------------------------ channels

  newChannel(record)
  {
    const id = this.nextChannel++;
    this.channels.set(id, record);
    if (this.channels.size > KEEP_CHANNELS)
    {
      for (const [old] of this.channels)
      {
        if (!this.backend.playing(old)) this.channels.delete(old);
      }
    }
    return id;
  }

  // Plays a sound the way it is set up; `emitter` (an entity) places it in
  // the 3D world. Returns the channel.
  play(sound, emitter = null)
  {
    const record = {
      sound, music: false, volume: sound.volume, rate: sound.rateFor(sound.pitch), pan: sound.pan,
      emitter, last: null, velocity: [0, 0, 0]
    };
    const id = this.newChannel(record);
    // A file still loading (or that failed) is not heard, but the program
    // gets its channel all the same.
    if (!sound.loaded) return id;
    let { volume, rate, pan } = record;
    if (emitter)
    {
      record.last = new Mat4().copy(emitter.worldMatrix);
      const heard = this.heard(record);
      volume *= heard.gain;
      rate *= heard.rate;
      pan = heard.pan;
    }
    this.backend.play(id, sound, { loop: sound.loop, volume, rate, pan, music: false });
    return id;
  }

  // Plays a music file on a channel of its own, looping unless `loop` is
  // false. The file is read now and heard once it has arrived.
  playMusic(file, url, loop)
  {
    const record = { sound: null, music: true, volume: 1, rate: 1, pan: 0, emitter: null, stopped: false };
    const id = this.newChannel(record);
    if (!this.engine.loadFile)
    {
      this.engine.warn(`PlayMusic: could not load "${file}"`);
      return id;
    }
    this.engine.track(this.engine.loadFile(url).then(
      (bytes) =>
      {
        if (record.stopped) return;
        return this.backend.playMusic(id, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { loop, volume: record.volume })
          .catch(() => this.engine.warn(`PlayMusic: "${file}" is not a music file that can be played here (WAV, OGG or MP3)`));
      },
      () => this.engine.warn(`PlayMusic: could not load "${file}"`)));
    return id;
  }

  // The channel record, or null for a channel that is over and forgotten.
  // `id` must be one this program was given.
  channel(id)
  {
    return this.channels.get(id) || null;
  }

  issued(id)
  {
    return id >= 1 && id < this.nextChannel;
  }

  setVolume(id, volume)
  {
    const c = this.channel(id);
    if (!c) return;
    c.volume = volume;
    this.backend.set(id, { volume: c.emitter ? volume * this.heard(c).gain : volume });
  }

  setPitch(id, hz)
  {
    const c = this.channel(id);
    if (!c) return;
    c.rate = c.sound.rateFor(hz);
    this.backend.set(id, { rate: c.emitter ? c.rate * this.heard(c).rate : c.rate });
  }

  setPan(id, pan)
  {
    const c = this.channel(id);
    if (!c || c.emitter) return;    // a 3D sound's pan comes from where it is
    c.pan = pan;
    this.backend.set(id, { pan });
  }

  stop(id)
  {
    const c = this.channel(id);
    if (!c) return;
    c.stopped = true;
    this.backend.stop(id);
    this.channels.delete(id);
  }

  pause(id)
  {
    if (this.channel(id)) this.backend.pause(id);
  }

  resume(id)
  {
    if (this.channel(id)) this.backend.resume(id);
  }

  playing(id)
  {
    return !!this.channel(id) && this.backend.playing(id);
  }

  setVolumes(effects, music)
  {
    this.effectsVolume = effects;
    this.musicVolume = music;
    this.backend.setVolumes(effects, music);
  }

  // --------------------------------------------------------------- songs

  newSong(bpm)
  {
    const song = new Song(bpm);
    this.world.addHandle(song);
    return song;
  }

  // Adds a track; returns the song's number of tracks, or an Error naming
  // the first token that is not a note.
  addTrack(song, instrument, notes, volume)
  {
    const parsed = parseNotes(notes, instrument === INST_DRUMS);
    if (parsed.bad !== null) return new Error(`"${parsed.bad}" is not ${instrument === INST_DRUMS ? 'a drum (k, s, h)' : 'a note (such as C4, F#3, Bb2)'}, a hold (-) or a rest (.)`);
    if (parsed.steps === 0) return new Error('the line has no notes');
    song.tracks.push({ inst: instrument, events: parsed.events, steps: parsed.steps, volume });
    return song.tracks.length;
  }

  playSong(song, loop)
  {
    this.song = song;
    this.backend.playSong({ bpm: song.bpm, length: song.length, tracks: song.tracks }, loop);
  }

  stopSong()
  {
    this.song = null;
    this.backend.stopSong();
  }

  songPlaying()
  {
    if (this.song && !this.backend.songPlaying()) this.song = null;
    return this.song;
  }

  // ------------------------------------------------------------------ 3D

  setListener(entity, rolloff, doppler, distance)
  {
    this.listener = { entity, rolloff, doppler, distance, last: new Mat4().copy(entity.worldMatrix), velocity: [0, 0, 0] };
  }

  // How the channel's emitter is heard now: { gain, pan, rate }.
  heard(c)
  {
    const l = this.listener;
    if (!l) return { gain: 1, pan: 0, rate: 1 };
    const where = c.emitter.alive ? c.emitter.worldMatrix : c.last;
    return hear(l.entity.alive ? l.entity.worldMatrix : l.last, where, l.velocity, c.velocity, l);
  }

  // After each step: sounds placed in the world follow their entities
  // (and the listener), and velocities for the Doppler effect are updated.
  step()
  {
    const dt = STEP_MS / 1000;
    const velocity = (out, before, now) =>
    {
      out[0] = (now.e[12] - before.e[12]) / dt;
      out[1] = (now.e[13] - before.e[13]) / dt;
      out[2] = (now.e[14] - before.e[14]) / dt;
    };
    const l = this.listener;
    if (l)
    {
      if (l.entity.alive)
      {
        velocity(l.velocity, l.last, l.entity.worldMatrix);
        l.last.copy(l.entity.worldMatrix);
      }
      else l.velocity.fill(0);
    }
    for (const [id, c] of this.channels)
    {
      if (!c.emitter || !c.last) continue;
      if (!this.backend.playing(id))
      {
        this.channels.delete(id);
        continue;
      }
      if (c.emitter.alive)
      {
        velocity(c.velocity, c.last, c.emitter.worldMatrix);
        c.last.copy(c.emitter.worldMatrix);
      }
      else c.velocity.fill(0);
      const heard = this.heard(c);
      this.backend.set(id, { volume: c.volume * heard.gain, rate: c.rate * heard.rate, pan: heard.pan });
    }
  }

  // The program stopped: everything goes quiet. Sounds stay (they belong
  // to the world, which stays until the next run).
  stopAll()
  {
    for (const c of this.channels.values()) c.stopped = true;
    this.channels.clear();
    this.song = null;
    this.backend.reset();
  }
}
