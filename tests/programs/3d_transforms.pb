; Entity state after a number of Update frames, on the headless engine.
Global cube, ship, camera, ticks

camera = CreateCamera()
PositionEntity camera, 0, 2, -5
cube = CreateCube()
ship = CreatePivot()

Function Update()
  ticks = ticks + 1
  TurnEntity cube, 0, 1, 0           ; one degree per frame
  TurnEntity ship, 0, 1, 0
  MoveEntity ship, 0, 0, 0.1         ; forward along its own heading
  If ticks = 90 Then Report() : End
End Function

Function Report()
  Print "frames " + ticks
  Print "cube yaw " + EntityYaw(cube) + " pitch " + EntityPitch(cube)
  Print "ship at " + EntityX(ship) + ", " + EntityY(ship) + ", " + EntityZ(ship)
  Print "ship yaw " + EntityYaw(ship)
End Function

; Not an Update: this runs once, before the frames, to check the setup.
PointEntity camera, cube
Print "camera pitch " + EntityPitch(camera) + " yaw " + EntityYaw(camera)
Print "distance " + EntityDistance(camera, cube)

Function Draw()
  If ticks = 45 Then Report()
End Function
