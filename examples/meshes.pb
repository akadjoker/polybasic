; Building meshes - a flag waving in the wind and a gem, made vertex by
; vertex.
;
; Left/Right turn the view. Up/Down change the wind. F flat or smooth gem.
;
; The flag is a grid of vertices: every step the program moves them with
; VertexCoords and UpdateNormals works out the light again. The gem is
; built from triangles with a colour at each corner (FX_VERTEXCOLOR).

Graphics3D 800, 600

Const ACROSS = 24           ; flag vertices along
Const DOWN = 14             ; and down
Const FLAG_W# = 3.2
Const FLAG_H# = 2.0

Global turn, flag, cloth, gem, wind#, clock#, flat

turn = CreatePivot()
camera = CreateCamera(turn)
CameraClsColor camera, 140, 180, 225
PositionEntity camera, 0, 2.6, -8
RotateEntity camera, 6, 0, 0

light = CreateLight()
RotateEntity light, 35, -40, 0
AmbientLight 90, 95, 110

ground = CreatePlane(4)
ScaleEntity ground, 20, 1, 20
EntityColor ground, 110, 150, 90

pole = CreateCylinder(12)
ScaleEntity pole, 0.06, 2.4, 0.06
PositionEntity pole, -2.5, 2.4, 0
EntityColor pole, 200, 200, 210

; --- The flag ----------------------------------------------------------------

; Its picture: three stripes and a star, painted into a texture.
picture = CreateTexture(64, 40, 255, 255, 255)
For y = 0 To 39
  For x = 0 To 63
    If y < 13
      TexturePixel picture, x, y, 30, 90, 180
    ElseIf y >= 27
      TexturePixel picture, x, y, 200, 40, 50
    EndIf
    ; A diamond in the middle.
    If Abs(x - 20) + Abs(y - 19.5) < 9 Then TexturePixel picture, x, y, 250, 200, 40
  Next
Next

flag = CreateMesh()
cloth = CreateSurface(flag)
For j = 0 To DOWN - 1
  For i = 0 To ACROSS - 1
    u# = i / Float(ACROSS - 1)
    v# = j / Float(DOWN - 1)
    AddVertex cloth, u * FLAG_W, -v * FLAG_H, 0, u, v
  Next
Next
For j = 0 To DOWN - 2
  For i = 0 To ACROSS - 2
    a = j * ACROSS + i
    AddTriangle cloth, a, a + 1, a + ACROSS + 1
    AddTriangle cloth, a, a + ACROSS + 1, a + ACROSS
  Next
Next
EntityTexture flag, picture
EntityFX flag, FX_TWOSIDED
PositionEntity flag, -2.45, 4.7, 0

; --- The gem -------------------------------------------------------------------

; A ring of points around the middle, a tip above and below: every face is
; a triangle, every corner has its own colour.
gem = CreateMesh()
g = CreateSurface(gem)
Const SIDES = 8
For k = 0 To SIDES - 1
  a0# = k * 360.0 / SIDES
  a1# = (k + 1) * 360.0 / SIDES
  ; Top face: tip, then two points of the ring (clockwise seen from outside).
  t = AddVertex(g, 0, 1.2, 0)
  p0 = AddVertex(g, Cos(a0), 0, Sin(a0))
  p1 = AddVertex(g, Cos(a1), 0, Sin(a1))
  AddTriangle g, t, p1, p0
  VertexColor g, t, 255, 255, 255
  VertexColor g, p0, 120 + 130 * (k Mod 2), 60, 220
  VertexColor g, p1, 40, 200 - 100 * (k Mod 2), 230
  ; Bottom face.
  b = AddVertex(g, 0, -0.8, 0)
  q0 = AddVertex(g, Cos(a0), 0, Sin(a0))
  q1 = AddVertex(g, Cos(a1), 0, Sin(a1))
  AddTriangle g, b, q0, q1
  VertexColor g, b, 30, 20, 80
  VertexColor g, q0, 120 + 130 * (k Mod 2), 60, 220
  VertexColor g, q1, 40, 200 - 100 * (k Mod 2), 230
Next
UpdateNormals gem
EntityFX gem, FX_VERTEXCOLOR
EntityShininess gem, 0.8
PositionEntity gem, 2.2, 1.6, 0

wind = 1

Function Update()
  If KeyDown(KEY_LEFT) Then TurnEntity turn, 0, 1.2, 0
  If KeyDown(KEY_RIGHT) Then TurnEntity turn, 0, -1.2, 0
  If KeyDown(KEY_UP) Then wind = Min(3, wind + DeltaTime())
  If KeyDown(KEY_DOWN) Then wind = Max(0, wind - DeltaTime())
  If KeyHit(KEY_F)
    flat = Not flat
    If flat
      EntityFX gem, FX_VERTEXCOLOR + FX_FLAT
    Else
      EntityFX gem, FX_VERTEXCOLOR
    EndIf
  EndIf
  clock = clock + DeltaTime()

  ; Waves run along the flag, stronger away from the pole (the pole side
  ; stays put), and it droops a little when the wind is low.
  For j = 0 To DOWN - 1
    For i = 0 To ACROSS - 1
      u# = i / Float(ACROSS - 1)
      v# = j / Float(DOWN - 1)
      phase# = clock * (200 + 120 * wind) - u * 400 - v * 60
      z# = u * (0.12 + 0.18 * wind) * Sin(phase)
      droop# = u * u * 0.5 / (1 + wind * 2)
      VertexCoords cloth, j * ACROSS + i, u * FLAG_W * (1 - 0.05 * wind * Abs(Sin(phase))), -v * FLAG_H - droop, z
    Next
  Next
  UpdateNormals flag

  TurnEntity gem, 0, 0.8, 0
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "Building meshes"
  FontSize 15
  Text 16, 46, "Flag: " + (ACROSS * DOWN) + " vertices moved every step, wind " + Int(wind * 100) + "%"
  If flat
    Text 16, 66, "Gem: " + CountTriangles(GetSurface(gem, 1)) + " triangles, vertex colours, flat"
  Else
    Text 16, 66, "Gem: " + CountTriangles(GetSurface(gem, 1)) + " triangles, vertex colours, smooth"
  EndIf
  Text 16, GraphicsHeight() - 28, "Left/Right turn the view   Up/Down wind   F flat or smooth"
End Function
