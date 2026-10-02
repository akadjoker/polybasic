; Dead Field - a first-person zombie shooter, made for PolyBasic.
;
; Click to take the mouse. WASD walk, Shift run, Space jump, left click
; shoots, Z or the right button looks down the sights. Shoot the barrels:
; they blow up what stands near them. Headshots count more.
;
; Models: a Mixamo zombie, a plasma gun (Ilia_Tun, CC BY 4.0) and a bonfire
; (LEX_GFX, CC BY 4.0); see assets/zombies/README.md.

Graphics3D 960, 600

Const GRID = 64                 ; the ground: GRID x GRID squares
Const CELL# = 3
Const ARENA# = 58               ; the walkable field's radius
Const EYE# = 1.7
Const PLAYER_R# = 0.45

Global camera, body, ground, aim, sun
Global px#, pz#, py#, fall#, yaw#, pitch#, onGround
Global obstacleCount
Global rockMesh, barrelMesh, crateTex, gun, fireLight, bonfire
Global texGlow, texSmoke, texBlood, texFlash, texRing, texExplosion

Type Prop
  Field e                       ; the entity
  Field barrel                  ; 1 a barrel, 0 a crate
  Field fuse#                   ; seconds to go off once lit, -1 not lit
End Type

Dim obX#(300)
Dim obZ#(300)
Dim obR#(300)

; --- The land --------------------------------------------------------------

Function Smooth#(a#, b#, x#)
  t# = (x - a) / (b - a)
  If t < 0 Then t = 0
  If t > 1 Then t = 1
  Return t * t * (3 - 2 * t)
End Function

; Rolling hills, flat around the middle, rising into a rim at the edge.
Function Rolling#(x#, z#)
  r# = Sqr(x * x + z * z)
  rim# = Smooth(ARENA, ARENA + 60, r)
  hills# = 1.2 * Sin(x * 2.9 + 75) * Cos(z * 2.5 + 23) + 0.5 * Sin(x * 6.9 + z * 5.2)
  Return hills * Smooth(7, 30, r) + rim * rim * 17
End Function

Function BuildGround()
  half# = GRID * CELL / 2
  ground = CreateMesh()
  s = CreateSurface(ground)
  For j = 0 To GRID
    For i = 0 To GRID
      x# = i * CELL - half
      z# = j * CELL - half
      AddVertex s, x, Rolling(x, z), z, x / 5, z / 5
    Next
  Next
  For j = 0 To GRID - 1
    For i = 0 To GRID - 1
      a = j * (GRID + 1) + i
      b = a + 1
      c = a + GRID + 1
      d = c + 1
      AddTriangle s, a, c, b
      AddTriangle s, b, c, d
    Next
  Next
  UpdateNormals ground
  EntityTexture ground, LoadTexture("assets/zombies/ground_d.jpg", TEX_COLOR)
  EntityPickMode ground, PICK_POLYGON
  EntityFX ground, FX_NOSHADOWCAST
End Function


; --- Things that stand in the way: circles, as far as walking goes -----------

Function AddObstacle(x#, z#, r#)
  obX(obstacleCount) = x
  obZ(obstacleCount) = z
  obR(obstacleCount) = r
  obstacleCount = obstacleCount + 1
End Function

Function Blocked(x#, z#, margin#)
  For i = 0 To obstacleCount - 1
    dx# = x - obX(i)
    dz# = z - obZ(i)
    reach# = obR(i) + margin
    If dx * dx + dz * dz < reach * reach Then Return True
  Next
  Return False
End Function

Function Lump#(x#, y#, z#)
  Return 0.16 * Sin(x * 177 + 40) * Sin(y * 155 + 109) + 0.13 * Sin(z * 212 + x * 74) + 0.08 * Sin(y * 349 + z * 246 + 23)
End Function

Function BuildRock()
  rockMesh = CreateMesh()
  s = CreateSurface(rockMesh)
  rings = 10
  slices = 14
  For j = 0 To rings
    v# = Float(j) / rings
    polar# = v * 180
    For i = 0 To slices
      u# = Float(i) / slices
      around# = u * 360
      x# = Sin(polar) * Cos(around)
      y# = Cos(polar)
      z# = Sin(polar) * Sin(around)
      radius# = 1 + Lump(x, y, z)
      AddVertex s, x * radius, y * radius * 0.7, z * radius, u * 3, v * 2
    Next
  Next
  For j = 0 To rings - 1
    For i = 0 To slices - 1
      a = j * (slices + 1) + i
      b = a + 1
      c = a + slices + 1
      d = c + 1
      AddTriangle s, a, c, b
      AddTriangle s, b, c, d
    Next
  Next
  UpdateNormals rockMesh
  EntityTexture rockMesh, LoadTexture("assets/zombies/rock_d.jpg", TEX_COLOR)
  HideEntity rockMesh
End Function

Function PlaceRocks()
  For i = 1 To 24
    angle# = Rnd(360)
    dist# = Rnd(11, 62)
    x# = Cos(angle) * dist
    z# = Sin(angle) * dist
    size# = Rnd(0.8, 2.3)
    If Not Blocked(x, z, size + 2.5)
      rock = CopyEntity(rockMesh)
      ShowEntity rock
      ScaleEntity rock, size * Rnd(0.85, 1.2), size * Rnd(0.7, 1.1), size * Rnd(0.85, 1.2)
      RotateEntity rock, Rnd(-10, 10), Rnd(360), Rnd(-10, 10)
      PositionEntity rock, x, GroundY(x, z) + size * 0.15, z
      EntityPickMode rock, PICK_POLYGON
      AddObstacle x, z, size * 1.05
    EndIf
  Next
End Function

Function PlantForest()
  Dim kind(2)
  kind(0) = TREE_OAK
  kind(1) = TREE_BEECH
  kind(2) = TREE_SHRUB
  For k = 0 To 2
    template = CreateTree(kind(k), 3 + k)
    HideEntity template
    For i = 1 To 26
      angle# = Rnd(360)
      dist# = 20 + Sqr(Rnd(1)) * 80
      x# = Cos(angle) * dist
      z# = Sin(angle) * dist
      trunk = (kind(k) <> TREE_SHRUB)
      If Not Blocked(x, z, 3.0)
        tree = CopyEntity(template)
        ShowEntity tree
        scale# = Rnd(0.85, 1.3)
        ScaleEntity tree, scale, scale, scale
        RotateEntity tree, 0, Rnd(360), 0
        PositionEntity tree, x, GroundY(x, z) - 0.2, z
        If trunk And dist < ARENA + 6 Then AddObstacle x, z, 0.5 * scale
      EndIf
    Next
  Next
End Function

Function PlaceBonfire()
  bonfire = LoadMesh("assets/zombies/bonfire/bonfire.gltf")
  ScaleEntity bonfire, 0.32, 0.32, 0.32
  PositionEntity bonfire, 0, GroundY(0, 9), 9
  AddObstacle 0, 9, 1.3
  fireLight = CreateLight(LIGHT_POINT)
  PositionEntity fireLight, 0, GroundY(0, 9) + 1.3, 9
  LightColor fireLight, 255, 130, 50
  LightRange fireLight, 18
End Function

; --- Barrels and crates that tumble ---------------------------------------

Function AddProp(x#, z#, lift#, barrel)
  p.Prop = New Prop
  p\barrel = barrel
  p\fuse = -1
  If barrel
    p\e = CopyEntity(barrelMesh)
    ShowEntity p\e
    PositionEntity p\e, x, GroundY(x, z) + lift + 0.47, z
  Else
    p\e = CreateCube()
    ScaleEntity p\e, 0.5, 0.5, 0.5
    EntityTexture p\e, crateTex
    PositionEntity p\e, x, GroundY(x, z) + lift + 0.52, z
  EndIf
  RotateEntity p\e, 0, Rnd(360), 0
  EntityPickMode p\e, PICK_POLYGON
  If barrel
    EntityBody p\e, BODY_DYNAMIC, SHAPE_CYLINDER
    BodyMass p\e, 3
  Else
    EntityBody p\e, BODY_DYNAMIC, SHAPE_BOX
    BodyMass p\e, 4
  EndIf
  BodyFriction p\e, 0.8
  BodyDamping p\e, 0.2, 0.5
End Function

Function PlaceProps(groups)
  For i = 1 To groups
    found = False
    For attempt = 1 To 40
      If Not found
        angle# = Rnd(360)
        dist# = Rnd(6, 42)
        x# = Cos(angle) * dist
        z# = Sin(angle) * dist
        dx# = x - px
        dz# = z - pz
        found = (Not Blocked(x, z, 2.2)) And (dx * dx + dz * dz > 16)
      EndIf
    Next
    If found
      AddProp x, z, 0, True
      If i Mod 3 <> 0
        AddProp x + 1.25, z + 0.2, 0, False
        AddProp x + 1.1, z + 0.1, 1.05, False
        If i Mod 2 = 0 Then AddProp x - 0.2, z + 1.3, 0, False
      EndIf
    EndIf
  Next
End Function

; --- Setup -----------------------------------------------------------------

camera = CreateCamera()
CameraRange camera, 0.1, 300
CameraClsColor camera, 150, 120, 110
AmbientLight 70, 70, 85
sun = CreateLight()
RotateEntity sun, 25, 200, 0
LightColor sun, 255, 170, 110

BuildGround()
PhysicsGravity 0, -12, 0
EntityBody ground, BODY_STATIC, SHAPE_MESH
LightShadows sun, True, 70

crateTex = LoadTexture("assets/zombies/crate_d.jpg", TEX_COLOR)
barrelMesh = LoadMesh("assets/zombies/barrel.glb")
HideEntity barrelMesh
BuildRock()
SeedRnd 7
PlaceBonfire()
PlaceRocks()
PlantForest()
meadow = CreateGrass()
GrassSize meadow, 0.7
PaintGrass meadow, 0, 0, 55, 9000, ground

gun = LoadMesh("assets/zombies/gun/gun.gltf", camera)
ScaleEntity gun, 0.07, 0.07, 0.07
PositionEntity gun, 0.24, -0.27, 0.5

body = CreatePivot()
PositionEntity body, 0, 0, -6
EntityParent camera, body, False
PositionEntity camera, 0, EYE, 0
aim = CreatePivot(camera)
PositionEntity aim, 0, 0, 10

Function GroundY#(x#, z#)
  Return Rolling(x, z)
End Function

PlaceProps(14)

Function Update()
  ; Click to take the mouse for looking.
  If MouseHit(MOUSE_LEFT) Then LockPointer True
  If PointerLocked() Or MouseDown(MOUSE_LEFT)
    yaw = yaw - MouseXSpeed() * 0.12
    pitch = Max(-85, Min(85, pitch + MouseYSpeed() * 0.12))
  EndIf
  dt# = DeltaTime()

  x# = 0
  z# = 0
  If KeyDown(KEY_A) Then x = x - 1
  If KeyDown(KEY_D) Then x = x + 1
  If KeyDown(KEY_W) Then z = z + 1
  If KeyDown(KEY_S) Then z = z - 1
  If x <> 0 Or z <> 0
    length# = Sqr(x * x + z * z)
    speed# = 5.2
    If KeyDown(KEY_SHIFT) Then speed = 7.8
    sy# = Sin(yaw)
    cy# = Cos(yaw)
    px = px + (x * cy - z * sy) / length * speed * dt
    pz = pz + (x * sy + z * cy) / length * speed * dt
  EndIf

  floorY# = GroundY(px, pz)
  If py <= floorY + 0.001 And fall <= 0
    py = floorY
    fall = 0
    onGround = 1
    If KeyHit(KEY_SPACE) Then fall = 7
  Else
    onGround = 0
  EndIf
  fall = fall - 22 * dt
  py = py + fall * dt
  If py < floorY Then py = floorY : fall = 0

  PositionEntity body, px, py, pz
  RotateEntity body, 0, yaw, 0
  RotateEntity camera, pitch, 0, 0
End Function

Function Draw()
  cx = GraphicsWidth() / 2
  cy = GraphicsHeight() / 2
  Color 255, 255, 255
  Line cx - 8, cy, cx + 8, cy
  Line cx, cy - 8, cx, cy + 8
  FontSize 15
  Text 16, GraphicsHeight() - 26, "Click: take the mouse   WASD walk   Shift run   Space jump"
End Function
