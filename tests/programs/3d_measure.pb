; MeshWidth / MeshHeight / MeshDepth: a mesh's box, and a loaded model's
; box around all its parts (in the model's own space, 0 while loading).
Const KENNEY$ = "../../examples/assets/kenney/"
Global guy, cube, sprite

guy = LoadMesh(Asset("character.glb"))
PositionEntity guy, 5, 2, 0
TurnEntity guy, 0, 90, 0
ScaleEntity guy, 2, 2, 2
cube = CreateCube()
ScaleEntity cube, 3, 1, 1
Print "while loading: " + MeshWidth(guy) + " " + MeshHeight(guy) + " " + MeshDepth(guy)
Print "cube (its scale does not count): " + MeshWidth(cube) + " " + MeshHeight(cube) + " " + MeshDepth(cube)

Function Update()
  ; Where and how the model stands does not change its own box.
  Print "model: " + MeshWidth(guy) + " " + MeshHeight(guy) + " " + MeshDepth(guy)
  Print "a pivot is neither:"
  MeshWidth CreatePivot()
End Function

; A name made at run time, not in quotes: the model arrives after main.
Function Asset$(name$)
  Return KENNEY + name
End Function
