; Tutorial 1 - Moving with the keys.
;
; Two ways to move something:
;   the tank (left)  turns and drives forward the way it faces
;                    (TurnEntity, MoveEntity: its own axes);
;   the ball (right) slides along the world's axes, whichever way it
;                    faces (TranslateEntity with isGlobal = True).
;
; Arrows or WASD move the one you drive; C changes which. R puts both
; back. Everything moves by DeltaTime() per Update, so the speed is in
; units per second, the same on every computer.

Graphics3D 800, 600

Const SPEED# = 4.0          ; units per second
Const TURN# = 120.0         ; degrees per second

Global camera, tank, ball, driving

camera = CreateCamera()
CameraClsColor camera, 150, 190, 230
PositionEntity camera, 0, 9, -11
RotateEntity camera, 40, 0, 0

light = CreateLight()
RotateEntity light, 50, -30, 0
AmbientLight 110, 110, 120

; A checkered floor, so movement is easy to see.
floor = CreatePlane(8)
ScaleEntity floor, 12, 1, 12
checker = CreateCheckerTexture(64, 8, 200, 200, 190, 170, 170, 160)
ScaleTexture checker, 1 / 3.0, 1 / 3.0
EntityTexture floor, checker

; The tank: a body with a barrel on the front, so you can tell where it
; faces (+Z is its forward).
tank = CreateCube()
ScaleEntity tank, 0.8, 0.4, 1
EntityColor tank, 90, 140, 70
barrel = CreateCylinder(12, True, tank)
RotateEntity barrel, 90, 0, 0          ; lie the cylinder along Z
ScaleEntity barrel, 0.15, 0.8, 0.15    ; in the tank's (scaled) space
PositionEntity barrel, 0, 0.6, 1.2
EntityColor barrel, 60, 90, 50

; The ball, with a band round it so you can see that it does not turn.
ball = CreateSphere(20)
ScaleEntity ball, 0.7, 0.7, 0.7
EntityColor ball, 230, 110, 60
band = CreateTorus(32, 0.1, ball)
RotateEntity band, 0, 0, 90            ; stand the ring up
ScaleEntity band, 1.08, 1.08, 1.08     ; the tube just over the surface
EntityColor band, 255, 255, 255

Reset()

Function Reset()
  PositionEntity tank, -3, 0.4, 0
  RotateEntity tank, 0, 0, 0
  PositionEntity ball, 3, 0.7, 0
End Function

; Which way the keys point: -1, 0 or 1 across (x) and forward (z).
Function KeyX()
  x = 0
  If KeyDown(KEY_LEFT) Or KeyDown(KEY_A) Then x = x - 1
  If KeyDown(KEY_RIGHT) Or KeyDown(KEY_D) Then x = x + 1
  Return x
End Function

Function KeyZ()
  z = 0
  If KeyDown(KEY_DOWN) Or KeyDown(KEY_S) Then z = z - 1
  If KeyDown(KEY_UP) Or KeyDown(KEY_W) Then z = z + 1
  Return z
End Function

Function Update()
  If KeyHit(KEY_C) Then driving = 1 - driving
  If KeyHit(KEY_R) Then Reset()

  If driving = 0
    ; The tank: left/right turn it (a positive yaw turns left), up/down
    ; move it along its own Z axis, the way it faces now.
    TurnEntity tank, 0, -KeyX() * TURN * DeltaTime(), 0
    MoveEntity tank, 0, 0, KeyZ() * SPEED * DeltaTime()
  Else
    ; The ball: the keys are world directions. True means the world's
    ; axes, not the ball's own.
    TranslateEntity ball, KeyX() * SPEED * DeltaTime(), 0, KeyZ() * SPEED * DeltaTime(), True
  EndIf
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "1. Moving with the keys"
  FontSize 15
  If driving = 0
    Text 16, 46, "Driving the tank: TurnEntity + MoveEntity (its own axes)"
  Else
    Text 16, 46, "Driving the ball: TranslateEntity (the world's axes)"
  EndIf
  Text 16, 66, "Tank at " + Int(EntityX(tank)) + ", " + Int(EntityZ(tank)) + " facing " + Int(EntityYaw(tank)) + " degrees"
  Text 16, GraphicsHeight() - 28, "Arrows/WASD move   C change   R reset"
End Function
