; Castle - one of the Blitz3D samples (zlib licence), ported.
;
; Run about a castle on a hilly island: A and Z go forward and back, Left and
; Right turn, Space jumps, Up and Down tilt the camera and Alt (or Ctrl, or a
; click) fires. The player is an ellipsoid that collides with the terrain
; and the castle's triangles (sliding along walls and hills), the camera is
; a chase camera that eases to a point behind the player, and a shot that
; hits the ground digs a little into the terrain (ModifyTerrain), one that
; hits the castle leaves a bullet hole (a multiplied sprite laid flat on the
; wall with AlignToVector), and every shot ends in a spark.
;
; The sample steps 30 times a second and draws between the steps; here
; every Update is half of a step, so every move, turn, fall, fade and
; counter of the sample is halved. The jump and the fall keep the sample's
; way: what the player moved last step is carried on, less gravity.
;
; Differences: in Blitz3D the water's alpha may come from the picture's
; brightness (not verified), here the water is not see-through, and the
; sample's EntityAutoFade for the trees is left out.
;
; The castle and the runner were .x files, converted to glTF with
; tools/x2gltf.mjs; the files come with the Blitz3D samples.

Graphics3D 800, 600

Const TYPE_PLAYER = 1, TYPE_BULLET = 2, TYPE_TARGET = 3
Const TYPE_SCENERY = 10, TYPE_TERRAIN = 11
Const WATER_LEVEL = -98
Const N_TREES = 100
Const HALF# = 0.5               ; an Update is half a step of the sample

Type Bullet
  Field rot#
  Field sprite
  Field timeOut
End Type

Type Spark
  Field alpha#
  Field sprite
End Type

Type Hole
  Field alpha#
  Field sprite
End Type

Global shootSound, boomSound
Global castle, land, ground, water, sky
Global sparkSprite, bulletSprite, playerModel, holeSprite, treeSprite
Global bullX# = 1.5
Global player, runner, animSpeed#, playerY#
Global camera, camTarget, camHeading, camSky
Global clock#

Collisions TYPE_PLAYER, TYPE_TERRAIN, COLLIDE_POLYGON, RESPONSE_SLIDE_NO_DOWNHILL
Collisions TYPE_PLAYER, TYPE_SCENERY, COLLIDE_POLYGON, RESPONSE_SLIDE
Collisions TYPE_BULLET, TYPE_TERRAIN, COLLIDE_POLYGON, RESPONSE_STOP
Collisions TYPE_BULLET, TYPE_SCENERY, COLLIDE_POLYGON, RESPONSE_STOP
Collisions TYPE_TARGET, TYPE_TERRAIN, COLLIDE_POLYGON, RESPONSE_SLIDE
Collisions TYPE_TARGET, TYPE_SCENERY, COLLIDE_POLYGON, RESPONSE_SLIDE

shootSound = Load3DSound("assets/blitz3d/castle/sounds/shoot.wav")
boomSound = Load3DSound("assets/blitz3d/castle/sounds/boom.wav")
SoundVolume boomSound, 0.5

Setup
LoadEnviron
CreatePlayer 0, 10, 0
CreateChaseCam
CreateListener player, 0.1, 1, 0.2

; --- Setup ---------------------------------------------------------------------

Function Setup()
  castle = LoadMesh("assets/blitz3d/castle/castle.glb")
  ScaleEntity castle, 0.15, 0.15, 0.15
  EntityType castle, TYPE_SCENERY

  playerModel = LoadMesh("assets/blitz3d/castle/mario/mario.glb")
  ScaleEntity playerModel, 0.2, 0.2, 0.2
  TranslateEntity playerModel, 0, -1.25, 0
  HideEntity playerModel

  sparkSprite = LoadSprite("assets/blitz3d/castle/sprites/bigspark.bmp", TEX_COLOR + TEX_MIPMAP)
  HideEntity sparkSprite

  bulletSprite = LoadSprite("assets/blitz3d/castle/sprites/bluspark.bmp", TEX_COLOR + TEX_MIPMAP)
  ScaleSprite bulletSprite, 3, 3
  EntityRadius bulletSprite, 1.5
  EntityType bulletSprite, TYPE_BULLET
  HideEntity bulletSprite

  holeSprite = LoadSprite("assets/blitz3d/castle/sprites/bullet_hole.bmp", TEX_COLOR)
  EntityBlend holeSprite, 2
  SpriteViewMode holeSprite, 2
  HideEntity holeSprite

  treeSprite = LoadSprite("assets/blitz3d/castle/sprites/tree.bmp", TEX_COLOR + TEX_ALPHA + TEX_MASKED)
  HandleSprite treeSprite, 0, -1
  ScaleSprite treeSprite, 2, 4
  SpriteViewMode treeSprite, 3
  HideEntity treeSprite
End Function

; The island: terrain from a heightmap, trees on the land, a ground under
; everything and a sea over it, in a sky box. The planes of Blitz3D never
; end; these are 10000 wide (the camera sees 2000).
Function LoadEnviron()
  light = CreateLight()
  TurnEntity light, 45, 45, 0
  AmbientLight 127, 127, 127           ; Blitz3D's own

  landTex = LoadTexture("assets/blitz3d/driver/terrain-1.jpg", TEX_COLOR + TEX_MIPMAP)
  ScaleTexture landTex, 10, 10

  land = LoadTerrain("assets/blitz3d/driver/heightmap_256.bmp")
  EntityTexture land, landTex
  TerrainShading land, True
  PositionEntity land, -1000, -100, -1000
  ScaleEntity land, 2000.0 / 256, 100, 2000.0 / 256
  EntityType land, TYPE_TERRAIN
  TerrainDetail land, 750, True

  For k = 1 To N_TREES
    Repeat
      tx# = Rnd(-70, 70) - 150
      tz# = Rnd(-70, 70) + 400
      ty# = TerrainY(land, tx, 0, tz)
    Until ty > WATER_LEVEL
    t = CopyEntity(treeSprite)
    ShowEntity t
    PositionEntity t, tx, ty, tz
    ScaleSprite t, Rand(2, 3), Rand(4, 6)
  Next

  ; The ground has the land's picture again, a tile every 10 units.
  groundTex = LoadTexture("assets/blitz3d/driver/terrain-1.jpg", TEX_COLOR + TEX_MIPMAP)
  ScaleTexture groundTex, 10.0 / 10000, 10.0 / 10000
  ground = CreatePlane()
  ScaleEntity ground, 5000, 1, 5000
  EntityTexture ground, groundTex
  PositionEntity ground, 0, -100, 0
  EntityOrder ground, 9

  waterTex = LoadTexture("assets/blitz3d/castle/environ/water-2_mip.bmp", TEX_COLOR + TEX_ALPHA)
  ScaleTexture waterTex, 20.0 / 10000, 20.0 / 10000
  water = CreatePlane()
  ScaleEntity water, 5000, 1, 5000
  EntityTexture water, waterTex
  PositionEntity water, 0, WATER_LEVEL, 0

  sky = MakeSkyBox("assets/blitz3d/castle/environ/sky")
  HideEntity sky
End Function

; Six pictures on the inside of a box that goes where the camera goes, so
; it never gets nearer; its order puts it behind everything.
Function MakeSkyBox(file$)
  box = CreatePivot()
  SkyFace box, file + "_FR.jpg", -1, 1, -1,  1, 1, -1,  1, -1, -1,  -1, -1, -1,  0, 0, 1, 0, 1, 1, 0, 1
  SkyFace box, file + "_LF.jpg", 1, 1, -1,  1, 1, 1,  1, -1, 1,  1, -1, -1,  0, 0, 1, 0, 1, 1, 0, 1
  SkyFace box, file + "_BK.jpg", 1, 1, 1,  -1, 1, 1,  -1, -1, 1,  1, -1, 1,  0, 0, 1, 0, 1, 1, 0, 1
  SkyFace box, file + "_RT.jpg", -1, 1, 1,  -1, 1, -1,  -1, -1, -1,  -1, -1, 1,  0, 0, 1, 0, 1, 1, 0, 1
  SkyFace box, file + "_UP.jpg", -1, 1, 1,  1, 1, 1,  1, 1, -1,  -1, 1, -1,  0, 1, 0, 0, 1, 0, 1, 1
  SkyFace box, file + "_DN.jpg", -1, -1, -1,  1, -1, -1,  1, -1, 1,  -1, -1, 1,  1, 0, 1, 1, 0, 1, 0, 0
  ScaleEntity box, 100, 100, 100
  Return box
End Function

Function SkyFace(box, file$, x0#, y0#, z0#, x1#, y1#, z1#, x2#, y2#, z2#, x3#, y3#, z3#, u0#, v0#, u1#, v1#, u2#, v2#, u3#, v3#)
  face = CreateMesh(box)
  s = CreateSurface(face)
  AddVertex s, x0, y0, z0, u0, v0
  AddVertex s, x1, y1, z1, u1, v1
  AddVertex s, x2, y2, z2, u2, v2
  AddVertex s, x3, y3, z3, u3, v3
  AddTriangle s, 0, 1, 2
  AddTriangle s, 0, 2, 3
  FlipMesh face
  EntityTexture face, LoadTexture(file, TEX_COLOR + TEX_CLAMPU + TEX_CLAMPV)
  EntityFX face, FX_FULLBRIGHT
  EntityOrder face, 10
End Function

; --- The player ----------------------------------------------------------------

; A pivot the ellipsoid is round, with the runner hung below it.
Function CreatePlayer(x#, y#, z#)
  player = CreatePivot()
  runner = CopyEntity(playerModel, player)
  ShowEntity runner
  playerY = y
  PositionEntity player, x, y, z
  EntityType player, TYPE_PLAYER
  EntityRadius player, 1.5
  ResetEntity player
End Function

Function UpdatePlayer()
  If KeyHit(KEY_ALT) Or KeyHit(KEY_CONTROL) Or MouseHit(MOUSE_LEFT) Then CreateBullet

  If KeyDown(KEY_LEFT)
    TurnEntity player, 0, 6 * HALF, 0
  ElseIf KeyDown(KEY_RIGHT)
    TurnEntity player, 0, -6 * HALF, 0
  EndIf

  ; 1.75 frames of the runner a step, and a frame is a sixtieth of a second
  ; in the file: 0.875 of the way it is played.
  If KeyDown(KEY_A)
    If animSpeed <= 0
      animSpeed = 0.875
      Animate runner, 1, ANIM_LOOP, animSpeed
    EndIf
    MoveEntity player, 0, 0, HALF
  ElseIf KeyDown(KEY_Z)
    If animSpeed >= 0
      animSpeed = -0.875
      Animate runner, 1, ANIM_LOOP, animSpeed
    EndIf
    MoveEntity player, 0, 0, -HALF
  ElseIf animSpeed <> 0
    animSpeed = 0
    Animate runner, 0
  EndIf

  ; What it moved up last step (a step's worth of fall) goes on, less
  ; gravity; a jump sets it. In steps: 5 for a jump, 0.5 less a step.
  ty# = EntityY(player)
  yVel# = (ty - playerY) / HALF
  playerY = ty
  If KeyHit(KEY_SPACE)
    yVel = 5
  Else
    yVel = yVel - 0.5 * HALF
  EndIf
  TranslateEntity player, 0, yVel * HALF, 0
End Function

; --- Bullets, sparks and holes ---------------------------------------------------

Function CreateBullet()
  bullX = -bullX
  b.Bullet = New Bullet
  b\timeOut = 150 / HALF
  b\sprite = CopyEntity(bulletSprite, player)
  ShowEntity b\sprite
  TranslateEntity b\sprite, bullX, 1, 0.25
  EntityParent b\sprite, 0
  EmitSound shootSound, b\sprite
End Function

Function UpdateBullet(b.Bullet)
  If CountCollisions(b\sprite) > 0
    If EntityCollided(b\sprite, TYPE_TERRAIN) <> 0
      EmitSound boomSound, b\sprite
      ; Where the shot is, in the terrain's grid: the terrain starts at
      ; (-1000, -1000) with a cell of 2000 / 256.
      gx# = (EntityX(b\sprite) + 1000) / (2000.0 / 256)
      gz# = (EntityZ(b\sprite) + 1000) / (2000.0 / 256)
      hi# = TerrainHeight(land, gx, gz)
      If hi > 0
        hi = hi - 0.02
        If hi < 0 Then hi = 0
        ModifyTerrain land, gx, gz, hi, True
      EndIf
      CreateSpark b
      FreeEntity b\sprite
      Delete b
      Return
    EndIf
    If EntityCollided(b\sprite, TYPE_SCENERY) <> 0
      For k = 1 To CountCollisions(b\sprite)
        If GetEntityType(CollisionEntity(b\sprite, k)) = TYPE_SCENERY
          cx# = CollisionX(b\sprite, k)
          cy# = CollisionY(b\sprite, k)
          cz# = CollisionZ(b\sprite, k)
          nx# = CollisionNX(b\sprite, k)
          ny# = CollisionNY(b\sprite, k)
          nz# = CollisionNZ(b\sprite, k)
          h.Hole = New Hole
          h\alpha = 1
          h\sprite = CopyEntity(holeSprite)
          ShowEntity h\sprite
          PositionEntity h\sprite, cx, cy, cz
          AlignToVector h\sprite, -nx, -ny, -nz, 3
          MoveEntity h\sprite, 0, 0, -0.1
          Exit
        EndIf
      Next
      EmitSound boomSound, b\sprite
      CreateSpark b
      FreeEntity b\sprite
      Delete b
      Return
    EndIf
  EndIf
  b\timeOut = b\timeOut - 1
  If b\timeOut = 0
    FreeEntity b\sprite
    Delete b
    Return
  EndIf
  b\rot = b\rot + 30 * HALF
  RotateSprite b\sprite, b\rot
  MoveEntity b\sprite, 0, 0, 2 * HALF
End Function

Function CreateSpark(b.Bullet)
  s.Spark = New Spark
  s\alpha = -90
  s\sprite = CopyEntity(sparkSprite, b\sprite)
  ShowEntity s\sprite
  EntityParent s\sprite, 0
End Function

; A spark swells and shrinks, turning every which way.
Function UpdateSpark(s.Spark)
  If s\alpha < 270
    sz# = Sin(s\alpha) * 5 + 5
    ScaleSprite s\sprite, sz, sz
    RotateSprite s\sprite, Rnd(360)
    s\alpha = s\alpha + 15 * HALF
  Else
    FreeEntity s\sprite
    Delete s
  EndIf
End Function

Function UpdateHole(h.Hole)
  h\alpha = h\alpha - 0.005 * HALF
  If h\alpha > 0
    EntityAlpha h\sprite, h\alpha
  Else
    FreeEntity h\sprite
    Delete h
  EndIf
End Function

; --- The camera ------------------------------------------------------------------

; Two pivots on the player: where the camera wants to be (3 up and 10
; behind) and where it looks (20 ahead).
Function CreateChaseCam()
  camera = CreateCamera()
  CameraRange camera, 1, 2000

  camTarget = CreatePivot(player)
  PositionEntity camTarget, 0, 3, -10
  EntityType camTarget, TYPE_TARGET

  camHeading = CreatePivot(player)
  PositionEntity camHeading, 0, 0, 20
  camSky = CopyEntity(sky)
  ShowEntity camSky
End Function

Function UpdateChaseCam()
  If KeyDown(KEY_UP)
    TranslateEntity camHeading, 0, -3 * HALF, 0
  ElseIf KeyDown(KEY_DOWN)
    TranslateEntity camHeading, 0, 3 * HALF, 0
  EndIf

  ; A tenth of the way to the target a step: a tenth of the way a step is
  ; 1 - 0.9 ^ 0.5 of it an Update.
  ease# = 1 - Sqr(0.9)
  dx# = EntityX(camTarget, True) - EntityX(camera, True)
  dy# = EntityY(camTarget, True) - EntityY(camera, True)
  dz# = EntityZ(camTarget, True) - EntityZ(camera, True)
  TranslateEntity camera, dx * ease, dy * ease, dz * ease

  PointEntity camera, camHeading

  PositionEntity camTarget, 0, 0, 0
  ResetEntity camTarget
  PositionEntity camTarget, 0, 3, -10

  PositionEntity camSky, EntityX(camera, True), EntityY(camera, True), EntityZ(camera, True)
End Function

; --- The game --------------------------------------------------------------------

Function Update()
  clock = clock + 16.5               ; milliseconds: 33 a step in the sample

  For h.Hole = Each Hole
    UpdateHole h
  Next
  For b.Bullet = Each Bullet
    UpdateBullet b
  Next
  For s.Spark = Each Spark
    UpdateSpark s
  Next
  UpdatePlayer

  PositionEntity water, Sin(clock * 0.01) * 10, WATER_LEVEL + Sin(clock * 0.05) * 0.5, Cos(clock * 0.02) * 10
  UpdateChaseCam
End Function

Function Draw()
  Color 255, 255, 255
  FontSize 14
  Text 10, 10, "Castle Demo"
  Text 10, 28, "Featuring dynamic terrain, sliding collisions,"
  Text 10, 46, "transparency effects and an intelligent camera"
  Text 10, 64, "A/Z to move, Left/Right to turn, Up/Down to tilt, Space to jump, Alt, Ctrl or click to fire"
End Function
