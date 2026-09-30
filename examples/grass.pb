; Grass - a field swaying in the wind, parted by a ball rolling through it.
;
; Arrows or WASD roll the ball. Click or tap the ground to paint more grass.
; 1/2 less or more wind. C mows everything, R sows the field again.
;
; The tufts are placed once (PaintGrass); the wind and the ball bend them
; as they are drawn (GrassWind, GrassPush), so the program does nothing
; for them each step.

Graphics3D 800, 600

Const FIELD_R# = 14         ; the field's radius
Const BALL_R# = 0.6
Const SPEED# = 4.0

Global camera, ball, ground, meadow, wind#

camera = CreateCamera()
CameraClsColor camera, 170, 205, 235
CameraRange camera, 0.1, 120

sun = CreateLight()
LightColor sun, 255, 245, 220
RotateEntity sun, 45, -30, 0
LightShadows sun, True, 30
AmbientLight 110, 115, 125

ground = CreatePlane(8)
ScaleEntity ground, 40, 1, 40
EntityColor ground, 95, 125, 60
EntityPickMode ground, PICK_POLYGON

ball = CreateSphere(24)
ScaleEntity ball, BALL_R, BALL_R, BALL_R
EntityTexture ball, CreateCheckerTexture(64, 4, 230, 60, 50, 250, 240, 230)
PositionEntity ball, 0, BALL_R, 0

meadow = CreateGrass()
GrassSize meadow, 0.7
Sow()
GrassPush meadow, ball, 1.4
wind = 1
GrassWind meadow, wind

Function Sow()
  ClearGrass meadow
  PaintGrass meadow, 0, 0, FIELD_R, 3000, ground
End Function

Function Update()
  dx# = 0
  dz# = 0
  If KeyDown(KEY_LEFT) Or KeyDown(KEY_A) Then dx = dx - 1
  If KeyDown(KEY_RIGHT) Or KeyDown(KEY_D) Then dx = dx + 1
  If KeyDown(KEY_UP) Or KeyDown(KEY_W) Then dz = dz + 1
  If KeyDown(KEY_DOWN) Or KeyDown(KEY_S) Then dz = dz - 1
  If dx <> 0 Or dz <> 0
    length# = Sqr(dx * dx + dz * dz)
    dx = dx / length * SPEED * DeltaTime()
    dz = dz / length * SPEED * DeltaTime()
    x# = EntityX(ball) + dx
    z# = EntityZ(ball) + dz
    ; Stay on the field.
    If x * x + z * z < (FIELD_R + 4) * (FIELD_R + 4)
      PositionEntity ball, x, BALL_R, z
      ; Roll: turn about the axis across the way it goes, by the distance
      ; over the radius (in degrees).
      TurnEntity ball, dz / BALL_R * 57.3, 0, -dx / BALL_R * 57.3, True
    EndIf
  EndIf

  If KeyHit(KEY_1) Then wind = Max(0, wind - 0.5)
  If KeyHit(KEY_2) Then wind = Min(4, wind + 0.5)
  GrassWind meadow, wind
  If KeyHit(KEY_C) Then ClearGrass meadow
  If KeyHit(KEY_R) Then Sow()

  If MouseHit()
    If CameraPick(camera, MouseX(), MouseY()) = ground
      PaintGrass meadow, PickedX(), PickedZ(), 1.5, 150, ground
    EndIf
  EndIf

  ; The camera follows the ball from behind and above.
  PositionEntity camera, EntityX(ball), 4.5, EntityZ(ball) - 8
  PointEntity camera, ball
End Function

Function Draw()
  Color 20, 35, 30
  FontSize 22
  Text 16, 14, "Grass"
  FontSize 15
  Text 16, 46, CountGrass(meadow) + " tufts, wind " + wind
  ; The controls go over the sky, where they can be read.
  Text 16, 66, "Arrows/WASD roll the ball   Click paint grass"
  Text 16, 86, "1/2 wind   C mow   R sow again"
End Function
