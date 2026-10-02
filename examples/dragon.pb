; Dragon - Mark Sibly's Blitz3D sample (samples/mak/dragon), ported.
;
; Left/Right turn round the dragon, Up/Down look from higher or lower,
; A/Z come closer or go back, Q/E roll (the original used [ and ]).
;
; Frames of dragon.md2:
;   0-40 idle, 40-46 run, 46-54 attack, 54-58 pain a, 58-62 pain b,
;   62-66 pain c, 66-72 jump, 72-84 flip
;
; MD2 Dragon model courtesy of Polycount, as the original sample says. The
; files come with the Blitz3D samples (zlib licence).

Graphics3D 800, 600

Global camera, cam_xr#, cam_yr#, cam_zr#, cam_z#

; The room: a cube seen from inside, half see-through, lit by nothing.
cube = CreateCube()
FitMesh cube, -250, 0, -250, 500, 500, 500
FlipMesh cube
tex = LoadTexture("assets/blitz3d/dragon/chorme-2.bmp")
ScaleTexture tex, 1.0 / 3, 1.0 / 3
EntityTexture cube, tex
EntityAlpha cube, 0.4
EntityFX cube, 1

; The floor is a mirror.
m = CreateMirror()

light = CreateLight()
TurnEntity light, 45, 45, 0

camera = CreateCamera()
cam_xr = 30
cam_yr = 0
cam_zr = 0
cam_z = -100

tex = LoadTexture("assets/blitz3d/dragon/dragon.bmp")
dragon = LoadMD2("assets/blitz3d/dragon/dragon.md2")
EntityTexture dragon, tex
PositionEntity dragon, 0, 25, 0
TurnEntity dragon, 0, 150, 0

AnimateMD2 dragon, ANIM_LOOP, 0.05, 0, 40

Function Update()
  If KeyDown(KEY_LEFT)
    cam_yr = cam_yr - 2
  ElseIf KeyDown(KEY_RIGHT)
    cam_yr = cam_yr + 2
  EndIf

  If KeyDown(KEY_UP)
    cam_xr = cam_xr + 2
    If cam_xr > 90 Then cam_xr = 90
  ElseIf KeyDown(KEY_DOWN)
    cam_xr = cam_xr - 2
    If cam_xr < 5 Then cam_xr = 5
  EndIf

  If KeyDown(KEY_Q)
    cam_zr = cam_zr + 2
  ElseIf KeyDown(KEY_E)
    cam_zr = cam_zr - 2
  EndIf

  If KeyDown(KEY_A)
    cam_z = cam_z + 1
    If cam_z > -10 Then cam_z = -10
  ElseIf KeyDown(KEY_Z)
    cam_z = cam_z - 1
    If cam_z < -180 Then cam_z = -180
  EndIf

  PositionEntity camera, 0, 0, 0
  RotateEntity camera, cam_xr, cam_yr, cam_zr
  MoveEntity camera, 0, 0, cam_z
End Function

Function Draw()
  Color 255, 255, 255
  FontSize 20
  Text 16, 14, "Dragon Demo"
  FontSize 15
  Text 16, 42, "Arrows turn round and look up and down, A/Z zoom, Q/E roll"
  Text 16, 62, "MD2 Dragon model courtesy of Polycount"
End Function
