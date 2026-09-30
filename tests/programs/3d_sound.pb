; Sound on the headless engine: nothing is heard, but channels last as
; long as their sounds (on the clock of the updates, 60 a second) and songs
; keep their tempo.
Global beep, ch, fast, held, looped, song, missing
beep = LoadSound("assets/beep.wav")          ; 0.25 s, recorded at 8000 Hz
missing = LoadSound("assets/none.wav")
Print "loaded in the main body: " + SoundLoaded(beep)

coin = CreateSfx(SFX_COIN, 1)
Print "the same effect twice is one sound: " + (CreateSfx(SFX_COIN, 1) = coin)
Print "another seed is another sound: " + (CreateSfx(SFX_COIN, 2) <> coin)
tone = CreateTone(WAVE_SINE, 440, 880, 100)
Print "a tone: " + SoundLoaded(tone)

song = CreateSong(120)                        ; a step (a sixteenth) is 0.125 s
Print "tracks " + SongTrack(song, INST_SQUARE, "C4 - E4 . | G4 - . .")
Print "tracks " + SongTrack(song, INST_DRUMS, "k . h . s . h .", 0.8)
Print "constants " + SFX_COIN + " " + SFX_RANDOM + " " + WAVE_NOISE + " " + INST_DRUMS + " " + INST_BASS

Function Update()
  f = FrameCount()
  If f = 1
    Print "loaded by the first update: " + SoundLoaded(beep) + ", missing: " + SoundLoaded(missing)
    ch = PlaySound(beep)
    PlaySong song
    Print "song " + (SongPlaying() = song) + ", step " + SongStep()
  EndIf
  If f = 15 Then Print "frame 15: playing " + ChannelPlaying(ch)
  If f = 16
    Print "frame 16: playing " + ChannelPlaying(ch) + ", song step " + SongStep()
    ; Twice the recorded rate: over in half the time.
    SoundPitch beep, 16000
    fast = PlaySound(beep)
    held = PlaySound(beep)
    PauseChannel held
  EndIf
  If f = 23 Then Print "frame 23: fast " + ChannelPlaying(fast)
  If f = 24 Then Print "frame 24: fast " + ChannelPlaying(fast) + ", held " + ChannelPlaying(held)
  If f = 60
    ResumeChannel held
    LoopSound beep
    looped = PlaySound(beep)
    Print "song time " + SongTime() + ", step " + SongStep()
  EndIf
  If f = 67 Then Print "frame 67: held " + ChannelPlaying(held)
  If f = 68 Then Print "frame 68: held " + ChannelPlaying(held)
  If f = 200
    Print "a looping sound plays on: " + ChannelPlaying(looped)
    StopChannel looped
    Print "stopped: " + ChannelPlaying(looped)
    StopChannel looped                          ; stopping it again is fine
    StopSong
    Print "song after StopSong: " + SongPlaying() + ", step " + SongStep()
    FreeSound beep
    Print "freed: " + ChannelPlaying(ch)
    End
  EndIf
End Function
