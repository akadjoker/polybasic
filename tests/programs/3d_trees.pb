; Trees made from numbers: the bark is the tree entity, the leaves a child.
oak = CreateTree(TREE_OAK)
twigs = FindChild(oak, "twigs")
Print "leaves found " + (twigs <> 0) + ", parent " + (GetParent(twigs) = oak)
Print "oak " + Int(MeshHeight(oak)) + " high, " + CountTriangles(GetSurface(oak, 1)) + " triangles, " + CountTriangles(GetSurface(twigs, 1)) / 4 + " pairs of leaf cards"
other = CreateTree(TREE_OAK, 7)
same = CreateTree(TREE_OAK, 7)
Print "another seed, another shape " + (MeshWidth(other) <> MeshWidth(oak)) + "; the same seed, the same shape " + (MeshWidth(other) = MeshWidth(same))
For kind = TREE_OAK To TREE_BEECH
  t = CreateTree(kind)
  Write " " + Int(MeshHeight(t))
Next
Print ""
CreateTree 8
