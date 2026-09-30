; Parents, children, local and global coordinates.
sun = CreatePivot()
planet = CreateSphere(8, sun)
PositionEntity planet, 10, 0, 0
moon = CreateSphere(6, planet)
PositionEntity moon, 2, 0, 0
ScaleEntity planet, 2, 2, 2

Print "children of sun: " + CountChildren(sun) + ", first is planet: " + (GetChild(sun, 1) = planet)
Print "moon local " + EntityX(moon) + " global " + EntityX(moon, True)

TurnEntity sun, 0, 90, 0
Print "after the sun turned: planet " + EntityX(planet, True) + "," + EntityZ(planet, True) + "  moon " + EntityX(moon, True) + "," + EntityZ(moon, True)
Print "moon yaw local " + EntityYaw(moon) + " global " + EntityYaw(moon, True)

; Global position of a child, set directly
PositionEntity moon, 0, 5, 0, True
Print "moon placed at world y=5: local " + EntityX(moon) + "," + EntityY(moon) + "," + EntityZ(moon) + " world y " + EntityY(moon, True)

; Re-parent keeping the world position (the default)
EntityParent moon, 0
Print "moon freed from planet: parent " + GetParent(moon) + " world y " + EntityY(moon, True)
EntityParent moon, planet, False
Print "moon back with local values kept: world " + EntityX(moon, True) + "," + EntityY(moon, True) + "," + EntityZ(moon, True)

; Translate: local (parent axes) versus global
box = CreateCube(sun)
TranslateEntity box, 0, 0, 1
Print "box after local translate " + EntityX(box, True) + "," + EntityZ(box, True)
TranslateEntity box, 0, 0, 1, True
Print "box after global translate " + EntityX(box, True) + "," + EntityZ(box, True)

; Rotate global versus local
RotateEntity box, 0, 30, 0, True
Print "box yaw world " + EntityYaw(box, True) + " local " + EntityYaw(box)

; Copies are independent
copy = CopyEntity(planet)
PositionEntity copy, 0, 0, 0
Print "copy has " + CountChildren(copy) + " child, planet still at " + EntityX(planet, True) + "," + EntityZ(planet, True)
NameEntity copy, "twin"
Print "name: " + EntityName(copy) + " hidden: " + EntityHidden(copy)
HideEntity copy
Print "hidden now: " + EntityHidden(copy)

; Freeing removes the children too
child = GetChild(copy, 1)
FreeEntity copy
Print "exists: copy " + EntityExists(copy) + " child " + EntityExists(child) + " planet " + EntityExists(planet)
