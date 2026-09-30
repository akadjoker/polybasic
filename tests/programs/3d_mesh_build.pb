; Building and changing meshes, as in Blitz3D.
m = CreateMesh()
s = CreateSurface(m)
v0 = AddVertex(s, -1, 1, 0, 0, 0)
v1 = AddVertex(s, 1, 1, 0, 1, 0)
v2 = AddVertex(s, 1, -1, 0, 1, 1)
v3 = AddVertex(s, -1, -1, 0, 0, 1)
t0 = AddTriangle(s, v0, v1, v2)
t1 = AddTriangle(s, v0, v2, v3)
Print "vertices " + CountVertices(s) + ", triangles " + CountTriangles(s) + ", indices " + v3 + " " + t1
Print "surfaces " + CountSurfaces(m) + ", first " + (GetSurface(m, 1) = s)
UpdateNormals m
Print "normal " + VertexNX(s, 0) + " " + VertexNY(s, 0) + " " + VertexNZ(s, 0)
Print "corner " + TriangleVertex(s, 1, 2) + ", uv " + VertexU(s, 2) + " " + VertexV(s, 2)
VertexColor s, 1, 255, 128, 0, 0.5
Print "colour " + VertexRed(s, 1) + " " + VertexGreen(s, 1) + " " + VertexBlue(s, 1) + " " + VertexAlpha(s, 1)
Print "size " + MeshWidth(m) + " x " + MeshHeight(m) + " x " + MeshDepth(m)

ScaleMesh m, 2, 3, 1
Print "scaled " + MeshWidth(m) + " x " + MeshHeight(m)
PositionMesh m, 10, 0, 0
Print "moved " + VertexX(s, 0) + " " + VertexY(s, 0)
FitMesh m, 0, 0, 0, 4, 4, 4, True
Print "fitted " + MeshWidth(m) + " x " + MeshHeight(m) + ", from " + VertexX(s, 3) + " " + VertexY(s, 3)
RotateMesh m, 0, 90, 0
Print "turned normal " + Int(VertexNX(s, 0)) + " " + Int(VertexNY(s, 0)) + " " + Int(VertexNZ(s, 0))
FlipMesh m
Print "flipped normal " + Int(VertexNX(s, 0)) + ", corners " + TriangleVertex(s, 0, 1) + " " + TriangleVertex(s, 0, 2)

c = CopyMesh(m)
AddMesh m, c
Print "copy surfaces " + CountSurfaces(c) + ", vertices " + CountVertices(GetSurface(c, 2))
ClearSurface s, False, True
Print "cleared triangles " + CountTriangles(s) + ", vertices " + CountVertices(s)

; A cube is changed on its own: the other cubes keep their shape.
a = CreateCube()
b = CreateCube()
ScaleMesh a, 3, 1, 1
Print "cubes " + MeshWidth(a) + " and " + MeshWidth(b) + ", cube surface vertices " + CountVertices(GetSurface(a, 1))

; Rays hit a built mesh.
wall = CreateMesh()
ws = CreateSurface(wall)
AddVertex ws, -5, 5, 20 : AddVertex ws, 5, 5, 20 : AddVertex ws, 5, -5, 20 : AddVertex ws, -5, -5, 20
AddTriangle ws, 0, 1, 2 : AddTriangle ws, 0, 2, 3
EntityPickMode wall, PICK_POLYGON
Print "picked " + (LinePick(0, 0, 0, 0, 0, 50) = wall) + " at z " + PickedZ()
Print "constants " + FX_VERTEXCOLOR + " " + FX_VERTEXALPHA
AddTriangle s, 0, 1, 9
