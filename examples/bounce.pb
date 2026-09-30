; A first PolyBasic program: three balls bounce until they have hit the
; edges ten times.
Type Ball
  Field x#, y#, speed#
End Type

Global bounces

For i = 1 To 3
  b.Ball = New Ball
  b\x = i * 100
  b\speed = 60 * i
Next

; Update runs 60 times a second, after the setup above has run once.
Function Update()
  For b.Ball = Each Ball
    b\y = b\y + b\speed * DeltaTime()
    If b\y > 200 Or b\y < 0
      b\speed = -b\speed
      bounces = bounces + 1
    EndIf
  Next
  If bounces >= 10 Then End
End Function

; Draw runs once per displayed frame.
Function Draw()
  If FrameCount() Mod 30 = 0 Then Print "bounces so far: " + bounces
End Function
