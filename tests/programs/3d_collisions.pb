; Collisions after every Update: sweeps, stop and slide responses.
Const TYPE_BALL = 1, TYPE_SCENERY = 2, TYPE_MARKER = 3, TYPE_BOXES = 4

Global floor, wall, ramp, ball, slider, bullet, walker, sticker, a, b, crate, hopper
Collisions TYPE_BALL, TYPE_SCENERY, COLLIDE_POLYGON, RESPONSE_STOP
Collisions TYPE_MARKER, TYPE_MARKER, COLLIDE_SPHERE, RESPONSE_STOP
Collisions TYPE_MARKER, TYPE_BOXES, COLLIDE_BOX, RESPONSE_SLIDE

; A floor at y = 0 (a plane 40 wide), a thin wall at x = 5 (a plane stood
; up) and a ramp tilted 30 degrees.
floor = CreatePlane()
ScaleEntity floor, 20, 1, 20
EntityType floor, TYPE_SCENERY
wall = CreatePlane()
PositionEntity wall, 5, 0, 0
RotateEntity wall, 0, 0, 90
ScaleEntity wall, 20, 1, 20
EntityType wall, TYPE_SCENERY
ramp = CreatePlane()
PositionEntity ramp, 0, 3, 30
RotateEntity ramp, 0, 0, 30
ScaleEntity ramp, 10, 1, 10
EntityType ramp, TYPE_SCENERY

; A ball dropped from y = 3: it stops half a unit above the floor.
ball = CreatePivot()
EntityRadius ball, 0.5
EntityType ball, TYPE_BALL
; Placed after EntityType, in the main body: a jump, not a sweep.
PositionEntity ball, -3, 3, 0

; A bullet 10 units a step at the thin wall: no tunnelling.
bullet = CreatePivot()
EntityRadius bullet, 0.25
EntityType bullet, TYPE_BALL
PositionEntity bullet, -3, 1, 5

; A slider going diagonally into the wall with RESPONSE_SLIDE.
slider = CreatePivot()
EntityRadius slider, 0.5
EntityType slider, 5
Collisions 5, TYPE_SCENERY, COLLIDE_POLYGON, RESPONSE_SLIDE
PositionEntity slider, 0, 2, -5

; Two things falling on the ramp: one slides down, one does not.
walker = CreatePivot()
EntityRadius walker, 0.5
EntityType walker, 5
PositionEntity walker, 0, 6, 28
sticker = CreatePivot()
EntityRadius sticker, 0.5
EntityType sticker, 6
Collisions 6, TYPE_SCENERY, COLLIDE_POLYGON, RESPONSE_SLIDE_NO_DOWNHILL
PositionEntity sticker, 0, 6, 32

; Sphere against sphere: radii 1 and 2 stop 3 apart.
a = CreatePivot()
EntityType a, TYPE_MARKER
PositionEntity a, -10, 0, -20
b = CreatePivot()
EntityRadius b, 2
EntityType b, TYPE_MARKER
PositionEntity b, 0, 0, -20

; A box turned 45 degrees: a marker moving along +X slides off its corner.
crate = CreateCube()
PositionEntity crate, 0, 0, -40
TurnEntity crate, 0, 45, 0
EntityType crate, TYPE_BOXES
hopper = CreatePivot()
EntityRadius hopper, 0.5
EntityType hopper, TYPE_MARKER
PositionEntity hopper, -5, 0, -40.2

Print "types: ball " + GetEntityType(ball) + " floor " + GetEntityType(floor)

; Collisions are worked out after each Update, so what an Update reads
; (positions, CountCollisions...) is the result of the moves the previous
; Update made. This one reports first, then moves.
Function Update()
  f = FrameCount()
  If f = 2
    Print "bullet after one step: x " + EntityX(bullet) + ", hit " + CountCollisions(bullet) + " thing: the wall " + (CollisionEntity(bullet, 1) = wall)
    Print "  contact x " + CollisionX(bullet, 1) + " normal " + CollisionNX(bullet, 1) + "," + CollisionNY(bullet, 1) + "," + CollisionNZ(bullet, 1)
  EndIf
  If f = 21
    Print "ball resting: y " + EntityY(ball) + ", collided with scenery: " + (EntityCollided(ball, TYPE_SCENERY) = floor) + ", normal y " + CollisionNY(ball, 1)
    Print "slider along the wall: x " + EntityX(slider) + " z " + EntityZ(slider)
    Print "a stopped by b: x " + EntityX(a) + " (distance " + EntityDistance(a, b) + "), b collided with nothing: " + CountCollisions(b)
  EndIf
  If f = 41
    Print "on the ramp: slide moved x by " + EntityX(walker) + ", no-downhill by " + EntityX(sticker)
    Print "hopper slid around the crate: x " + EntityX(hopper) + " z " + EntityZ(hopper)
  EndIf
  If f = 42 Then Print "ball below the floor after the jump: y " + EntityY(ball)
  If f = 43
    Print "after ClearCollisions the bullet passes the wall: x " + EntityX(bullet)
    Print CollisionX(ball, 1)
  EndIf

  TranslateEntity ball, 0, -0.2, 0
  If f < 41 Then TranslateEntity bullet, 10, 0, 0
  TranslateEntity slider, 0.4, 0, 0.4
  TranslateEntity walker, 0, -0.2, 0
  TranslateEntity sticker, 0, -0.2, 0
  If f <= 20 Then TranslateEntity a, 1, 0, 0
  TranslateEntity hopper, 0.25, 0, 0
  If f = 41
    ; Teleport the ball through the floor: ResetEntity makes it a jump.
    PositionEntity ball, -3, -5, 0
    ResetEntity ball
  EndIf
  If f = 42
    ; Without a rule the same move is free.
    ClearCollisions
    TranslateEntity bullet, 20, 0, 0
  EndIf
End Function
