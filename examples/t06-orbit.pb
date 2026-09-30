; Tutorial 6 - An orbit camera: turn round a model and zoom.
;
; Drag with the mouse (or a finger) to turn round the model; the mouse
; wheel or Z/X zoom. N shows the next model, and the model's name and
; size are shown.
;
; The camera hangs from a pivot at the model's middle: turning the pivot
; (yaw and pitch) swings the camera round it, and moving the camera along
; the pivot's Z axis zooms. Any viewer of 3D models works like this.
; The models are by Kenney (CC0), in assets/kenney.

Graphics3D 800, 600

Const MODELS = 7

Global pivot, camera, model, index, yaw#, pitch#, distance#, fitted
Dim file$(MODELS)

pivot = CreatePivot()
camera = CreateCamera(pivot)
CameraClsColor camera, 60, 66, 80
CameraRange camera, 0.05, 100

light = CreateLight()
RotateEntity light, 45, -30, 0
; A second, dimmer light from the other side shows the back.
back = CreateLight()
RotateEntity back, 20, 150, 0
LightColor back, 90, 100, 130
AmbientLight 90, 90, 100

floor = CreatePlane(8)
ScaleEntity floor, 6, 1, 6
EntityColor floor, 90, 96, 110

Data "character", "coin", "flag", "platform", "brick", "block-coin", "cloud"
For i = 1 To MODELS
  Read file(i)
Next

yaw = 30
pitch = 20
distance = 4
index = 1
Show(index)

Function Show(i)
  If model Then FreeEntity model
  model = LoadMesh("assets/kenney/" + file(i) + ".glb")
  fitted = False
End Function

Function Update()
  ; Once a model has arrived, stand back far enough to see all of it.
  If MeshLoaded(model) And Not fitted
    size# = Max(MeshWidth(model), Max(MeshHeight(model), MeshDepth(model)))
    distance = size * 2.2 + 0.5
    fitted = True
  EndIf

  ; KeyHit counts the presses since the last step: two quick taps go two on.
  hits = KeyHit(KEY_N)
  If hits > 0
    index = (index - 1 + hits) Mod MODELS + 1
    Show(index)
  EndIf

  ; Drag to turn; the pitch stays between straight down and level-ish.
  If MouseDown(MOUSE_LEFT)
    yaw = yaw - MouseXSpeed() * 0.4
    pitch = Max(-10, Min(85, pitch + MouseYSpeed() * 0.4))
  EndIf
  ; Zoom: each wheel step 10% closer or further.
  distance = distance * (1 - MouseWheel() * 0.1)
  If KeyDown(KEY_Z) Then distance = distance * 0.98
  If KeyDown(KEY_X) Then distance = distance * 1.02
  distance = Max(0.5, Min(20, distance))

  ; The pivot sits at the model's middle (half its height up).
  PositionEntity pivot, 0, MeshHeight(model) / 2, 0
  RotateEntity pivot, pitch, yaw, 0
  PositionEntity camera, 0, 0, -distance
End Function

Function Draw()
  Color 230, 235, 245
  FontSize 22
  Text 16, 14, "6. Orbit camera"
  FontSize 15
  Text 16, 46, file(index) + ".glb   " + Left(Str(MeshWidth(model)), 4) + " x " + Left(Str(MeshHeight(model)), 4) + " x " + Left(Str(MeshDepth(model)), 4)
  Text 16, GraphicsHeight() - 28, "Drag to turn   Wheel or Z/X zoom   N next model"
End Function
