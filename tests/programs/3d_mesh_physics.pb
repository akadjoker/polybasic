; A built mesh is solid: a ball comes to rest on it, and a character
; walking into it with collisions stays on top.
Global ball, walker
floor = CreateMesh()
s = CreateSurface(floor)
AddVertex s, -10, 0, 10 : AddVertex s, 10, 0, 10 : AddVertex s, 10, 0, -10 : AddVertex s, -10, 0, -10
AddTriangle s, 0, 1, 2 : AddTriangle s, 0, 2, 3
UpdateNormals floor
EntityBody floor, BODY_STATIC, SHAPE_MESH
EntityType floor, 2

ball = CreateSphere()
PositionEntity ball, 0, 5, 0
EntityBody ball

walker = CreatePivot()
EntityRadius walker, 0.5
EntityType walker, 1
PositionEntity walker, 3, 3, 0
Collisions 1, 2, COLLIDE_POLYGON, RESPONSE_SLIDE

Function Update()
  ; Read first: the collisions of a move are worked out after the Update.
  If FrameCount() = 240
    Print "ball rests at y " + Int(EntityY(ball) * 100) / 100.0
    Print "walker stands at y " + Int(EntityY(walker) * 100) / 100.0 + ", touching the floor " + EntityCollided(walker, 2)
    End
  EndIf
  TranslateEntity walker, 0, -0.1, 0
End Function
