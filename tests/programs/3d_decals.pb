; Decals pressed onto surfaces.
floor = CreatePlane()
ScaleEntity floor, 10, 1, 10
EntityPickMode floor, PICK_POLYGON

; In the middle of the floor: a whole square, 2 wide.
d = CreateDecal(0, 0, 0, 0, 0, 1, 0, 2)
s = GetSurface(d, 1)
Print "middle: " + CountTriangles(s) + " triangles, " + MeshWidth(d) + " x " + MeshDepth(d) + ", lifted " + (MeshHeight(d) = 0) + " " + (VertexY(s, 0) > 0)

; At the edge (x = 10): only the half on the floor.
e = CreateDecal(0, 10, 0, 0, 0, 1, 0, 2)
Print "edge: " + MeshWidth(e) + " x " + MeshDepth(e)

; Where a ray hits, as a game would.
If LinePick(3, 5, 3, 0, -10, 0)
  p = CreateDecal(0, PickedX(), PickedY(), PickedZ(), PickedNX(), PickedNY(), PickedNZ(), 1, 45)
  Print "picked: " + CountTriangles(GetSurface(p, 1)) + " triangles, turned 45: " + (MeshWidth(p) > 1.4)
EndIf

; On the front of a cube, at its edge: the side (at a right angle) is left
; alone, so the decal is cut at the edge.
cube = CreateCube()
PositionEntity cube, 0, 1, 20
c = CreateDecal(0, 1, 1, 19, 0, 0, -1, 2, 0, cube)
Print "cube: " + MeshWidth(c) + " wide, a child of the cube: " + (GetParent(c) = cube)
MoveEntity cube, 5, 0, 0
Print "moves with it: " + EntityX(c, True)

; Nothing there: an empty decal, still an entity.
n = CreateDecal(0, 0, 50, 0, 0, 1, 0, 1)
Print "nothing: " + CountTriangles(GetSurface(n, 1))
CreateDecal 0, 0, 0, 0, 0, 0, 0, 1
