; Physics on Rapier: bodies, forces, contacts. One step per Update, 1/60 s.
Global floor, crate, ball, spinner, paddle, puck, loose

floor = CreatePlane()
ScaleEntity floor, 20, 1, 20
EntityBody floor, BODY_STATIC

; A crate dropped on the floor comes to rest one unit up (it is 2 tall).
crate = CreateCube()
PositionEntity crate, 0, 6, 0
EntityBody crate

; A ball far away falls freely: after one second it moves at 19.6 units a
; second (the default gravity).
ball = CreateSphere()
PositionEntity ball, 100, 100, 0
EntityBody ball

; Spinning in space: 90 degrees a second of yaw turns it 90 degrees in a
; second, the same way TurnEntity would.
spinner = CreateCube()
PositionEntity spinner, -100, 100, 0
EntityBody spinner
BodyDamping spinner, 0, 0
BodyLockRotation spinner, 1, 0, 1

; A kinematic paddle moved by the program pushes a puck.
paddle = CreateCube()
PositionEntity paddle, 30, 1, 0
EntityBody paddle, BODY_KINEMATIC
puck = CreateCylinder()
ScaleEntity puck, 0.5, 0.5, 0.5
PositionEntity puck, 33, 0.5, 0
EntityBody puck

loose = CreateSphere()
PositionEntity loose, -30, 1, 0
EntityBody loose, BODY_DYNAMIC, SHAPE_SPHERE

Print "bodies: floor " + EntityHasBody(floor) + " crate " + EntityHasBody(crate) + " camera-less pivot " + EntityHasBody(CreatePivot())

Function Update()
  f = FrameCount()
  ; Gravity would pull the spinner: keep it in place.
  PositionEntity spinner, -100, 100, 0
  If f = 1
    SetAngularVelocity spinner, 0, 90, 0
    ApplyImpulse loose, 5, 0, 0
  EndIf
  If f = 2 Then Print "impulse 5 on mass 1: vx " + BodyVX(loose)
  If f = 3
    SetVelocity loose, 0, 0, 0
    BodyMass loose, 2
    ApplyImpulse loose, 5, 0, 0
  EndIf
  If f = 4 Then Print "impulse 5 on mass 2: vx " + BodyVX(loose)
  If f <= 60 Then MoveEntity paddle, 0.1, 0, 0
  If f = 61
    Print "falling for a second: vy " + BodyVY(ball)
    ; (Int rounds to the nearest whole number.)
    Print "spinner: yaw " + Int(EntityYaw(spinner)) + " (within 0.01: " + (Abs(EntityYaw(spinner) - 90) < 0.01) + "), yaw speed " + Int(BodyYawSpeed(spinner)) + ", pitch speed " + BodyPitchSpeed(spinner)
    Print "puck pushed along: " + (EntityX(puck) > 36)
  EndIf
  If f = 120
    Print "crate resting: y " + (Abs(EntityY(crate) - 1) < 0.02) + ", still: " + (Abs(BodyVY(crate)) < 0.01)
    Print "crate touches " + CountContacts(crate) + " body: the floor " + (ContactEntity(crate, 1) = floor)
    ; Moving a dynamic body by hand is a jump.
    PositionEntity crate, 0, 3, 0
  EndIf
  If f = 121 Then Print "crate after the jump: y " + (EntityY(crate) > 2.9)
  If f = 122
    FreeBody crate
    Print "FreeBody: has body " + EntityHasBody(crate) + ", entity still there " + EntityExists(crate)
    FreeEntity ball
  EndIf
  If f = 124
    Print "a freed entity's body is gone too, the rest runs on"
    EntityBody puck, BODY_DYNAMIC, SHAPE_MESH
  EndIf
End Function
