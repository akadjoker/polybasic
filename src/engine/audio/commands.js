// The sound commands: sounds from files or made from recipes, channels,
// music, songs and sound in the 3D world. Signatures use the format of
// src/engine/commands.js; the names and meanings follow Blitz3D where it
// has the command (volumes 0..1, pans -1..1, pitches in Hz).

import { handleHelpers, describe } from '../handles.js';
import { runtimeError } from '../../runtime/errors.js';
import { Sound, Song } from './audio.js';
import {
  WAVE_SQUARE, WAVE_TRIANGLE, WAVE_SAW, WAVE_SINE, WAVE_NOISE,
  SFX_COIN, SFX_LASER, SFX_EXPLOSION, SFX_POWERUP, SFX_HIT, SFX_JUMP, SFX_BLIP, SFX_RANDOM,
  INST_SQUARE, INST_TRIANGLE, INST_SAW, INST_SINE, INST_DRUMS, INST_PLUCK, INST_PAD, INST_BASS
} from './synth.js';

export const AUDIO_COMMANDS = [
  // Sounds
  'LoadSound%(file$)',
  'Load3DSound%(file$)',
  'SoundLoaded%(sound)',
  'FreeSound(sound)',
  'LoopSound(sound)',
  'SoundVolume(sound, volume#)',
  'SoundPitch(sound, hz)',
  'SoundPan(sound, pan#)',
  'PlaySound%(sound)',
  'CreateSfx%(kind, seed = 0)',
  'CreateTone%(wave, freq#, freqEnd#, ms, volume# = 0.5)',

  // Channels
  'StopChannel(channel)',
  'PauseChannel(channel)',
  'ResumeChannel(channel)',
  'ChannelVolume(channel, volume#)',
  'ChannelPitch(channel, hz)',
  'ChannelPan(channel, pan#)',
  'ChannelPlaying%(channel)',

  // Music
  'PlayMusic%(file$, loop = 1)',
  'EffectsVolume(volume#)',
  'MusicVolume(volume#)',

  // Songs
  'CreateSong%(bpm)',
  'SongTrack%(song, instrument, notes$, volume# = 0.6)',
  'PlaySong(song, loop = 1)',
  'StopSong()',
  'SongPlaying%()',
  'SongTime#()',
  'SongStep%()',

  // Sound in the 3D world
  'CreateListener%(parent, rolloff# = 1, doppler# = 1, distance# = 0.5)',
  'EmitSound%(sound, entity)'
];

export const AUDIO_CONSTANTS = {
  WAVE_SQUARE,
  WAVE_TRIANGLE,
  WAVE_SAW,
  WAVE_SINE,
  WAVE_NOISE,
  SFX_COIN,
  SFX_LASER,
  SFX_EXPLOSION,
  SFX_POWERUP,
  SFX_HIT,
  SFX_JUMP,
  SFX_BLIP,
  SFX_RANDOM,
  INST_SQUARE,
  INST_TRIANGLE,
  INST_SAW,
  INST_SINE,
  INST_DRUMS,
  INST_PLUCK,
  INST_PAD,
  INST_BASS
};

const unitRange = (v) => Math.max(0, Math.min(1, v));
const panRange = (v) => Math.max(-1, Math.min(1, v));

export function createAudioCommands(engine)
{
  const world = engine.world;
  const audio = engine.audio;
  const { entity, parentOf } = handleHelpers(world);

  const sound = (handle) =>
  {
    const s = world.handles.get(handle);
    if (s instanceof Sound) return s;
    if (handle === 0) throw runtimeError('Sound handle is 0 (no sound)');
    if (s) throw runtimeError(`Handle ${handle} is ${describe(s)}, not a sound`);
    throw runtimeError(`Sound ${handle} does not exist (it was freed, or never created)`);
  };
  const song = (handle) =>
  {
    const s = world.handles.get(handle);
    if (s instanceof Song) return s;
    if (handle === 0) throw runtimeError('Song handle is 0 (no song)');
    if (s) throw runtimeError(`Handle ${handle} is ${describe(s)}, not a song`);
    throw runtimeError(`Song ${handle} does not exist (it was never created)`);
  };
  // A channel this program was given; null once it is over and forgotten.
  const channel = (id) =>
  {
    if (!audio.issued(id)) throw runtimeError(id === 0 ? 'Channel is 0 (no channel)' : `Channel ${id} does not exist (PlaySound, EmitSound and PlayMusic give channels)`);
    return audio.channel(id);
  };
  const hz = (value, what) =>
  {
    if (value < 0) throw runtimeError(`${what} needs a frequency of 0 or more Hz, not ${value}`);
    return value;
  };

  return {
    // ------------------------------------------------------------ sounds
    loadsound: (file) => engine.loadSound(file).handle,
    load3dsound: (file) => engine.loadSound(file).handle,
    soundloaded: (handle) => (sound(handle).loaded ? 1 : 0),
    freesound(handle)
    {
      audio.free(sound(handle));
    },
    loopsound(handle)
    {
      sound(handle).loop = true;
    },
    soundvolume(handle, volume)
    {
      sound(handle).volume = Math.max(0, volume);
    },
    soundpitch(handle, value)
    {
      sound(handle).pitch = hz(value, 'SoundPitch');
    },
    soundpan(handle, pan)
    {
      sound(handle).pan = panRange(pan);
    },
    playsound: (handle) => audio.play(sound(handle)),
    createsfx(kind, seed)
    {
      if (kind < SFX_COIN || kind > SFX_RANDOM) throw runtimeError(`CreateSfx needs one of the SFX_ kinds (${SFX_COIN} to ${SFX_RANDOM}), not ${kind}`);
      return audio.effect(kind, seed).handle;
    },
    createtone(wave, freq, freqEnd, ms, volume)
    {
      if (wave < WAVE_SQUARE || wave > WAVE_NOISE) throw runtimeError(`CreateTone needs one of the WAVE_ shapes (${WAVE_SQUARE} to ${WAVE_NOISE}), not ${wave}`);
      if (!(freq > 0 && freqEnd > 0)) throw runtimeError(`CreateTone needs frequencies above 0 Hz, not ${freq} and ${freqEnd}`);
      if (!(ms > 0)) throw runtimeError(`CreateTone needs a length above 0 ms, not ${ms}`);
      return audio.fromRecipe({ wave, freq, freqEnd, ms, volume: unitRange(volume) }).handle;
    },

    // ---------------------------------------------------------- channels
    stopchannel(id)
    {
      if (channel(id)) audio.stop(id);
    },
    pausechannel(id)
    {
      if (channel(id)) audio.pause(id);
    },
    resumechannel(id)
    {
      if (channel(id)) audio.resume(id);
    },
    channelvolume(id, volume)
    {
      if (channel(id)) audio.setVolume(id, Math.max(0, volume));
    },
    channelpitch(id, value)
    {
      const c = channel(id);
      if (c && c.music) throw runtimeError(`Channel ${id} plays music: ChannelPitch works on sound channels`);
      if (c) audio.setPitch(id, hz(value, 'ChannelPitch'));
    },
    channelpan(id, pan)
    {
      if (channel(id)) audio.setPan(id, panRange(pan));
    },
    channelplaying: (id) => (channel(id) && audio.playing(id) ? 1 : 0),

    // ------------------------------------------------------------- music
    playmusic: (file, loop) => engine.playMusic(file, loop !== 0),
    effectsvolume(volume)
    {
      audio.setVolumes(unitRange(volume), audio.musicVolume);
    },
    musicvolume(volume)
    {
      audio.setVolumes(audio.effectsVolume, unitRange(volume));
    },

    // ------------------------------------------------------------- songs
    createsong(bpm)
    {
      if (!(bpm >= 20 && bpm <= 400)) throw runtimeError(`CreateSong needs a tempo of 20 to 400 beats a minute, not ${bpm}`);
      return audio.newSong(bpm).handle;
    },
    songtrack(handle, instrument, notes, volume)
    {
      const s = song(handle);
      if (instrument < INST_SQUARE || instrument > INST_BASS) throw runtimeError(`SongTrack needs one of the INST_ instruments (${INST_SQUARE} to ${INST_BASS}), not ${instrument}`);
      const count = audio.addTrack(s, instrument, notes, unitRange(volume));
      if (count instanceof Error) throw runtimeError(`SongTrack: ${count.message}`);
      return count;
    },
    playsong(handle, loop)
    {
      const s = song(handle);
      if (s.tracks.length === 0) throw runtimeError(`Song ${handle} has no tracks yet (SongTrack adds them)`);
      audio.playSong(s, loop !== 0);
    },
    stopsong()
    {
      audio.stopSong();
    },
    songplaying()
    {
      const s = audio.songPlaying();
      return s ? s.handle : 0;
    },
    songtime: () => audio.backend.songTime(),
    songstep: () => audio.backend.songStep(),

    // ---------------------------------------------------------------- 3D
    createlistener(parent, rolloff, doppler, distance)
    {
      if (!(distance > 0)) throw runtimeError(`CreateListener needs a distance above 0 (metres in one unit), not ${distance}`);
      const listener = world.createEntity('pivot', parentOf(parent));
      audio.setListener(listener, Math.max(0, rolloff), Math.max(0, doppler), distance);
      return listener.id;
    },
    emitsound(handle, target)
    {
      const s = sound(handle);
      const e = entity(target);
      if (!audio.listener || !audio.listener.entity.alive) throw runtimeError('EmitSound needs a listener to hear it: CreateListener first (usually on the camera)');
      return audio.play(s, e);
    }
  };
}
