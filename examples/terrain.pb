; Terrain - hills from a heightmap, that you can dig and raise.
;
; Drag with the right button to look, WASD fly, Q/E down and
; up. Hold the left button to raise the ground under the pointer, Shift and
; the left button (or the middle button) to dig. L turns shading on and off.
;
; The heightmap and the texture are Blitz3D's (samples/mak/driver, zlib
; licence). A terrain is a grid of heights from 0 to 1; ScaleEntity gives it
; its size.

Graphics3D 800, 600

Const CELL# = 2.0           ; world units a grid cell is across
Const TALL# = 60.0          ; height of a height of 1
Const BRUSH = 4             ; cells round the pointer the brush reaches

Global camera, land, yaw#, pitch#, shading

camera = CreateCamera()
CameraClsColor camera, 150, 190, 235
CameraRange camera, 0.5, 1200

sun = CreateLight()
RotateEntity sun, 40, -30, 0
AmbientLight 80, 85, 100

land = LoadTerrain("assets/blitz3d/driver/heightmap_256.bmp")
ScaleEntity land, CELL, TALL, CELL
PositionEntity land, -TerrainSize(land) * CELL / 2, 0, -TerrainSize(land) * CELL / 2
ground = LoadTexture("assets/blitz3d/driver/terrain-1.jpg")
ScaleTexture ground, 32, 32
EntityTexture land, ground
EntityPickMode land, PICK_POLYGON
shading = True
TerrainShading land, shading

PositionEntity camera, 0, 160, -330
yaw = 0
pitch = 28

Function Update()
  If KeyHit(KEY_L)
    shading = Not shading
    TerrainShading land, shading
  EndIf

  If MouseDown(MOUSE_RIGHT)
    yaw = yaw - MouseXSpeed() * 0.25
    pitch = Max(-89, Min(89, pitch + MouseYSpeed() * 0.25))
  EndIf
  RotateEntity camera, pitch, yaw, 0
  s# = 60 * DeltaTime()
  If KeyDown(KEY_W) Or KeyDown(KEY_UP) Then MoveEntity camera, 0, 0, s
  If KeyDown(KEY_S) Or KeyDown(KEY_DOWN) Then MoveEntity camera, 0, 0, -s
  If KeyDown(KEY_A) Or KeyDown(KEY_LEFT) Then MoveEntity camera, -s, 0, 0
  If KeyDown(KEY_D) Or KeyDown(KEY_RIGHT) Then MoveEntity camera, s, 0, 0
  If KeyDown(KEY_Q) Then TranslateEntity camera, 0, -s, 0, True
  If KeyDown(KEY_E) Then TranslateEntity camera, 0, s, 0, True
  ; Never under the ground.
  lowest# = TerrainY(land, EntityX(camera), 0, EntityZ(camera)) + 3
  If EntityY(camera) < lowest Then PositionEntity camera, EntityX(camera), lowest, EntityZ(camera)

  digging = MouseDown(MOUSE_MIDDLE) Or (MouseDown(MOUSE_LEFT) And KeyDown(KEY_SHIFT))
  raising = MouseDown(MOUSE_LEFT) And Not KeyDown(KEY_SHIFT)
  If raising Or digging
    If CameraPick(camera, MouseX(), MouseY()) = land
      ; From the world to the grid: undo the terrain's position and scale.
      gx = Int((PickedX() - EntityX(land)) / CELL)
      gz = Int((PickedZ() - EntityZ(land)) / CELL)
      change# = 0.4 * DeltaTime()
      If digging Then change = -change
      For z = gz - BRUSH To gz + BRUSH
        For x = gx - BRUSH To gx + BRUSH
          d# = Sqr((x - gx) * (x - gx) + (z - gz) * (z - gz)) / BRUSH
          If d < 1 Then ModifyTerrain land, x, z, TerrainHeight(land, x, z) + change * (1 - d * d), True
        Next
      Next
    EndIf
  EndIf
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "Terrain"
  FontSize 15
  If shading Then light$ = "on" Else light$ = "off"
  Text 16, 46, TerrainSize(land) + " x " + TerrainSize(land) + " heights   shading " + light + "   ground under you " + Int(TerrainY(land, EntityX(camera), 0, EntityZ(camera)))
  Text 16, 66, "Left button raise   Shift + left or middle dig   L shading"
  Text 16, 86, "Right drag look   WASD fly   Q/E down/up"
End Function
