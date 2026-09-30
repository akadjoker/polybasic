// The browser's audio backend, on Web Audio.
//
//   sounds    decoded to AudioBuffers (files) or copied from samples made
//             by synth.js; each channel is a buffer source -> gain ->
//             stereo panner -> the effects or the music volume
//   music     files played by PlayMusic stream through an <audio> element
//             into the music volume
//   songs     a step sequencer scheduled a little ahead on the audio clock
//
// Browsers only let a page make sound once the player has clicked, touched
// or pressed a key on it (unlock() is called then). Until that, sounds
// played are skipped (their channel is over at once) while music and songs
// wait and start by themselves. A hidden page is silent: the sound pauses
// and goes on when the page is shown again.
//
// One AudioContext serves the whole page (browsers limit how many a page
// may have); each backend has its own volumes under it.

import { AudioBackend } from '../backend.js';
import { readWavInfo } from '../wav.js';
import { synthesize, DRUM_RECIPES, SAMPLE_RATE, STEPS_PER_BEAT,
  INST_DRUMS, INST_SQUARE, INST_TRIANGLE, INST_SAW, INST_SINE, INST_PLUCK, INST_PAD, INST_BASS } from '../synth.js';

const LOOKAHEAD = 0.12;           // seconds of a song scheduled ahead
const SCHEDULE_EVERY_MS = 25;
const SMOOTH = 0.015;             // seconds to glide to a new volume, rate or pan

let sharedContext = null;
let decoder = null;

function contextClass()
{
  return typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext || null) : null;
}

const clampRate = (r) => Math.max(0.05, Math.min(16, r));
const clampPan = (p) => Math.max(-1, Math.min(1, p));

export class WebAudioBackend extends AudioBackend
{
  constructor()
  {
    super();
    this.available = !!contextClass();
    this.buffers = new WeakMap();    // Sound -> { buffer, samples }
    this.channels = new Map();       // id -> channel record
    this.effectsVolume = 1;
    this.musicVolume = 1;
    this.output = null;              // everything goes through here
    this.effects = null;
    this.music = null;
    this.song = null;
    this.endingSong = null;
    this.timer = 0;
    this.drumBuffers = null;
    this.pausedByHide = false;
    this.stats = { played: 0, skipped: 0, notes: 0 };
    this.onVisibility = null;
    if (this.available && typeof document !== 'undefined')
    {
      this.onVisibility = () => this.followVisibility(document.hidden);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  // The page's AudioContext, with this backend's volumes under it.
  context()
  {
    if (!this.available) return null;
    if (!sharedContext) sharedContext = new (contextClass())();
    if (!this.output)
    {
      this.output = sharedContext.createGain();
      this.output.connect(sharedContext.destination);
      this.effects = sharedContext.createGain();
      this.effects.gain.value = this.effectsVolume;
      this.effects.connect(this.output);
      this.music = sharedContext.createGain();
      this.music.gain.value = this.musicVolume;
      this.music.connect(this.output);
    }
    return sharedContext;
  }

  get running()
  {
    return !!sharedContext && sharedContext.state === 'running';
  }

  // The player clicked or pressed a key: sound may start. Browsers that
  // remember an earlier click let resume() work without a new one.
  unlock()
  {
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === 'running') this.startWaiting();
    else ctx.resume().then(() => this.startWaiting()).catch(() => {});
  }

  followVisibility(hidden)
  {
    if (!sharedContext) return;
    if (hidden && sharedContext.state === 'running')
    {
      this.pausedByHide = true;
      sharedContext.suspend().catch(() => {});
      for (const c of this.channels.values()) if (c.element && !c.paused) c.element.pause();
    }
    else if (!hidden && this.pausedByHide)
    {
      this.pausedByHide = false;
      sharedContext.resume().catch(() => {});
      for (const c of this.channels.values()) if (c.element && !c.paused && c.started) c.element.play().catch(() => {});
    }
  }

  // Music and a song that were waiting for the player's first click.
  startWaiting()
  {
    for (const c of this.channels.values())
    {
      if (c.element && !c.started && !c.paused) this.startElement(c);
    }
    this.startPendingSong();
  }

  // -------------------------------------------------------------- sounds

  addSamples(sound, samples)
  {
    this.buffers.set(sound, { buffer: null, samples });
  }

  decode(sound, bytes)
  {
    if (!this.available) return Promise.reject(new Error('this browser has no Web Audio'));
    if (!decoder)
    {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      decoder = new Offline(1, 1, SAMPLE_RATE);
    }
    // decodeAudioData takes the bytes away: it gets a copy, so the
    // project's file stays whole. It also resamples to SAMPLE_RATE, so the
    // rate the sound was recorded at comes from the file where it can (a
    // WAV header), as in the headless backend.
    const wav = readWavInfo(bytes);
    return decoder.decodeAudioData(bytes.slice().buffer).then((buffer) =>
    {
      this.buffers.set(sound, { buffer, samples: null });
      return { seconds: buffer.duration, sampleRate: wav ? wav.sampleRate : buffer.sampleRate };
    });
  }

  freeSound(sound)
  {
    this.buffers.delete(sound);
  }

  bufferOf(sound)
  {
    const entry = this.buffers.get(sound);
    if (!entry) return null;
    if (!entry.buffer && entry.samples)
    {
      entry.buffer = new AudioBuffer({ length: entry.samples.length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
      entry.buffer.copyToChannel(entry.samples, 0);
    }
    return entry.buffer;
  }

  // The chain every channel ends in: gain -> panner -> a volume.
  chain(ctx, volume, pan, music)
  {
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, volume);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampPan(pan);
    gain.connect(panner).connect(music ? this.music : this.effects);
    return { gain, panner };
  }

  play(id, sound, options)
  {
    const ctx = this.context();
    const buffer = this.bufferOf(sound);
    if (!ctx || ctx.state !== 'running' || !buffer)
    {
      // Not allowed to sound yet: skipped, the channel is over at once.
      this.stats.skipped++;
      if (ctx && ctx.state !== 'running') ctx.resume().then(() => this.startWaiting()).catch(() => {});
      return;
    }
    const c = {
      buffer, loop: !!options.loop, rate: clampRate(options.rate || 1),
      offset: 0, since: 0, source: null, paused: false, ended: false,
      ...this.chain(ctx, options.volume ?? 1, options.pan || 0, !!options.music)
    };
    this.channels.set(id, c);
    this.startSource(ctx, c);
    this.stats.played++;
  }

  // (Re)starts a channel's buffer from its offset.
  startSource(ctx, c)
  {
    const source = ctx.createBufferSource();
    source.buffer = c.buffer;
    source.loop = c.loop;
    source.playbackRate.value = c.rate;
    source.connect(c.gain);
    source.onended = () =>
    {
      if (c.source === source) c.ended = true;
    };
    source.start(0, c.offset);
    c.source = source;
    c.since = ctx.currentTime;
  }

  // Seconds into the sound a buffer channel has got to.
  position(c)
  {
    const at = c.offset + (sharedContext.currentTime - c.since) * c.rate;
    return c.loop ? at % c.buffer.duration : Math.min(at, c.buffer.duration);
  }

  playMusic(id, bytes, options)
  {
    const ctx = this.context();
    if (!ctx) return Promise.reject(new Error('this browser has no Web Audio'));
    const url = URL.createObjectURL(new Blob([bytes]));
    const element = document.createElement('audio');
    element.src = url;
    element.loop = !!options.loop;
    element.preload = 'auto';
    const c = {
      element, url, started: false, paused: false, ended: false,
      ...this.chain(ctx, options.volume ?? 1, 0, true)
    };
    ctx.createMediaElementSource(element).connect(c.gain);
    element.onended = () =>
    {
      c.ended = true;
    };
    this.channels.set(id, c);
    const ready = new Promise((resolve, reject) =>
    {
      element.onloadedmetadata = () => resolve({ seconds: element.duration });
      element.onerror = () => reject(new Error('the browser cannot play this file'));
    });
    if (ctx.state === 'running') this.startElement(c);
    else ctx.resume().then(() => this.startWaiting()).catch(() => {});
    return ready;
  }

  startElement(c)
  {
    c.started = true;
    c.element.play().catch(() =>
    {
      // Not allowed yet after all: wait for the next click.
      c.started = false;
    });
  }

  set(id, values)
  {
    const c = this.channels.get(id);
    if (!c || c.ended) return;
    const now = sharedContext.currentTime;
    if (values.volume !== undefined) c.gain.gain.setTargetAtTime(Math.max(0, values.volume), now, SMOOTH);
    if (values.pan !== undefined) c.panner.pan.setTargetAtTime(clampPan(values.pan), now, SMOOTH);
    if (values.rate !== undefined && c.buffer)
    {
      const rate = clampRate(values.rate);
      if (!c.paused)
      {
        c.offset = this.position(c);
        c.since = now;
        c.source.playbackRate.setValueAtTime(rate, now);
      }
      c.rate = rate;
    }
  }

  stop(id)
  {
    const c = this.channels.get(id);
    if (!c) return;
    this.channels.delete(id);
    this.silence(c);
  }

  silence(c)
  {
    c.ended = true;
    if (c.source)
    {
      const source = c.source;
      c.source = null;
      try
      {
        source.stop();
      }
      catch
      {
        // it had not started, or had stopped already
      }
    }
    if (c.element)
    {
      c.element.pause();
      c.element.removeAttribute('src');
      c.element.load();
      URL.revokeObjectURL(c.url);
    }
    c.panner.disconnect();
  }

  pause(id)
  {
    const c = this.channels.get(id);
    if (!c || c.ended || c.paused) return;
    c.paused = true;
    if (c.element)
    {
      c.element.pause();
      return;
    }
    c.offset = this.position(c);
    const source = c.source;
    c.source = null;
    source.stop();
  }

  resume(id)
  {
    const c = this.channels.get(id);
    if (!c || c.ended || !c.paused) return;
    c.paused = false;
    if (c.element)
    {
      if (this.running) this.startElement(c);
      return;
    }
    this.startSource(sharedContext, c);
  }

  playing(id)
  {
    const c = this.channels.get(id);
    if (!c) return false;
    if (!c.ended) return true;
    this.channels.delete(id);
    return false;
  }

  setVolumes(effects, music)
  {
    this.effectsVolume = effects;
    this.musicVolume = music;
    if (this.effects)
    {
      this.effects.gain.value = effects;
      this.music.gain.value = music;
    }
  }

  // --------------------------------------------------------------- songs

  playSong(song, loop)
  {
    this.stopSong();
    this.context();
    this.song = { def: song, loop: !!loop, step: 0, nextTime: 0, startTime: 0, nodes: new Set(), started: false };
    this.startPendingSong();
  }

  startPendingSong()
  {
    const s = this.song;
    if (!s || s.started || !this.running) return;
    s.started = true;
    s.nextTime = sharedContext.currentTime + 0.05;
    s.startTime = s.nextTime;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), SCHEDULE_EVERY_MS);
  }

  stopSong()
  {
    this.endingSong = null;
    if (this.timer)
    {
      clearInterval(this.timer);
      this.timer = 0;
    }
    if (!this.song) return;
    for (const node of this.song.nodes)
    {
      try
      {
        node.stop();
      }
      catch
      {
        // already stopped
      }
    }
    this.song = null;
  }

  // The song being heard: the playing one, or one that does not loop whose
  // last steps are still sounding.
  heardSong(now)
  {
    if (this.song) return this.song.started ? this.song : null;
    const s = this.endingSong;
    return s && now < s.nextTime ? s : null;
  }

  songPlaying()
  {
    if (this.song) return true;
    return !!sharedContext && !!this.heardSong(sharedContext.currentTime);
  }

  // Time as heard: the audio clock less the time sound takes to reach the
  // speakers.
  heardNow()
  {
    const latency = Number(sharedContext.outputLatency) || Number(sharedContext.baseLatency) || 0;
    return sharedContext.currentTime - latency;
  }

  songTime()
  {
    if (!sharedContext) return 0;
    const now = this.heardNow();
    const s = this.heardSong(now);
    return s ? Math.max(0, now - s.startTime) : 0;
  }

  songStep()
  {
    if (!sharedContext) return -1;
    const s = this.heardSong(this.heardNow());
    if (!s) return -1;
    const stepTime = 60 / s.def.bpm / STEPS_PER_BEAT;
    return Math.floor(this.songTime() / stepTime + 1e-9) % s.def.length;
  }

  // Schedules every step that starts within the lookahead.
  schedule()
  {
    const s = this.song;
    if (!s || !sharedContext) return;
    const stepTime = 60 / s.def.bpm / STEPS_PER_BEAT;
    while (s.nextTime < sharedContext.currentTime + LOOKAHEAD)
    {
      if (s.step >= s.def.length)
      {
        if (!s.loop)
        {
          clearInterval(this.timer);
          this.timer = 0;
          const nodes = s.nodes;
          setTimeout(() => nodes.clear(), 2000);
          this.endingSong = s;
          this.song = null;
          return;
        }
        s.step = 0;
      }
      for (const track of s.def.tracks)
      {
        const local = s.step % track.steps;
        for (const event of track.events)
        {
          if (event.step === local) this.playNote(s, track, event, s.nextTime, stepTime);
        }
      }
      s.step++;
      s.nextTime += stepTime;
    }
  }

  playNote(s, track, event, when, stepTime)
  {
    const ctx = sharedContext;
    const length = event.length * stepTime;
    const remember = (node) =>
    {
      s.nodes.add(node);
      node.onended = () => s.nodes.delete(node);
    };
    this.stats.notes++;
    if (track.inst === INST_DRUMS)
    {
      const drums = this.drums();
      for (const hit of event.drums)
      {
        const source = ctx.createBufferSource();
        source.buffer = drums[hit];
        const gain = ctx.createGain();
        gain.gain.value = track.volume;
        source.connect(gain).connect(this.music);
        source.start(when);
        remember(source);
      }
      return;
    }
    const types = {
      [INST_SQUARE]: 'square', [INST_TRIANGLE]: 'triangle', [INST_SAW]: 'sawtooth', [INST_SINE]: 'sine',
      [INST_PLUCK]: 'square', [INST_PAD]: 'sawtooth', [INST_BASS]: 'triangle'
    };
    const osc = ctx.createOscillator();
    osc.type = types[track.inst] || 'square';
    osc.frequency.value = track.inst === INST_BASS ? event.freq / 2 : event.freq;
    const gain = ctx.createGain();
    const peak = track.volume * (osc.type === 'square' || osc.type === 'sawtooth' ? 0.18 : 0.35);
    const g = gain.gain;
    g.setValueAtTime(0, when);
    let end;
    if (track.inst === INST_PLUCK)
    {
      end = when + Math.min(length, 0.35);
      g.linearRampToValueAtTime(peak, when + 0.005);
      g.exponentialRampToValueAtTime(0.0001, end);
    }
    else if (track.inst === INST_PAD)
    {
      end = when + length;
      g.linearRampToValueAtTime(peak * 0.7, when + Math.min(0.3, length * 0.5));
      g.setValueAtTime(peak * 0.7, when + length * 0.8);
      g.linearRampToValueAtTime(0, end);
    }
    else
    {
      end = when + length;
      g.linearRampToValueAtTime(peak, when + 0.01);
      g.setValueAtTime(peak, when + Math.max(0.01, length - 0.03));
      g.linearRampToValueAtTime(0, end);
    }
    let out = gain;
    if (track.inst === INST_PAD)
    {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      gain.connect(filter);
      out = filter;
    }
    osc.connect(gain);
    out.connect(this.music);
    osc.start(when);
    osc.stop(end + 0.02);
    remember(osc);
  }

  drums()
  {
    if (!this.drumBuffers)
    {
      this.drumBuffers = {};
      for (const [hit, recipe] of Object.entries(DRUM_RECIPES))
      {
        const samples = synthesize(recipe);
        const buffer = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
        buffer.copyToChannel(samples, 0);
        this.drumBuffers[hit] = buffer;
      }
    }
    return this.drumBuffers;
  }

  // ------------------------------------------------------------ lifetime

  reset()
  {
    this.stopSong();
    for (const c of this.channels.values()) this.silence(c);
    this.channels.clear();
  }

  dispose()
  {
    this.reset();
    if (this.onVisibility)
    {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.onVisibility = null;
    }
    if (this.output)
    {
      this.output.disconnect();
      this.output = null;
    }
  }
}
