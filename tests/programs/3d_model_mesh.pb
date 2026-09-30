; ScaleMesh, RotateMesh, PositionMesh, FitMesh and FlipMesh on a loaded
; model change all its parts, in the model's own space, as Blitz3D's do on
; a loaded mesh. Given while the model loads, they wait for it.
Const KENNEY$ = "../../examples/assets/kenney/"
Global a, b, c

a = LoadMesh(KENNEY + "character.glb")
ScaleMesh a, 2, 2, 2
b = LoadMesh(KENNEY + "character.glb")
TurnEntity b, 0, 30, 0
ScaleEntity b, 3, 3, 3
FitMesh b, -1, 0, -1, 2, 4, 2
c = LoadMesh(KENNEY + "character.glb")
RotateMesh c, 0, 90, 0
PositionMesh c, 10, 0, 0

Function Update()
  If FrameCount() = 1
    Print "twice as big: " + MeshWidth(a) + " x " + MeshHeight(a) + " x " + MeshDepth(a)
    Print "fitted to 2 x 4 x 2 (the entity's own turn and scale not counted): " + MeshWidth(b) + " x " + MeshHeight(b) + " x " + MeshDepth(b)
    Print "turned a quarter: " + MeshWidth(c) + " x " + MeshDepth(c)
    FitMesh b, 0, 0, 0, 1, 1, 1, True
    Print "fitted keeping its shape: " + MeshWidth(b) + " x " + MeshHeight(b) + " x " + MeshDepth(b)
    Print "the model's own place is untouched: " + EntityX(a) + " " + EntityYaw(b)
    FlipMesh a
    Print "flipped: still " + MeshWidth(a) + " wide"
    End
  EndIf
End Function
