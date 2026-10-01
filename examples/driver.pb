; Driver - Mark Sibly's Blitz3D sample (samples/mak/driver), ported.
;
; Up/Down drive, Left/Right steer. The car is held by four invisible
; wheel spheres that collide with the terrain; every step the car is turned
; to lie along them with AlignToVector.
;
; Heightmap, texture and car are Blitz3D's (zlib licence); car.x was
; converted to glTF with tools/x2gltf.mjs.

Graphics3D 800, 600

Const GRAVITY# = -0.01
Const BODY = 1, WHEEL = 2, SCENE = 3

Global car, camera, target, speed#
Global wheels[4]
Global prev_x#, prev_y#, prev_z#

Collisions BODY, SCENE, COLLIDE_POLYGON, RESPONSE_SLIDE_NO_DOWNHILL
Collisions WHEEL, SCENE, COLLIDE_POLYGON, RESPONSE_SLIDE_NO_DOWNHILL

terr = LoadTerrain("assets/blitz3d/driver/heightmap_256.bmp")
ScaleEntity terr, 1000 / TerrainSize(terr), 70, 1000 / TerrainSize(terr)
TerrainDetail terr, 1000, True
TerrainShading terr, True
PositionEntity terr, -500, 0, -500
tex = LoadTexture("assets/blitz3d/driver/terrain-1.jpg")
ScaleTexture tex, 50, 50
EntityTexture terr, tex
EntityType terr, SCENE

car = LoadMesh("assets/blitz3d/driver/car.glb")
ScaleMesh car, 1, 1, -1
FlipMesh car
FitMesh car, -1.5, -1, -3, 3, 2, 6
PositionEntity car, 0, 70, 0
EntityShininess car, 1
EntityType car, BODY

cnt = 1
For z# = 1.5 To -1.5 Step -3
  For x# = -1 To 1 Step 2
    wheels[cnt] = CreateSphere(8, car)
    EntityAlpha wheels[cnt], 0.5
    ScaleEntity wheels[cnt], 0.5, 0.5, 0.5
    EntityRadius wheels[cnt], 0.5
    PositionEntity wheels[cnt], x, 0, z
    EntityType wheels[cnt], WHEEL
    cnt = cnt + 1
  Next
Next

light = CreateLight()
TurnEntity light, 45, 45, 0

target = CreatePivot(car)
PositionEntity target, 0, 5, -12

camera = CreateCamera()
CameraClsColor camera, 0, 128, 255

prev_x = EntityX(car)
prev_y = EntityY(car)
prev_z = EntityZ(car)

Function Update()
  ; Align the car to its wheels: front minus back, then left minus right.
  zx# = (EntityX(wheels[2], True) + EntityX(wheels[4], True)) / 2
  zx = zx - (EntityX(wheels[1], True) + EntityX(wheels[3], True)) / 2
  zy# = (EntityY(wheels[2], True) + EntityY(wheels[4], True)) / 2
  zy = zy - (EntityY(wheels[1], True) + EntityY(wheels[3], True)) / 2
  zz# = (EntityZ(wheels[2], True) + EntityZ(wheels[4], True)) / 2
  zz = zz - (EntityZ(wheels[1], True) + EntityZ(wheels[3], True)) / 2
  AlignToVector car, zx, zy, zz, 1

  zx = (EntityX(wheels[1], True) + EntityX(wheels[2], True)) / 2
  zx = zx - (EntityX(wheels[3], True) + EntityX(wheels[4], True)) / 2
  zy = (EntityY(wheels[1], True) + EntityY(wheels[2], True)) / 2
  zy = zy - (EntityY(wheels[3], True) + EntityY(wheels[4], True)) / 2
  zz = (EntityZ(wheels[1], True) + EntityZ(wheels[2], True)) / 2
  zz = zz - (EntityZ(wheels[3], True) + EntityZ(wheels[4], True)) / 2
  AlignToVector car, zx, zy, zz, 3

  cx# = EntityX(car)
  x_vel# = cx - prev_x
  prev_x = cx
  cy# = EntityY(car)
  y_vel# = cy - prev_y
  prev_y = cy
  cz# = EntityZ(car)
  z_vel# = cz - prev_z
  prev_z = cz

  ; The wheels hang back under the car; the terrain pushes them up.
  cnt = 1
  For z# = 1.5 To -1.5 Step -3
    For x# = -1 To 1 Step 2
      PositionEntity wheels[cnt], x, -1, z
      cnt = cnt + 1
    Next
  Next

  If KeyDown(KEY_LEFT) Then TurnEntity car, 0, 3, 0
  If KeyDown(KEY_RIGHT) Then TurnEntity car, 0, -3, 0
  If EntityCollided(car, SCENE)
    If KeyDown(KEY_UP)
      speed = speed + 0.02
      If speed > 0.7 Then speed = 0.7
    ElseIf KeyDown(KEY_DOWN)
      speed = speed - 0.02
      If speed < -0.5 Then speed = -0.5
    Else
      speed = speed * 0.9
    EndIf
    MoveEntity car, 0, 0, speed
    TranslateEntity car, 0, GRAVITY, 0
  Else
    TranslateEntity car, x_vel, y_vel + GRAVITY, z_vel
  EndIf

  If speed >= 0
    dx# = EntityX(target, True) - EntityX(camera)
    dy# = EntityY(target, True) - EntityY(camera)
    dz# = EntityZ(target, True) - EntityZ(camera)
    TranslateEntity camera, dx * 0.1, dy * 0.1, dz * 0.1
  EndIf
  PointEntity camera, car
End Function

Function Draw()
  Color 255, 255, 255
  FontSize 22
  Text 16, 14, "Driver"
  FontSize 15
  Text 16, 46, "Up/Down drive   Left/Right steer   speed " + Int(speed * 100)
End Function
