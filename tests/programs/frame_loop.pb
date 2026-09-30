; A game-style program: the main body sets up, Update runs 60 times a
; second, Draw after each frame, End stops.
Type Ball
  Field x#, y#, vy#
End Type

Global ticks, bounces

For i = 1 To 3
  b.Ball = New Ball
  b\x = i * 100
  b\y = -i * 15
Next
Print "setup done, dt=" + DeltaTime()

Function Update()
  ticks = ticks + 1
  For b.Ball = Each Ball
    b\vy = b\vy + 0.5
    b\y = b\y + b\vy
    If b\y > 20
      b\y = 20
      b\vy = -b\vy * 0.5
      bounces = bounces + 1
    EndIf
  Next
  If ticks = 90 Then End
End Function

Function Draw()
  If ticks Mod 30 = 0
    Write "frame " + FrameCount() + " t=" + MilliSecs() + "ms:"
    For b.Ball = Each Ball : Write " " + b\y : Next
    Print " bounces=" + bounces
  EndIf
End Function
