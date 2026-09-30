; Sound Lab - every sound here is made by the engine: no sound files.
;
; 1 to 8 play the ready-made effects, Space plays a new variation of the
; last one. A bee flies around you: turn with Left/Right and hear it move
; from ear to ear, higher as it comes closer and lower as it goes away
; (the Doppler effect). M stops and starts the music; the cube ahead
; jumps on every beat.

Graphics3D 800, 600

Const TEMPO = 118

Global camera, bee, drum, song, musicOn, kind, seed
Dim names$(7)
Data "coin", "laser", "explosion", "powerup", "hit", "jump", "blip", "random"
For i = 0 To 7
  Read names(i)
Next

camera = CreateCamera()
CameraClsColor camera, 18, 22, 38
PositionEntity camera, 0, 1.2, 0
RotateEntity camera, 8, 0, 0
light = CreateLight()
RotateEntity light, 40, -30, 0
AmbientLight 70, 70, 90

; The ears ride on the camera. A Doppler of 4 is four times the real
; effect: easy to hear at the bee's small speed.
CreateListener camera, 1, 4

floor = CreatePlane(4)
ScaleEntity floor, 30, 1, 30
PositionEntity floor, 0, -1.5, 0
EntityTexture floor, CreateCheckerTexture(256, 16, 34, 42, 70, 64, 82, 130)

; The bee: a long loop around the listener, humming all the way.
bee = CreateSphere(12)
ScaleEntity bee, 0.3, 0.3, 0.3
EntityColor bee, 255, 210, 40
EntityFX bee, FX_FULLBRIGHT
buzz = CreateTone(WAVE_SAW, 190, 190, 2000, 0.3)
LoopSound buzz
EmitSound buzz, bee

; The drum: jumps on every beat of the song.
drum = CreateCube()
PositionEntity drum, 0, 0, 10
EntityColor drum, 90, 200, 255

song = CreateSong(TEMPO)
SongTrack song, INST_PAD, "C4 - - - - - - - | A3 - - - - - - - | F3 - - - - - - - | G3 - - - - - - -", 0.45
SongTrack song, INST_PLUCK, "E5 . G5 . C6 . G5 . | E5 . A5 . C6 . A5 . | F5 . A5 . C6 . A5 . | D5 . G5 . B5 . G5 .", 0.35
SongTrack song, INST_BASS, "C3 . C3 . C3 . C3 . | A2 . A2 . A2 . A2 . | F2 . F2 . F2 . F2 . | G2 . G2 . G2 . G2 .", 0.5
SongTrack song, INST_DRUMS, "k . h . s . h . | k . h k s . h h", 0.4
PlaySong song
musicOn = True
kind = SFX_COIN

Function Update()
  ; Effects: the keys 1 to 8 pick one, Space a variation of it.
  For k = 1 To 8
    If KeyHit(KEY_0 + k)
      kind = k - 1
      seed = 0
      PlaySound CreateSfx(kind, seed)
    EndIf
  Next
  If KeyHit(KEY_SPACE)
    seed = seed + 1
    PlaySound CreateSfx(kind, seed)
  EndIf

  ; Turn about the world's up axis (the camera looks a little down).
  If KeyDown(KEY_LEFT) Then TurnEntity camera, 0, 2, 0, True
  If KeyDown(KEY_RIGHT) Then TurnEntity camera, 0, -2, 0, True

  If KeyHit(KEY_M)
    If musicOn Then StopSong Else PlaySong song
    musicOn = Not musicOn
  EndIf

  ; The bee's loop: long and thin, so it rushes past close by and slows
  ; far away.
  t# = FrameCount() * DeltaTime()
  PositionEntity bee, Sin(t * 40) * 3, Sin(t * 90) * 0.6, Cos(t * 40) * 12 + 4

  ; The drum follows the song's own clock, not the frames: a beat is
  ; 60 / TEMPO seconds.
  beatLength# = 60.0 / TEMPO
  pulse# = 0
  If SongPlaying() Then pulse = 1 - (SongTime() Mod beatLength) / beatLength
  size# = 0.8 + 0.3 * pulse * pulse
  ScaleEntity drum, size, size, size
  TurnEntity drum, 0, 0.6, 0
End Function

Function Draw()
  Color 230, 236, 255
  FontSize 22
  Text 16, 14, "Sound Lab"
  FontSize 15
  Text 16, 46, "1-8  effect: " + names(kind) + ", variation " + seed + "  (Space: another)"
  Text 16, 68, "Left/Right  turn, and follow the bee by ear"
  If musicOn Then Text 16, 90, "M  music off" Else Text 16, 90, "M  music on"

  ; The song's steps, the one being heard lit up.
  heard = SongStep()
  For i = 0 To 15
    If heard >= 0 And heard Mod 16 = i Then Color 90, 200, 255 Else Color 14, 18, 32
    Rect 16 + i * 18, GraphicsHeight() - 34, 14, 14
  Next
End Function
