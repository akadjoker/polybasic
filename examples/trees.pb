; Trees - the seven kinds CreateTree grows, side by side.
;
; Left/Right walk round them, Up/Down closer or further.
; Space grows every tree again from a new seed. W toggles the wind.
;
; Each tree is made from numbers: a trunk that forks into branches, with
; cards of leaves at the tips, all drawn by code. The same kind and seed
; always grow the same tree; another seed, another tree of that kind.

Graphics3D 800, 600

Const KINDS = 7

Global turn, camera, distance#, seed, clock#, windy
Dim tree(KINDS)
Dim label$(KINDS)
Dim size#(KINDS)

turn = CreatePivot()
camera = CreateCamera(turn)
CameraClsColor camera, 160, 200, 235
distance = 26

sun = CreateLight()
LightColor sun, 255, 245, 225
RotateEntity sun, 50, -35, 0
LightShadows sun, True, 50
AmbientLight 110, 115, 130

ground = CreatePlane(8)
ScaleEntity ground, 40, 1, 40
EntityColor ground, 120, 160, 85

; Name and the size to show it at (the sequoia is 38 units tall: shrunk).
Data "Oak", 1.0, "Willow", 1.0, "Shrub", 2.2, "Ash", 1.0
Data "Poplar", 0.8, "Sequoia", 0.3, "Beech", 0.85
For k = 1 To KINDS
  Read label(k), size(k)
Next

seed = 1
Grow()

; Grows all seven again from `seed`, in an arc facing the camera.
Function Grow()
  For k = 1 To KINDS
    If tree(k) Then FreeEntity tree(k)
    tree(k) = CreateTree(k, seed)
    a# = (k - 4) * 22
    PositionEntity tree(k), Sin(a) * 12, 0, Cos(a) * 12 - 8
    ScaleEntity tree(k), size(k), size(k), size(k)
  Next
End Function

Function Update()
  If KeyDown(KEY_LEFT) Then TurnEntity turn, 0, 1, 0
  If KeyDown(KEY_RIGHT) Then TurnEntity turn, 0, -1, 0
  If KeyDown(KEY_UP) Then distance = Max(10, distance - 0.3)
  If KeyDown(KEY_DOWN) Then distance = Min(45, distance + 0.3)
  If KeyHit(KEY_SPACE)
    seed = seed + 1
    Grow()
  EndIf
  If KeyHit(KEY_W) Then windy = Not windy
  PositionEntity camera, 0, 5 + distance * 0.15, -distance
  PointEntity camera, turn

  ; A gust: the trees lean a little, one after another.
  If windy
    clock = clock + DeltaTime()
    For k = 1 To KINDS
      RotateEntity tree(k), 0, 0, 2.5 * Sin(clock * 90 + k * 40)
    Next
  EndIf
End Function

Function Draw()
  ; Each tree's name at its foot.
  FontSize 15
  For k = 1 To KINDS
    If CameraProject(camera, EntityX(tree(k)), 0.2, EntityZ(tree(k)))
      Color 20, 40, 20
      Text ProjectedX() + 1, ProjectedY() + 13, label(k), True, True
      Color 255, 255, 255
      Text ProjectedX(), ProjectedY() + 12, label(k), True, True
    EndIf
  Next
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "Trees"
  FontSize 15
  If windy
    Text 16, 46, "Seed " + seed + ", windy"
  Else
    Text 16, 46, "Seed " + seed
  EndIf
  Text 16, GraphicsHeight() - 28, "Left/Right walk round   Up/Down closer   Space new seed   W wind"
End Function
