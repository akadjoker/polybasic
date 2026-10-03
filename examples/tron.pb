; Tron - one of the Blitz3D samples (zlib licence), ported.
;
; A light bike leaves a wall of red light behind it, drawn by growing a mesh
; as it goes: a pair of corners is added to the wall every few steps while
; the bike turns, and in between the last pair follows the bike. Over the
; blue grid, mirrored in the floor, a field of long cubes turns.
;
; Left and right steer, A and Z bring the camera nearer and further.
;
; The sample draws its grid texture in code and so does this; the original
; steps once per frame at 60 frames a second, as every Update does here.
; The original's W key (wireframe) is left out: there is no such command.

Graphics3D 800, 600

Global camera, bike, grid, floorMirror, trail, trailSurface
Global trailVert, addCount, camDistance#

; The grid: a dark blue square with a bright blue edge, 32 x 32.
gridTex = CreateTexture(32, 32, 0, 0, 64)
For i = 0 To 31
  TexturePixel gridTex, i, 0, 0, 0, 255
  TexturePixel gridTex, i, 31, 0, 0, 255
  TexturePixel gridTex, 0, i, 0, 0, 255
  TexturePixel gridTex, 31, i, 0, 0, 255
Next

; The floor is as big as the camera sees, and follows the bike a cell at a
; time, so it never ends: a cell is 10 units, the width of the texture.
Const FLOOR_SIZE = 1000
Const CELL = 10
grid = CreatePlane()
ScaleEntity grid, FLOOR_SIZE, 1, FLOOR_SIZE
ScaleTexture gridTex, Float(CELL) / FLOOR_SIZE, Float(CELL) / FLOOR_SIZE
EntityTexture grid, gridTex
EntityBlend grid, 1
EntityAlpha grid, 0.6
EntityFX grid, FX_FULLBRIGHT

floorMirror = CreateMirror()

; Nine by nine long cubes, all turning together once every 180 steps.
Dim cubes(80)
cube = CreateCube()
ScaleEntity cube, 1, 1, 5
n = 0
For x = -100 To 100 Step 25
  For z = -100 To 100 Step 25
    If n = 0 Then cubes(n) = cube Else cubes(n) = CopyEntity(cube)
    PositionEntity cubes(n), x, 5, z
    n = n + 1
  Next
Next

; The wall of light: two corners (top and bottom) at the start and two
; more that follow the bike, both sides of it drawn.
trail = CreateMesh()
trailSurface = CreateSurface(trail)
AddVertex trailSurface, 0, 2, 0, 0, 0
AddVertex trailSurface, 0, 0, 0, 0, 1
AddVertex trailSurface, 0, 2, 0, 0, 0
AddVertex trailSurface, 0, 0, 0, 0, 1
AddTriangle trailSurface, 0, 2, 3
AddTriangle trailSurface, 0, 3, 1
AddTriangle trailSurface, 0, 3, 2
AddTriangle trailSurface, 0, 1, 3
trailVert = 2
EntityColor trail, 255, 0, 0
EntityBlend trail, 3
EntityFX trail, FX_FULLBRIGHT + FX_TWOSIDED

bike = CreateSphere()
ScaleMesh bike, 0.75, 1, 2
PositionEntity bike, 0, 1, 0
EntityShininess bike, 1
EntityColor bike, 192, 0, 255

camera = CreateCamera()
TurnEntity camera, 45, 0, 0
camDistance = 30

light = CreateLight()
TurnEntity light, 45, 45, 0
AmbientLight 127, 127, 127          ; Blitz3D's own

Function Update()
  If KeyDown(KEY_A) Then camDistance = camDistance - 1
  If KeyDown(KEY_Z) Then camDistance = camDistance + 1

  ; Turning adds a pair of corners to the wall every third step, and one
  ; more when the turn ends, so the bends are closed.
  turn = 0
  If KeyDown(KEY_LEFT) Then turn = 5
  If KeyDown(KEY_RIGHT) Then turn = -5
  addFlag = False
  If turn <> 0
    addCount = addCount + 1
    If addCount = 3
      addCount = 0
      addFlag = True
    EndIf
  ElseIf addCount > 0
    addCount = 0
    addFlag = True
  EndIf

  If turn <> 0 Then TurnEntity bike, 0, turn, 0
  MoveEntity bike, 0, 0, 1

  bx# = EntityX(bike)
  bz# = EntityZ(bike)
  If addFlag
    AddVertex trailSurface, bx, 2, bz, 0, 0
    AddVertex trailSurface, bx, 0, bz, 0, 1
    AddTriangle trailSurface, trailVert, trailVert + 2, trailVert + 3
    AddTriangle trailSurface, trailVert, trailVert + 3, trailVert + 1
    AddTriangle trailSurface, trailVert, trailVert + 3, trailVert + 2
    AddTriangle trailSurface, trailVert, trailVert + 1, trailVert + 3
    trailVert = trailVert + 2
  Else
    VertexCoords trailSurface, trailVert, bx, 2, bz
    VertexCoords trailSurface, trailVert + 1, bx, 0, bz
  EndIf

  For i = 0 To 80
    TurnEntity cubes(i), 0, 2, 0
  Next

  PositionEntity grid, Floor(bx / CELL) * CELL, 0, Floor(bz / CELL) * CELL
  PositionEntity floorMirror, 0, 0, 0

  PositionEntity camera, bx - 5, 0, bz
  MoveEntity camera, 0, 0, -camDistance
End Function

Function Draw()
  Color 255, 255, 255
  FontSize 14
  Text 10, 10, "Tron demo"
  Text 10, 28, "Features dynamic mesh creation"
  Text 10, 46, "Use the arrow keys to steer, A and Z to zoom"
End Function
