; Picking along rays and swept spheres, and projecting to the screen.
; The camera sits at the origin looking along +Z; the screen is 800 x 600.
cam = CreateCamera()

; Polygon picking: the front face of a cube at z = 5 is at z = 4.
cube = CreateCube()
PositionEntity cube, 0, 0, 5
Print "nothing pickable yet: " + CameraPick(cam, 400, 300)
EntityPickMode cube, PICK_POLYGON
Print "centre pick: " + (CameraPick(cam, 400, 300) = cube) + " at " + PickedX() + "," + PickedY() + "," + PickedZ()
Print "normal " + PickedNX() + "," + PickedNY() + "," + PickedNZ() + " distance " + PickedDistance() + " time " + PickedTime()
Print "a corner of the screen misses: " + CameraPick(cam, 5, 5) + ", picked entity now " + PickedEntity()

; Sphere picking uses EntityRadius around the entity's position.
ball = CreatePivot()
PositionEntity ball, 3, 0, 10
EntityPickMode ball, PICK_SPHERE
EntityRadius ball, 1.5
Print "line to the sphere: " + (LinePick(3, 0, 0, 0, 0, 20) = ball) + " at z " + PickedZ() + " normal z " + PickedNZ()

; Box picking uses the entity's box (here the cube's bounds), turned and
; scaled with it. A cube turned 45 degrees shows its edge at -sqrt(2).
box = CreateCube()
PositionEntity box, 0, 0, 20
TurnEntity box, 0, 45, 0
EntityPickMode box, PICK_BOX
Print "line across the turned box: " + (LinePick(-10, 0, 20, 20, 0, 0) = box) + " at x " + PickedX()
EntityBox box, -1, -1, -1, 2, 2, 4
Print "a longer box reaches further along its own z: " + (LinePick(-10, 0, 21.5, 20, 0, 0) = box)

; Polygon picking sees both sides: a floor seen from below.
floor = CreatePlane()
PositionEntity floor, 0, -2, 5
ScaleEntity floor, 10, 1, 10
EntityPickMode floor, PICK_POLYGON
Print "from below: " + (LinePick(0, -5, 5, 0, 10, 0) = floor) + " at y " + PickedY() + " normal y " + PickedNY()

; A line with a radius sweeps a ball: dropped beside the cube it stops
; 0.5 above the floor; dropped over the cube it lands on its top.
Print "ball dropped on the floor: " + (LinePick(5, 5, 5, 0, -10, 0, 0.5) = floor) + " touches y " + PickedY() + " time " + PickedTime()
Print "ball dropped on the cube: " + (LinePick(0, 5, 5, 0, -10, 0, 0.5) = cube) + " touches y " + PickedY() + " time " + PickedTime()

; EntityPick looks along the entity's forward axis.
eye = CreatePivot()
PositionEntity eye, 0, 0, -10
Print "eye looking at the cube: " + (EntityPick(eye, 100) = cube) + " at z " + PickedZ()
TurnEntity eye, 0, 90, 0
Print "eye turned away: " + EntityPick(eye, 100)

; EntityVisible: is the line between two entities clear of obscurers?
a = CreatePivot()
b = CreatePivot()
PositionEntity b, 0, 0, 10
Print "cube between a and b: visible " + EntityVisible(a, b)
EntityPickMode cube, PICK_POLYGON, False
Print "cube no longer an obscurer: visible " + EntityVisible(a, b) + ", still pickable " + (CameraPick(cam, 400, 300) = cube)

; Hidden entities are not picked, freed ones are forgotten.
HideEntity cube
Print "cube hidden: centre pick is the box " + (CameraPick(cam, 400, 300) = box)
ShowEntity cube
CameraPick cam, 400, 300
FreeEntity cube
Print "after freeing the picked cube: PickedEntity " + PickedEntity()

; CameraProject: a world point to screen pixels (field of view 60).
If CameraProject(cam, 0, 0, 5) Then Print "centre projects to " + ProjectedX() + "," + ProjectedY() + " depth " + ProjectedZ()
CameraProject cam, 1, 1, 5
Print "(1, 1, 5) projects to " + ProjectedX() + "," + ProjectedY()
Print "behind the camera: " + CameraProject(cam, 0, 0, -5) + " " + ProjectedX()
CameraViewport cam, 400, 0, 400, 300
CameraProject cam, 0, 0, 5
Print "with a viewport in the top-right quarter: " + ProjectedX() + "," + ProjectedY()

EntityPickMode box, 7
