; Dead Field - a first-person zombie shooter, made for PolyBasic.
;
; Click to take the mouse. WASD walk, Shift run, Space jump, left click
; shoots (F too), the arrows turn the view when the mouse is not taken, Z
; or the right button looks down the sights, R starts
; again once you are down. Shoot the barrels: they blow up what stands near
; them. Headshots count more.
;
; Models: a Mixamo zombie, a plasma gun (Ilia_Tun, CC BY 4.0) and a bonfire
; (LEX_GFX, CC BY 4.0); see assets/zombies/README.md.

Graphics3D 960, 600

Const GRID = 64                 ; the ground: GRID x GRID squares
Const CELL# = 3
Const ARENA# = 58               ; the walkable field's radius
Const EYE# = 1.7
Const PLAYER_R# = 0.45
Const ATTACK_RANGE# = 1.9
Const HEAD_R# = 0.17
Const BLAST# = 8
Const MAX_ALIVE = 12
Const MAX_FX = 280

Const ZS_RUN = 1
Const ZS_HIT = 2
Const ZS_ATTACK = 3
Const ZS_DYING = 4
Const ZS_RISE = 5

Const GAME_INTRO = 0
Const GAME_WAVE = 1
Const GAME_REST = 2
Const GAME_OVER = 3

Global camera, body, ground, aim, sun
Global px#, pz#, py#, fall#, yaw#, pitch#, onGround
Global obstacleCount
Global rockMesh, barrelMesh, crateTex, gun, fireLight, bonfire
Global protoGlow, protoSmoke, protoBlood, protoFire, protoRing, protoFlash
Global zombieMesh, flashSprite, flashLight, blastLight, blastPivot, meadow
Global sndShoot, sndBoom, sndSquish, sndHurt, sndDeath, sndWind
Global aRise, aRun, aAttack, aHit, aDeath, aDying
Global health#, hurtFlash#, state, stateTimer#, wave, score, best, headshots, headline#
Global alive, toSpawn, spawnTimer#, reload#, kick#, flashTicks, scope#, scoped, blastGlow#
Global flicker#, stride#, fxCount
Global notice$
Global skipFire, pvx#, pvz#

Type Prop
  Field e                       ; the entity
  Field barrel                  ; 1 a barrel, 0 a crate
  Field fuse#                   ; seconds to go off once lit, -1 not lit
End Type

Type Zombie
  Field pivot, model            ; stands on the pivot, the model hangs below it
  Field hp
  Field state                   ; one of the ZS_ values
  Field timer#
  Field speed#
  Field struck                  ; the blow of this attack has landed
  Field vx#, vy#, vz#           ; flying about after a blast
  Field head1, head2            ; the head's bones
  Field side                    ; which way it goes round what is in its way: 1 or -1
End Type

; A spark, a puff of smoke, a drop of blood: a sprite that moves, grows and
; fades.
Type Fx
  Field s                       ; the sprite
  Field vx#, vy#, vz#
  Field age#, life#
  Field size0#, size1#
  Field r0#, g0#, b0#, r1#, g1#, b1#
  Field lift#                   ; added to the climb every second
  Field glows                   ; adds to what is behind, fading to black
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
AmbientLight 105, 100, 115
sun = CreateLight()
RotateEntity sun, 25, 200, 0
LightColor sun, 255, 190, 130

BuildGround()
PhysicsGravity 0, -12, 0
EntityBody ground, BODY_STATIC, SHAPE_MESH
LightShadows sun, True, 70

crateTex = LoadTexture("assets/zombies/crate_d.jpg", TEX_COLOR)
barrelMesh = LoadMesh("assets/zombies/barrel.glb")
EntityTexture barrelMesh, LoadTexture("assets/zombies/barrel_d.jpg", TEX_COLOR)
EntityColor barrelMesh, 255, 255, 255
HideEntity barrelMesh
BuildRock()
SeedRnd 7
PlaceBonfire()
PlaceRocks()
PlantForest()
meadow = CreateGrass()
GrassSize meadow, 0.7
PaintGrass meadow, 0, 0, 55, 9000, ground

zombieMesh = LoadMesh("assets/zombies/zombie.glb")
HideEntity zombieMesh
aRise = FindAnimation(zombieMesh, "rise")
aRun = FindAnimation(zombieMesh, "run")
aAttack = FindAnimation(zombieMesh, "attack")
aHit = FindAnimation(zombieMesh, "hit")
aDeath = FindAnimation(zombieMesh, "death")
aDying = FindAnimation(zombieMesh, "dying")

; Sprites to copy for sparks and smoke: glowing ones add to what is behind
; them, the others blend.
protoGlow = LoadSprite("assets/zombies/glow.jpg", TEX_COLOR)
protoFire = LoadSprite("assets/zombies/explosion.jpg", TEX_COLOR)
protoRing = LoadSprite("assets/zombies/ring.png", TEX_COLOR)
protoFlash = LoadSprite("assets/zombies/flash.jpg", TEX_COLOR)
protoSmoke = LoadSprite("assets/zombies/smoke.png", TEX_ALPHA)
protoBlood = LoadSprite("assets/zombies/blood.png", TEX_ALPHA)
HideEntity protoGlow
HideEntity protoFire
HideEntity protoRing
HideEntity protoFlash
HideEntity protoSmoke
HideEntity protoBlood

sndShoot = LoadSound("assets/zombies/shoot.wav")
sndBoom = LoadSound("assets/zombies/boom.wav")
sndSquish = LoadSound("assets/zombies/squish.wav")
sndHurt = LoadSound("assets/zombies/hurt.wav")
sndDeath = LoadSound("assets/zombies/death.wav")
sndWind = LoadSound("assets/zombies/wind.wav")
LoopSound sndWind
SoundVolume sndWind, 0.4
CreateListener camera

gun = LoadMesh("assets/zombies/gun/gun.gltf", camera)
ScaleEntity gun, 0.05, 0.05, 0.05
PositionEntity gun, 0.26, -0.25, 0.55

; The muzzle's flash and the light it throws.
flashSprite = CopyEntity(protoFlash, camera)
ScaleSprite flashSprite, 0.13, 0.13
PositionEntity flashSprite, 0.2, -0.17, 0.85
HideEntity flashSprite
flashLight = CreateLight(LIGHT_POINT, camera)
LightColor flashLight, 255, 200, 120
LightRange flashLight, 14
PositionEntity flashLight, 0.2, -0.15, 1
HideEntity flashLight
blastLight = CreateLight(LIGHT_POINT)
LightColor blastLight, 255, 150, 60
LightRange blastLight, 30
HideEntity blastLight
blastPivot = CreatePivot()
PositionEntity blastPivot, 0, -200, 0
GrassPush meadow, blastPivot, 6

body = CreatePivot()
PositionEntity body, 0, 0, -6
EntityParent camera, body, False
PositionEntity camera, 0, EYE, 0
aim = CreatePivot(camera)
PositionEntity aim, 0, 0, 10
GrassPush meadow, body, 1.2

Function GroundY#(x#, z#)
  Return Rolling(x, z)
End Function

PlaceProps(14)
PlaySound sndWind
LockPointer True            ; the first click takes the mouse

; --- Effects ---------------------------------------------------------------

Function Puff(proto, x#, y#, z#, vx#, vy#, vz#, life#, size0#, size1#, r0#, g0#, b0#, r1#, g1#, b1#, lift#, glows)
  If fxCount >= MAX_FX Then Return
  f.Fx = New Fx
  f\s = CopyEntity(proto)
  ShowEntity f\s
  ScaleSprite f\s, size0, size0
  PositionEntity f\s, x, y, z
  EntityColor f\s, r0, g0, b0
  f\vx = vx
  f\vy = vy
  f\vz = vz
  f\life = life
  f\size0 = size0
  f\size1 = size1
  f\r0 = r0
  f\g0 = g0
  f\b0 = b0
  f\r1 = r1
  f\g1 = g1
  f\b1 = b1
  f\lift = lift
  f\glows = glows
  fxCount = fxCount + 1
End Function

; n puffs flying off in every direction.
Function Burst(proto, n, x#, y#, z#, speed#, life#, size0#, size1#, r0#, g0#, b0#, r1#, g1#, b1#, lift#, glows)
  For i = 1 To n
    dx# = Rnd(-1, 1)
    dy# = Rnd(-1, 1)
    dz# = Rnd(-1, 1)
    d# = Sqr(dx * dx + dy * dy + dz * dz)
    If d < 0.01 Then d = 1
    v# = speed * Rnd(0.3, 1)
    Puff proto, x, y, z, dx / d * v, dy / d * v, dz / d * v, life * Rnd(0.5, 1), size0, size1, r0, g0, b0, r1, g1, b1, lift, glows
  Next
End Function

Function UpdateEffects(dt#)
  For f.Fx = Each Fx
    f\age = f\age + dt
    If f\age >= f\life
      FreeEntity f\s
      Delete f
      fxCount = fxCount - 1
    Else
      k# = f\age / f\life
      f\vy = f\vy + f\lift * dt
      TranslateEntity f\s, f\vx * dt, f\vy * dt, f\vz * dt, True
      size# = f\size0 + (f\size1 - f\size0) * k
      ScaleSprite f\s, size, size
      r# = f\r0 + (f\r1 - f\r0) * k
      g# = f\g0 + (f\g1 - f\g0) * k
      b# = f\b0 + (f\b1 - f\b0) * k
      If f\glows
        EntityColor f\s, r * (1 - k), g * (1 - k), b * (1 - k)
      Else
        EntityColor f\s, r, g, b
        EntityAlpha f\s, 1 - k
      EndIf
    EndIf
  Next

  flicker = flicker + dt * 11
  glow# = 2.4 + 0.5 * Sin(flicker * 57) + 0.35 * Sin(flicker * 154 + 57)
  LightColor fireLight, 255 * glow / 3, 130 * glow / 3, 50 * glow / 3
  If blastGlow > 0
    blastGlow = blastGlow - dt * 4
    If blastGlow <= 0
      HideEntity blastLight
    Else
      LightColor blastLight, 255 * blastGlow, 150 * blastGlow, 60 * blastGlow
    EndIf
  EndIf
End Function

Function Bleed(x#, y#, z#)
  Burst protoSmoke, 6, x, y, z, 0.9, 0.45, 0.2, 2.4, 200, 16, 16, 120, 0, 0, -1, False
  Burst protoBlood, 22, x, y, z, 3.4, 0.7, 0.09, 0.5, 215, 18, 18, 130, 0, 0, -9, False
End Function

; --- The player --------------------------------------------------------------

Function HurtPlayer(amount#)
  If state = GAME_OVER Then Return
  health = health - amount
  hurtFlash = 0.35
  PlaySound sndHurt
  If health <= 0
    health = 0
    state = GAME_OVER
    stateTimer = 1.5
    If score > best Then best = score
  EndIf
End Function

; --- Zombies -----------------------------------------------------------------

Function FaceTowards(pivot, dx#, dz#)
  RotateEntity pivot, 0, ATan2(-dx, dz), 0
End Function

; How far from straight at the player to try next when something is in the
; way: wider and wider to one side (a zombie keeps its side, so it goes round
; a bonfire instead of shuffling in front of it), then the other side.
Function TurnOffset#(n)
  Select n
    Case 1 : Return 35
    Case 2 : Return 70
    Case 3 : Return 110
    Case 4 : Return 150
    Case 5 : Return -35
    Case 6 : Return -70
    Case 7 : Return -110
    Case 8 : Return -150
  End Select
  Return 0
End Function

Function RunAgain(z.Zombie, transition#)
  z\state = ZS_RUN
  ; The run cycle covers about 3.2 units: the animation's pace follows
  ; how fast this zombie goes.
  Animate z\model, aRun, ANIM_LOOP, z\speed / 3.9, transition
End Function

; A zombie climbs out of the ground at x, z.
Function SpawnAt(x#, z#)
  e.Zombie = New Zombie
  e\hp = 3 + wave / 3
  e\side = 1
  If Rand(2) = 1 Then e\side = -1
  e\speed = Min(5.2, Rnd(2.6, 3.4) + 0.2 * wave)
  e\pivot = CreatePivot()
  PositionEntity e\pivot, x, GroundY(x, z), z
  FaceTowards e\pivot, px - x, pz - z
  e\model = CopyEntity(zombieMesh, e\pivot)
  ShowEntity e\model
  EntityBox e\model, -0.38, 0, -0.32, 0.76, 1.95, 0.64
  EntityPickMode e\model, PICK_BOX
  e\head1 = FindChild(e\model, "mixamorig:Head")
  e\head2 = FindChild(e\model, "mixamorig:HeadTop_End")
  e\state = ZS_RISE
  e\timer = 2.7
  Animate e\model, aRise, ANIM_ONCE, 2.1
  alive = alive + 1
End Function

; One at a place far from the player, clear of rocks and trunks.
Function SpawnZombie()
  For attempt = 1 To 60
    angle# = Rnd(360)
    dist# = Rnd(36, ARENA)
    x# = Cos(angle) * dist
    z# = Sin(angle) * dist
    dx# = x - px
    dz# = z - pz
    If dx * dx + dz * dz > 400 And Not Blocked(x, z, 1)
      SpawnAt x, z
      Return
    EndIf
  Next
End Function

Function KillZombie(z.Zombie, fx#, fy#, fz#, blast)
  If z\state = ZS_DYING Then Return
  z\state = ZS_DYING
  z\timer = 7
  alive = alive - 1
  If blast Then score = score + 15 Else score = score + 10
  EntityPickMode z\model, PICK_NONE
  EmitSound sndDeath, z\pivot
  z\vx = fx
  z\vy = fy
  z\vz = fz
  If blast
    FaceTowards z\pivot, -fx, -fz
    Animate z\model, aDeath, ANIM_ONCE, 1.13, 6
  Else
    If Rand(2) = 1 Then Animate z\model, aDeath, ANIM_ONCE, 1.13, 9 Else Animate z\model, aDying, ANIM_ONCE, 1.13, 9
  EndIf
End Function

Function UpdateZombies(dt#)
  For z.Zombie = Each Zombie
    x# = EntityX(z\pivot, True)
    zz# = EntityZ(z\pivot, True)
    If z\state = ZS_DYING
      z\timer = z\timer - dt
      y# = EntityY(z\pivot, True)
      floorY# = GroundY(x, zz)
      If z\timer < 1.5
        ; Sinking into the ground.
        TranslateEntity z\pivot, 0, -0.7 * dt, 0, True
      ElseIf z\vy <> 0 Or y > floorY + 0.001
        z\vy = z\vy - 22 * dt
        nx# = x + z\vx * dt
        ny# = y + z\vy * dt
        nz# = zz + z\vz * dt
        If Blocked(nx, nz, 0.3)
          nx = x
          nz = zz
          z\vx = 0
          z\vz = 0
        EndIf
        under# = GroundY(nx, nz)
        If ny <= under
          ny = under
          z\vx = 0
          z\vy = 0
          z\vz = 0
        EndIf
        PositionEntity z\pivot, nx, ny, nz, True
      EndIf
      If z\timer <= 0
        FreeEntity z\pivot
        Delete z
      EndIf
    Else
      dx# = px - x
      dz# = pz - zz
      dist# = Sqr(dx * dx + dz * dz)
      If z\state = ZS_RISE Or z\state = ZS_HIT
        If state <> GAME_OVER Then z\timer = z\timer - dt
        If z\timer <= 0 Then RunAgain z, 12
      ElseIf z\state = ZS_RUN
        If state = GAME_OVER
          ; The player is down: they stand about.
        ElseIf dist < ATTACK_RANGE And py - GroundY(px, pz) < 1.2
          z\state = ZS_ATTACK
          z\timer = 0
          z\struck = 0
          FaceTowards z\pivot, dx, dz
          Animate z\model, aAttack, ANIM_ONCE, 1.7, 9
        Else
          ; Walk at the player; round whatever stands in the way.
          moved = False
          For turn = 0 To 8
            If Not moved
              a# = ATan2(-dx, dz) + TurnOffset(turn) * z\side
              ; a is a yaw: forward is (-sin a, cos a)
              mx# = x - Sin(a) * z\speed * dt
              mz# = zz + Cos(a) * z\speed * dt
              If Not Blocked(mx, mz, 0.45)
                x = mx
                zz = mz
                moved = True
                If turn >= 5 Then z\side = -z\side   ; that side is closed: keep to the other
                RotateEntity z\pivot, 0, a, 0
              EndIf
            EndIf
          Next
          ; Not on top of the others.
          For o.Zombie = Each Zombie
            If o <> z And o\state <> ZS_DYING
              ox# = x - EntityX(o\pivot, True)
              oz# = zz - EntityZ(o\pivot, True)
              od# = Sqr(ox * ox + oz * oz)
              If od < 0.9 And od > 0.001
                x = x + ox / od * (0.9 - od) * 0.5
                zz = zz + oz / od * (0.9 - od) * 0.5
              EndIf
            EndIf
          Next
          PushProps x, GroundY(x, zz), zz, 0.45, (x - EntityX(z\pivot, True)) / dt, (zz - EntityZ(z\pivot, True)) / dt
          PositionEntity z\pivot, x, GroundY(x, zz), zz, True
        EndIf
      Else
        ; Attacking.
        FaceTowards z\pivot, dx, dz
        z\timer = z\timer + dt
        If z\struck = 0 And z\timer > 0.55
          z\struck = 1
          If dist < ATTACK_RANGE + 0.7 And py - GroundY(px, pz) < 1.2 Then HurtPlayer 9
        EndIf
        If z\timer > 1.45
          If dist < ATTACK_RANGE
            z\timer = 0
            z\struck = 0
            Animate z\model, aAttack, ANIM_ONCE, 1.7, 6
          Else
            RunAgain z, 10
          EndIf
        EndIf
      EndIf
    EndIf
  Next
End Function

; --- Props: barrels that blow up, crates that fly ------------------------------

Function Explode(p.Prop)
  x# = EntityX(p\e, True)
  y# = EntityY(p\e, True)
  z# = EntityZ(p\e, True)
  FreeEntity p\e
  Delete p

  spot = CreatePivot()
  PositionEntity spot, x, y, z
  EmitSound sndBoom, spot
  FreeEntity spot
  Burst protoFire, 14, x, y + 0.4, z, 7, 0.8, 1.2, 3.4, 255, 225, 150, 255, 70, 10, 3, True
  Burst protoGlow, 60, x, y + 0.4, z, 22, 1, 0.2, 0.3, 255, 210, 120, 255, 80, 20, -16, True
  Burst protoSmoke, 22, x, y + 1, z, 3.5, 2.8, 2, 3, 70, 66, 62, 30, 30, 30, 2.5, False
  Puff protoRing, x, y + 0.3, z, 0, 0, 0, 0.4, 0.5, 11, 255, 220, 160, 255, 220, 160, 0, True
  PositionEntity blastPivot, x, y, z
  PositionEntity blastLight, x, y + 1.2, z
  ShowEntity blastLight
  blastGlow = 1

  For q.Prop = Each Prop
    dx# = EntityX(q\e, True) - x
    dy# = EntityY(q\e, True) - y
    dz# = EntityZ(q\e, True) - z
    d# = Sqr(dx * dx + dy * dy + dz * dz)
    If q\barrel And q\fuse < 0 And d < BLAST * 0.77 Then q\fuse = Rnd(0.15, 0.4)
    If d < BLAST And d > 0.01
      fall# = 1 - d / BLAST
      mass# = 4
      If q\barrel Then mass = 3
      k# = (11 * fall + 3) * mass / d
      ApplyImpulse q\e, dx * k, dy * k + 3 * mass * fall, dz * k
    EndIf
  Next

  For e.Zombie = Each Zombie
    If e\state <> ZS_DYING
      ex# = EntityX(e\pivot, True) - x
      ez# = EntityZ(e\pivot, True) - z
      ed# = Sqr(ex * ex + ez * ez)
      If ed < BLAST
        push# = 9 * (1 - ed / BLAST) + 4
        If ed < 0.01 Then inv# = 0 Else inv = 1 / ed
        KillZombie e, ex * inv * push, 5 + push * 0.6, ez * inv * push, True
      EndIf
    EndIf
  Next

  dx = px - x
  dz = pz - z
  reach# = Sqr(dx * dx + dz * dz)
  If reach < BLAST * 0.7 Then HurtPlayer 30 * (1 - reach / (BLAST * 0.7)) + 5
End Function

; What walks into a barrel or a crate shoves it along: the prop takes the
; walker's own speed (a little more, so it goes ahead of them) and keeps its
; own fall. Walking away from it, or jumping over it, pushes nothing.
Function PushProps(x#, y#, z#, radius#, vx#, vz#)
  If vx = 0 And vz = 0 Then Return
  For p.Prop = Each Prop
    ox# = EntityX(p\e, True) - x
    oz# = EntityZ(p\e, True) - z
    reach# = radius + 0.72
    If p\barrel Then reach = radius + 0.5
    If ox * ox + oz * oz < reach * reach And Abs(EntityY(p\e, True) - y - 0.5) < 1.2
      If ox * vx + oz * vz > 0 Then SetVelocity p\e, vx * 1.1, BodyVY(p\e), vz * 1.1
    EndIf
  Next
End Function

Function UpdateProps(dt#)
  For p.Prop = Each Prop
    If EntityY(p\e, True) < -30
      FreeEntity p\e
      Delete p
    ElseIf p\fuse >= 0
      p\fuse = p\fuse - dt
      If p\fuse <= 0 Then Explode p
    EndIf
  Next
End Function

; --- Shooting ----------------------------------------------------------------

Function Shoot()
  reload = 0.13
  kick = 1
  flashTicks = 3
  RotateSprite flashSprite, Rnd(360)
  If scope < 0.5 Then ShowEntity flashSprite
  ShowEntity flashLight
  PlaySound sndShoot

  ox# = EntityX(camera, True)
  oy# = EntityY(camera, True)
  oz# = EntityZ(camera, True)
  dx# = (EntityX(aim, True) - ox) / 10
  dy# = (EntityY(aim, True) - oy) / 10
  dz# = (EntityZ(aim, True) - oz) / 10

  ; What the shot meets first, and how far away.
  reach# = 120
  hit = LinePick(ox, oy, oz, dx * 120, dy * 120, dz * 120)
  If hit Then reach = PickedDistance()
  hx# = ox + dx * reach
  hy# = oy + dy * reach
  hz# = oz + dz * reach

  ; A head on the way?
  skull.Zombie = Null
  nearest# = reach
  For z.Zombie = Each Zombie
    If z\state <> ZS_DYING
      qx# = (EntityX(z\head1, True) + EntityX(z\head2, True)) / 2 - ox
      qy# = (EntityY(z\head1, True) + EntityY(z\head2, True)) / 2 - oy
      qz# = (EntityZ(z\head1, True) + EntityZ(z\head2, True)) / 2 - oz
      t# = qx * dx + qy * dy + qz * dz
      If t > 0 And t < nearest
        ex# = qx - dx * t
        ey# = qy - dy * t
        ez# = qz - dz * t
        If ex * ex + ey * ey + ez * ez < HEAD_R * HEAD_R
          nearest = t
          skull = z
        EndIf
      EndIf
    EndIf
  Next

  If skull <> Null
    hx = ox + dx * nearest
    hy = oy + dy * nearest
    hz = oz + dz * nearest
    PlaySound sndSquish
    Bleed hx, hy, hz
    Burst protoBlood, 30, hx, hy, hz, 5.5, 0.9, 0.12, 0.7, 225, 20, 20, 120, 0, 0, -9, False
    KillZombie skull, 0, 0, 0, False
    score = score + 15
    headshots = headshots + 1
    headline = 0.9
    notice = "HEADSHOT"
  ElseIf hit
    Strike hit, hx, hy, hz, dx, dy, dz
  EndIf

  ; The tracer.
  Puff protoGlow, ox + dx * 1.1, oy + dy * 1.1 - 0.18, oz + dz * 1.1, dx * 140, dy * 140, dz * 140, Min(0.5, reach / 140), 0.14, 0.05, 110, 200, 255, 30, 90, 255, 0, True
End Function

Function Strike(hit, x#, y#, z#, dx#, dy#, dz#)
  For e.Zombie = Each Zombie
    If e\model = hit And e\state <> ZS_DYING
      PlaySound sndSquish
      Bleed x, y, z
      e\hp = e\hp - 1
      If e\hp <= 0
        KillZombie e, 0, 0, 0, False
      ElseIf e\state <> ZS_HIT And e\state <> ZS_RISE
        e\state = ZS_HIT
        e\timer = 0.45
        Animate e\model, aHit, ANIM_ONCE, 2.3, 5
      EndIf
      Return
    EndIf
  Next
  For p.Prop = Each Prop
    If p\e = hit
      If p\barrel
        If p\fuse < 0 Then p\fuse = 0
      Else
        ApplyImpulse p\e, dx * 26, dy * 26 + 5, dz * 26
      EndIf
    EndIf
  Next
  Burst protoGlow, 14, x, y, z, 5, 0.4, 0.1, 0.2, 150, 220, 255, 30, 90, 255, -9, True
End Function

; --- A game --------------------------------------------------------------------

Function NextWave()
  wave = wave + 1
  toSpawn = 4 + wave * 3
  spawnTimer = 1.5
  state = GAME_WAVE
  notice = "WAVE " + wave
  headline = 2
End Function

Function NewGame()
  For z.Zombie = Each Zombie
    FreeEntity z\pivot
    Delete z
  Next
  For p.Prop = Each Prop
    FreeEntity p\e
    Delete p
  Next
  For f.Fx = Each Fx
    FreeEntity f\s
    Delete f
  Next
  fxCount = 0
  alive = 0
  px = 0
  pz = -6
  yaw = 0
  pitch = 0
  fall = 0
  health = 100
  wave = 0
  score = 0
  headshots = 0
  PlaceProps 14
  NextWave
End Function

Function Update()
  dt# = DeltaTime()
  ; The mouse is taken by a click (and taken again after Esc).
  If Not PointerLocked() Then LockPointer True
  skipFire = False
  If state = GAME_INTRO
    If MouseHit(MOUSE_LEFT) Or KeyHit(KEY_ENTER)
      NewGame
      skipFire = True            ; the click that starts is not a shot
    EndIf
  EndIf
  If state = GAME_OVER
    stateTimer = stateTimer - dt
    If stateTimer < 0 And (KeyHit(KEY_R) Or KeyHit(KEY_ENTER)) Then NewGame
  EndIf

  ; Looking down the sights, which slows the turning.
  If KeyHit(KEY_Z) Then scoped = Not scoped
  sighting = (state <> GAME_OVER) And (scoped Or MouseDown(MOUSE_RIGHT))
  If sighting Then goal# = 1 Else goal# = 0
  scope = scope + (goal - scope) * 0.22
  zoom# = 1 + 3 * Smooth(0, 1, scope)
  CameraFOV camera, 60 / zoom

  If PointerLocked() And state <> GAME_OVER
    yaw = yaw - MouseXSpeed() * 0.12 / zoom
    pitch = Max(-85, Min(85, pitch + MouseYSpeed() * 0.12 / zoom))
  EndIf
  ; Without the mouse, the arrows turn the view.
  If state <> GAME_OVER
    If KeyDown(KEY_LEFT) Then yaw = yaw + 120 * dt / zoom
    If KeyDown(KEY_RIGHT) Then yaw = yaw - 120 * dt / zoom
    If KeyDown(KEY_UP) Then pitch = Max(-85, pitch - 80 * dt / zoom)
    If KeyDown(KEY_DOWN) Then pitch = Min(85, pitch + 80 * dt / zoom)
  EndIf

  oldX# = px
  oldZ# = pz
  x# = 0
  z# = 0
  If state <> GAME_OVER
    If KeyDown(KEY_A) Then x = x - 1
    If KeyDown(KEY_D) Then x = x + 1
    If KeyDown(KEY_W) Then z = z + 1
    If KeyDown(KEY_S) Then z = z - 1
  EndIf
  moving = False
  If x <> 0 Or z <> 0
    moving = True
    length# = Sqr(x * x + z * z)
    speed# = 5.2
    If KeyDown(KEY_SHIFT) And scope < 0.5 Then speed = 7.8
    speed = speed * (1 - 0.5 * scope)
    sy# = Sin(yaw)
    cy# = Cos(yaw)
    px = px + (x * cy - z * sy) / length * speed * dt
    pz = pz + (x * sy + z * cy) / length * speed * dt
  EndIf

  ; Stay in the field and out of the rocks and trunks.
  For pass = 0 To 1
    For i = 0 To obstacleCount - 1
      ox# = px - obX(i)
      oz# = pz - obZ(i)
      reach# = obR(i) + PLAYER_R
      od# = ox * ox + oz * oz
      If od < reach * reach And od > 0.0001
        od = Sqr(od)
        px = obX(i) + ox / od * reach
        pz = obZ(i) + oz / od * reach
      EndIf
    Next
  Next
  edge# = Sqr(px * px + pz * pz)
  If edge > ARENA - 1
    px = px / edge * (ARENA - 1)
    pz = pz / edge * (ARENA - 1)
  EndIf
  PushProps px, py, pz, PLAYER_R, (px - oldX) / dt, (pz - oldZ) / dt

  floorY# = GroundY(px, pz)
  If py <= floorY + 0.001 And fall <= 0
    py = floorY
    fall = 0
    If KeyHit(KEY_SPACE) And state <> GAME_OVER Then fall = 7
  EndIf
  fall = fall - 22 * dt
  py = py + fall * dt
  If py < floorY Then py = floorY : fall = 0

  If moving And py <= floorY + 0.05 Then stride = stride + speed * dt * 1.6
  bob# = Sin(stride * 57) * 0.035

  height# = EYE
  If state = GAME_OVER Then height = Max(0.35, EYE - (1.5 - Max(0, stateTimer)) * 1.2)
  PositionEntity body, px, py, pz
  RotateEntity body, 0, yaw, 0
  PositionEntity camera, 0, height + bob, 0
  If state = GAME_OVER Then RotateEntity camera, Min(pitch + 40, 70), 0, 0 Else RotateEntity camera, pitch, 0, 0

  ; The gun: kicks back, sways, drops out of sight in the sights.
  kick = kick * 0.82
  If scope > 0.5 Then HideEntity gun Else ShowEntity gun
  PositionEntity gun, 0.26 + Sin(stride * 28) * 0.006, -0.25 + bob * 0.2 - kick * 0.01, 0.55 - kick * 0.06
  RotateEntity gun, -kick * 5, 0, 0
  If flashTicks > 0
    flashTicks = flashTicks - 1
    If flashTicks = 0
      HideEntity flashSprite
      HideEntity flashLight
    EndIf
  EndIf

  reload = reload - dt
  If (KeyDown(KEY_F) Or MouseDown(MOUSE_LEFT)) And reload <= 0 And (state = GAME_WAVE Or state = GAME_REST) And Not skipFire Then Shoot

  ; The game goes on.
  If state = GAME_WAVE
    spawnTimer = spawnTimer - dt
    If toSpawn > 0 And alive < MAX_ALIVE And spawnTimer <= 0
      SpawnZombie
      toSpawn = toSpawn - 1
      spawnTimer = Max(0.5, 1.6 - 0.1 * wave)
    EndIf
    If toSpawn = 0 And alive = 0
      state = GAME_REST
      stateTimer = 5
      health = Min(100, health + 25)
      notice = "WAVE " + wave + " CLEARED"
      headline = 3
    EndIf
  ElseIf state = GAME_REST
    stateTimer = stateTimer - dt
    If stateTimer <= 0 Then NextWave
  EndIf
  If headline > 0 Then headline = headline - dt
  If hurtFlash > 0 Then hurtFlash = hurtFlash - dt

  UpdateZombies dt
  UpdateProps dt
  UpdateEffects dt
End Function

Function Draw()
  w = GraphicsWidth()
  h = GraphicsHeight()
  cx = w / 2
  cy = h / 2

  ; The sights: black round the view and a thin cross.
  If scope > 0.05
    t = scope * h * 0.2
    Color 0, 0, 0
    Rect 0, 0, w, t
    Rect 0, h - t, w, t
    Rect 0, 0, t * 1.4, h
    Rect w - t * 1.4, 0, t * 1.4, h
    Color 20, 20, 20
    Line cx - 60, cy, cx - 6, cy
    Line cx + 6, cy, cx + 60, cy
    Line cx, cy - 60, cx, cy - 6
    Line cx, cy + 6, cx, cy + 60
  Else
    Color 255, 255, 255
    Line cx - 9, cy, cx - 3, cy
    Line cx + 3, cy, cx + 9, cy
    Line cx, cy - 9, cx, cy - 3
    Line cx, cy + 3, cx, cy + 9
  EndIf

  ; Hurt: red closes in from the edges.
  If hurtFlash > 0
    t = hurtFlash * 90
    Color 190, 10, 10
    Rect 0, 0, w, t
    Rect 0, h - t, w, t
    Rect 0, 0, t, h
    Rect w - t, 0, t, h
  EndIf

  ; Health, wave and score.
  Color 20, 10, 10
  Rect 20, h - 44, 224, 24
  If health > 30 Then Color 60, 190, 70 Else Color 220, 50, 40
  Rect 24, h - 40, 216 * health / 100, 16
  Color 255, 255, 255
  FontSize 15
  Text 20, h - 70, "Health"
  FontSize 18
  Text w - 20 - TextWidth("Score " + score), 16, "Score " + score
  Text w - 20 - TextWidth("Best " + best), 40, "Best " + best
  If state = GAME_WAVE Or state = GAME_REST
    Text 20, 16, "Wave " + wave + "   Zombies " + (alive + toSpawn)
    Text 20, 40, "Headshots " + headshots
  EndIf

  If Not PointerLocked() And (state = GAME_WAVE Or state = GAME_REST)
    FontSize 16
    Color 255, 255, 255
    Text cx, h - 24, "Click to take the mouse (arrows turn the view, F or click shoots)", True, True
  EndIf

  If headline > 0 And state <> GAME_INTRO
    FontSize 46
    Color 255, 220, 120
    Text cx, h * 0.22, notice, True, True
  EndIf

  If state = GAME_INTRO
    Color 0, 0, 0
    Rect cx - 330, cy - 130, 660, 250
    Color 255, 255, 255
    FontSize 54
    Text cx, cy - 80, "DEAD FIELD", True, True
    FontSize 20
    Text cx, cy - 20, "Click to take the mouse and start", True, True
    FontSize 16
    Text cx, cy + 20, "WASD walk   Shift run   Space jump   click or F shoot", True, True
    Text cx, cy + 46, "Z or right button: look down the sights   shoot the barrels", True, True
    Text cx, cy + 90, "Models: Mixamo zombie, plasma gun by Ilia_Tun and bonfire by LEX_GFX (CC BY 4.0)", True, True
  ElseIf state = GAME_OVER
    FontSize 56
    Color 220, 40, 30
    Text cx, cy - 40, "YOU DIED", True, True
    FontSize 22
    Color 255, 255, 255
    Text cx, cy + 20, "Wave " + wave + "   Score " + score + "   Headshots " + headshots, True, True
    If stateTimer < 0 Then Text cx, cy + 56, "Press R to try again", True, True
  EndIf
End Function
