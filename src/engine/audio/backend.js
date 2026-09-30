// The audio backend interface. The engine keeps the sounds, channels,
// songs and the 3D listener (audio.js) and works out how a sound in the 3D
// world is heard (spatial.js); a backend only plays. Nothing else in the
// engine knows which backend is in use.
//
//   init(clock)                 clock() -> seconds of simulated time, for a
//                               backend with no clock of its own
//   addSamples(sound, samples)  a sound made here: mono Float32Array at
//                               SAMPLE_RATE (synth.js)
//   decode(sound, bytes)        a sound file (WAV, OGG, MP3) -> Promise of
//                               { seconds, sampleRate }; rejects when the
//                               file cannot be read
//   freeSound(sound)
//   play(id, sound, options)    channel `id` starts playing the sound
//                               options: { loop, volume, rate, pan, music }
//                               (music: under the music volume)
//   playMusic(id, bytes, options)  channel `id` plays a music file, streamed
//                               where the platform can -> Promise of
//                               { seconds }; options: { loop, volume }
//   set(id, { volume?, rate?, pan? })  change a playing channel
//   stop(id)  pause(id)  resume(id)
//   playing(id) -> bool         still sounding, or paused part way
//   setVolumes(effects, music)
//   playSong(song, loop)        song: { bpm, length, tracks: [{ inst,
//                               events, steps, volume }] } (synth.js notes)
//   stopSong()  songPlaying() -> bool
//   songTime() -> seconds of the song heard so far, through every loop
//   songStep() -> the step being heard (0 .. length - 1), -1 with no song
//   reset()                     the program stopped: everything goes quiet
//   dispose()
//
// Sounds are the engine's Sound objects: a backend may keep what it needs
// (a decoded buffer) on them. Channels are numbers the engine hands out.
// Volumes are 0..1, rates 1 = as recorded, pans -1 (left) .. 1 (right).

export class AudioBackend
{
  init(clock)
  {
  }

  addSamples(sound, samples)
  {
  }

  decode(sound, bytes)
  {
    return Promise.reject(new Error('this audio backend cannot read sound files'));
  }

  freeSound(sound)
  {
  }

  play(id, sound, options)
  {
  }

  playMusic(id, bytes, options)
  {
    return Promise.reject(new Error('this audio backend cannot play music files'));
  }

  set(id, values)
  {
  }

  stop(id)
  {
  }

  pause(id)
  {
  }

  resume(id)
  {
  }

  playing(id)
  {
    return false;
  }

  setVolumes(effects, music)
  {
  }

  playSong(song, loop)
  {
  }

  stopSong()
  {
  }

  songPlaying()
  {
    return false;
  }

  songTime()
  {
    return 0;
  }

  songStep()
  {
    return -1;
  }

  reset()
  {
  }

  dispose()
  {
  }
}
