; Using an entity after FreeEntity is a runtime error with the line.
cube = CreateCube()
tex = CreateTexture(4, 4)
FreeEntity cube
Print "freed"
Print EntityExists(cube)
TurnEntity cube, 0, 1, 0
