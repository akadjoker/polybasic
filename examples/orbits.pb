; Orbits - the scene graph at work. The moon is a child of the planet, the
; planet a child of a pivot at the sun's centre: turning a parent carries
; its children along.

Graphics3D 800, 600

Global camPivot, camera, planetPivot, planet, moonPivot, moon
Global distance# = 16

camPivot = CreatePivot()
camera = CreateCamera(camPivot)
CameraClsColor camera, 5, 6, 14
PositionEntity camera, 0, 5, -distance
PointEntity camera, camPivot

AmbientLight 25, 25, 35
sunLight = CreateLight(LIGHT_POINT)
LightRange sunLight, 60

sun = CreateSphere(24)
ScaleEntity sun, 2, 2, 2
EntityColor sun, 255, 200, 80
EntityFX sun, FX_FULLBRIGHT

planetPivot = CreatePivot()
planet = CreateSphere(20, planetPivot)
PositionEntity planet, 7, 0, 0
EntityColor planet, 80, 150, 255
EntityShininess planet, 0.4

moonPivot = CreatePivot(planet)
moon = CreateSphere(12, moonPivot)
PositionEntity moon, 1.8, 0, 0
ScaleEntity moon, 0.35, 0.35, 0.35
EntityColor moon, 200, 200, 210

ring = CreateTorus(48, 0.03)
ScaleEntity ring, 7, 7, 7
EntityColor ring, 90, 100, 140
EntityFX ring, FX_FULLBRIGHT

; A field of little stars around everything
For i = 1 To 120
  star = CreateCube()
  ScaleEntity star, 0.05, 0.05, 0.05
  RotateEntity star, 0, Rnd(360), 0
  tilt# = Rnd(-60, 60)
  TurnEntity star, tilt, 0, 0
  MoveEntity star, 0, 0, Rnd(40, 60)
  EntityFX star, FX_FULLBRIGHT
Next

Function Update()
  TurnEntity planetPivot, 0, 0.6, 0       ; the year
  TurnEntity planet, 0, 2, 0              ; the day
  TurnEntity moonPivot, 0, 3, 0           ; the month
  If KeyDown(KEY_LEFT) Then TurnEntity camPivot, 0, 1.5, 0
  If KeyDown(KEY_RIGHT) Then TurnEntity camPivot, 0, -1.5, 0
  distance = Max(8, Min(40, distance - MouseWheel()))
  PositionEntity camera, 0, 5 * distance / 16, -distance
  PointEntity camera, camPivot
End Function

Function Draw()
  Color 170, 180, 210
  FontSize 15
  Text 12, 12, "Moon world position: " + Int(EntityX(moon, True)) + ", " + Int(EntityZ(moon, True))
  Text 12, 34, "Moon local position: " + EntityX(moon) + ", " + EntityZ(moon)
End Function
