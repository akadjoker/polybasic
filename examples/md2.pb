; MD2 flags - a hundred flags, each an MD2 model playing its own animation.
;
; An MD2 file keeps every frame's vertices; a pose is the blend of two
; frames, so a hundred of them cost little. 1 loop, 2 ping-pong, 3 once,
; 0 stop, Up/Down speed, T turns the blend into a new animation on and off.
; Right drag turns the view.
;
; flag.md2 and flag.png are drawn by tools/make-assets.mjs.

Graphics3D 800, 600

Const ROWS = 9, COLS = 11, GAP# = 5.0

Global camera, yaw#, pitch#, speed#, blend, mode$
Dim flags(ROWS * COLS)

camera = CreateCamera()
CameraClsColor camera, 170, 205, 235
light = CreateLight()
RotateEntity light, 50, -30, 0
AmbientLight 90, 90, 110

ground = CreatePlane()
ScaleEntity ground, 200, 1, 200
EntityColor ground, 110, 150, 90

cloth = LoadTexture("assets/flag.png")
flag = LoadMD2("assets/flag.md2")
EntityTexture flag, cloth
EntityFX flag, FX_TWOSIDED
HideEntity flag

For r = 0 To ROWS - 1
  For c = 0 To COLS - 1
    pole = CreateCylinder(6)
    ScaleEntity pole, 0.06, 2.4, 0.06
    PositionEntity pole, (c - COLS / 2) * GAP, 2.4, r * GAP
    EntityColor pole, 90, 80, 70
    f = CopyEntity(flag)
    ShowEntity f
    PositionEntity f, (c - COLS / 2) * GAP, 2.8, r * GAP
    TurnEntity f, 0, Rnd(-20, 20), 0
    flags(r * COLS + c) = f
  Next
Next

speed = 0.3
blend = True
Play(ANIM_LOOP, "loop")
yaw = 0
pitch = 18

Function Play(how, name$)
  mode = name
  If blend Then steps# = 12 Else steps# = 0
  For i = 0 To ROWS * COLS - 1
    ; Each a little faster or slower than the next, so they drift apart.
    AnimateMD2 flags(i), how, speed * (0.8 + (i Mod 7) * 0.06), 0, MD2AnimLength(flags(i)) - 1, steps
  Next
End Function

Function Update()
  If KeyHit(KEY_1) Then Play(ANIM_LOOP, "loop")
  If KeyHit(KEY_2) Then Play(ANIM_PINGPONG, "ping-pong")
  If KeyHit(KEY_3) Then Play(ANIM_ONCE, "once")
  If KeyHit(KEY_0) Then Play(ANIM_STOP, "stopped")
  If KeyHit(KEY_UP)
    speed = Min(1, speed + 0.1)
    Play(ANIM_LOOP, "loop")
  EndIf
  If KeyHit(KEY_DOWN)
    speed = Max(0.1, speed - 0.1)
    Play(ANIM_LOOP, "loop")
  EndIf
  If KeyHit(KEY_T) Then blend = Not blend

  If MouseDown(MOUSE_RIGHT)
    yaw = yaw - MouseXSpeed() * 0.25
    pitch = Max(-10, Min(80, pitch + MouseYSpeed() * 0.25))
  EndIf
  RotateEntity camera, pitch, yaw, 0
  PositionEntity camera, 0, 4, ROWS * GAP / 2
  MoveEntity camera, 0, 0, -36
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "MD2 flags"
  FontSize 15
  playing = 0
  For i = 0 To ROWS * COLS - 1
    playing = playing + MD2Animating(flags(i))
  Next
  If blend Then b$ = "on" Else b$ = "off"
  Text 16, 46, ROWS * COLS + " flags, " + playing + " playing (" + mode + "), speed " + Int(speed * 10) / 10.0 + " frames a step, blend " + b
  Text 16, 66, "first flag at frame " + Int(MD2AnimTime(flags(0)) * 10) / 10.0 + " of " + MD2AnimLength(flags(0))
  Text 16, 86, "1 loop  2 ping-pong  3 once  0 stop  Up/Down speed  T blend  right drag look"
End Function
