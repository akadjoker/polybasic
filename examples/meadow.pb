; Meadow - a walk through tall grass at dusk.
;
; Arrows or WASD walk. Click or tap the ground to leave a flower there.
;
; Nothing here comes from an image: the hills are a mesh built from a
; height function, the trees are grown by CreateTree, the grass is painted
; onto the hills and parts as you walk through it, the sun casts shadows,
; and the fireflies are glowing sprites with ribbon trails behind them.
; The character is a glTF model by Kenney (CC0), in assets/kenney.

Graphics3D 800, 600

Const TYPE_PLAYER = 1
Const TYPE_GROUND = 2
Const TYPE_TREE = 3
Const GRAVITY# = 20.0
Const SPEED# = 3.2
Const SIZE# = 64.0          ; the hills are SIZE units across
Const CELLS = 48            ; and CELLS squares of mesh along each side
Const REACH# = 28.0         ; how far from the middle one may walk
Const FLIES = 8
Const MAX_FLOWERS = 40
Const KENNEY$ = "assets/kenney/"

Type Fly
  Field body, trail
  Field x#, z#              ; the middle of its loop
  Field radius#, speed#, phase#
End Type

Type Flower
  Field decal
End Type

Global camera, player, guy, ground, fallSpeed#, onGround, pose$
Global flowerTexture, flowers

SeedRnd 7

camera = CreateCamera()
CameraClsColor camera, 238, 170, 128
CameraRange camera, 0.1, 150

; A low, warm sun: long shadows across the grass.
sun = CreateLight()
LightColor sun, 255, 214, 170
RotateEntity sun, 28, -35, 0
LightShadows sun, True, 36
AmbientLight 96, 90, 118

Collisions TYPE_PLAYER, TYPE_GROUND, COLLIDE_POLYGON, RESPONSE_SLIDE_NO_DOWNHILL
Collisions TYPE_PLAYER, TYPE_TREE, COLLIDE_SPHERE, RESPONSE_SLIDE

; --- The hills ----------------------------------------------------------------

; The height of the ground at x, z: two waves across each other.
Function Height#(x#, z#)
  Return 1.2 * Sin(x * 14) * Cos(z * 11.5) + 0.6 * Sin((x + z) * 7.5)
End Function

; A grid of vertices lifted to the height function, two triangles to a
; square, each corner coloured a little differently.
ground = CreateMesh()
s = CreateSurface(ground)
cell# = SIZE / CELLS
For j = 0 To CELLS
  For i = 0 To CELLS
    x# = -SIZE / 2 + i * cell
    z# = -SIZE / 2 + j * cell
    y# = Height(x, z)
    v = AddVertex(s, x, y, z, i / 4.0, j / 4.0)
    ; Greener in the hollows, drier on the tops.
    dry# = (y + 1.8) / 3.6
    VertexColor s, v, 70 + 60 * dry + Rnd(-8, 8), 118 + 30 * dry + Rnd(-8, 8), 52 + Rnd(-6, 6)
  Next
Next
For j = 0 To CELLS - 1
  For i = 0 To CELLS - 1
    v = j * (CELLS + 1) + i
    AddTriangle s, v, v + CELLS + 1, v + CELLS + 2
    AddTriangle s, v, v + CELLS + 2, v + 1
  Next
Next
UpdateNormals ground
EntityFX ground, FX_VERTEXCOLOR
EntityType ground, TYPE_GROUND
EntityPickMode ground, PICK_POLYGON

; --- Trees ----------------------------------------------------------------------

; x, z, kind of each tree. One tree of each kind is grown, and the others
; are copies of it, turned and scaled a little so they do not look alike.
Data -9, 8, TREE_OAK
Data 11, 13, TREE_BEECH
Data -16, -6, TREE_OAK
Data 15, -10, TREE_ASH
Data -3, 19, TREE_BEECH
Data 5, -18, TREE_OAK
Data -20, 14, TREE_ASH
Data 4, 6, TREE_SHRUB
Data -6, -12, TREE_SHRUB
Data 18, 2, TREE_SHRUB
Data -13, 1, TREE_SHRUB
Data 0, 0, 0

Dim grown(7)
Repeat
  Read x#, z#, kind
  If kind = 0 Then Exit
  If grown(kind) = 0
    grown(kind) = CreateTree(kind, 3)
    tree = grown(kind)
  Else
    tree = CopyEntity(grown(kind))
  EndIf
  PositionEntity tree, x, Height(x, z) - 0.1, z
  TurnEntity tree, 0, Rnd(360), 0
  grow# = Rnd(0.85, 1.15)
  ScaleEntity tree, grow, grow, grow
  ; The trunk stops the walker: a sphere around it at waist height.
  If kind <> TREE_SHRUB
    trunk = CreatePivot()
    PositionEntity trunk, x, Height(x, z) + 0.6, z
    EntityRadius trunk, 0.5
    EntityType trunk, TYPE_TREE
  EndIf
Forever

; --- Grass --------------------------------------------------------------------

; Tufts spread over the hills, standing on the mesh; the walker parts them.
meadow = CreateGrass()
PaintGrass meadow, 0, 0, REACH + 2, 5000, ground
GrassSize meadow, 0.7
EntityColor meadow, 235, 225, 190
GrassWind meadow, 0.8

; --- Fireflies ----------------------------------------------------------------

; A soft round glow, painted pixel by pixel.
glow = CreateTexture(32, 32, 0, 0, 0)
For y = 0 To 31
  For x = 0 To 31
    d# = Sqr((x - 15.5) * (x - 15.5) + (y - 15.5) * (y - 15.5)) / 15.5
    If d < 1
      k# = (1 - d) * (1 - d)
      TexturePixel glow, x, y, 255 * k, 235 * k, 140 * k
    EndIf
  Next
Next

For n = 1 To FLIES
  f.Fly = New Fly
  f\x = Rnd(-18, 18)
  f\z = Rnd(-18, 18)
  f\radius = Rnd(1.5, 4)
  f\speed = Rnd(35, 70)
  f\phase = Rnd(360)
  f\body = CreateSprite()
  EntityTexture f\body, glow
  EntityBlend f\body, 3
  ScaleSprite f\body, 0.25, 0.25
  ; The trail is the ribbon between two points just above and below it.
  top = CreatePivot(f\body)
  PositionEntity top, 0, 0.04, 0
  bottom = CreatePivot(f\body)
  PositionEntity bottom, 0, -0.04, 0
  f\trail = CreateTrail(top, bottom)
  TrailColor f\trail, 255, 220, 110
  TrailLife f\trail, 0.9
Next

; --- Flowers ----------------------------------------------------------------

; Five round petals and a yellow heart, on nothing (alpha 0 around them).
; The petals are white, so each flower can be tinted with EntityColor.
flowerTexture = CreateTexture(64, 64, 0, 0, 0, TEX_ALPHA)
For y = 0 To 63
  For x = 0 To 63
    dx# = x - 31.5
    dy# = y - 31.5
    r# = Sqr(dx * dx + dy * dy)
    If r < 6
      TexturePixel flowerTexture, x, y, 250, 210, 60
    Else
      ; Petals: bumps of the radius around the heart.
      a# = ATan2(dy, dx)
      edge# = 12 + 18 * Abs(Cos(a * 2.5))
      If r < edge
        shade# = 1 - 0.3 * r / edge
        TexturePixel flowerTexture, x, y, 255 * shade, 255 * shade, 255 * shade
      Else
        TexturePixel flowerTexture, x, y, 0, 0, 0, 0
      EndIf
    EndIf
  Next
Next

; --- The walker ----------------------------------------------------------------

; An invisible ellipsoid collides; the model hangs below it.
player = CreatePivot()
EntityRadius player, 0.32, 0.55
EntityType player, TYPE_PLAYER
guy = LoadMesh(KENNEY + "character.glb", player)
PositionEntity guy, 0, -0.55, 0
PositionEntity player, 0, Height(0, -4) + 1, -4
GrassPush meadow, player, 1.1

; --- Every step ---------------------------------------------------------------

Function Update()
  ; Standing on the ground? The last step's collisions say so.
  onGround = 0
  For i = 1 To CountCollisions(player)
    If CollisionNY(player, i) > 0.6 Then onGround = 1
  Next
  If onGround And fallSpeed < 0 Then fallSpeed = 0

  dx# = 0
  dz# = 0
  If KeyDown(KEY_LEFT) Or KeyDown(KEY_A) Then dx = dx - 1
  If KeyDown(KEY_RIGHT) Or KeyDown(KEY_D) Then dx = dx + 1
  If KeyDown(KEY_UP) Or KeyDown(KEY_W) Then dz = dz + 1
  If KeyDown(KEY_DOWN) Or KeyDown(KEY_S) Then dz = dz - 1
  moving = dx <> 0 Or dz <> 0
  If moving
    length# = Sqr(dx * dx + dz * dz)
    dx = dx / length * SPEED
    dz = dz / length * SPEED
    RotateEntity guy, 0, ATan2(-dx, dz), 0
    Play("walk")
  Else
    Play("idle")
  EndIf
  ; The edge of the meadow holds the walker in.
  px# = EntityX(player) + dx * DeltaTime()
  pz# = EntityZ(player) + dz * DeltaTime()
  If px * px + pz * pz > REACH * REACH
    dx = 0
    dz = 0
  EndIf
  fallSpeed = fallSpeed - GRAVITY * DeltaTime()
  TranslateEntity player, dx * DeltaTime(), fallSpeed * DeltaTime(), dz * DeltaTime()

  ; Fireflies wander in loops, bobbing over the grass.
  For f.Fly = Each Fly
    f\phase = f\phase + f\speed * DeltaTime()
    x# = f\x + Cos(f\phase) * f\radius
    z# = f\z + Sin(f\phase * 0.7) * f\radius
    PositionEntity f\body, x, Height(x, z) + 1.1 + 0.4 * Sin(f\phase * 2.3), z
  Next

  If MouseHit()
    If CameraPick(camera, MouseX(), MouseY()) = ground Then Plant()
  EndIf

  ; The camera follows from behind and above.
  PositionEntity camera, EntityX(player), EntityY(player) + 3, EntityZ(player) - 6.5
  PointEntity camera, player
End Function

; A flower pressed onto the ground where the pointer picked it; the oldest
; goes when there are too many.
Function Plant()
  f.Flower = New Flower
  f\decal = CreateDecal(flowerTexture, PickedX(), PickedY(), PickedZ(), PickedNX(), PickedNY(), PickedNZ(), 0.8, Rnd(360), ground)
  Select Rand(1, 4)
    Case 1
      EntityColor f\decal, 255, 255, 255
    Case 2
      EntityColor f\decal, 255, 150, 190
    Case 3
      EntityColor f\decal, 190, 160, 255
    Default
      EntityColor f\decal, 255, 220, 90
  End Select
  flowers = flowers + 1
  If flowers > MAX_FLOWERS
    old.Flower = First Flower
    FreeEntity old\decal
    Delete old
    flowers = flowers - 1
  EndIf
End Function

; Starts an animation unless it is already the one playing.
Function Play(name$)
  If pose = name Then Return
  pose = name
  Animate guy, FindAnimation(guy, name), ANIM_LOOP
End Function

; --- The 2D layer -------------------------------------------------------------

Function Draw()
  Color 255, 245, 230
  FontSize 22
  Text 16, 14, "Meadow"
  FontSize 15
  Text 16, 44, "Flowers " + flowers
  Text 16, GraphicsHeight() - 28, "Arrows or WASD walk   Click the ground to plant a flower"
End Function
