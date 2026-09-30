; A Function reading a main-program variable that is not Global gets a
; fresh local instead; the compiler warns about it.
score = 10
Function AddPoints()
  score = score + 5
  Return score
End Function
Function Loop()
  ; Assigning first is fine: this i is clearly the Function's own.
  For i = 1 To 2 : Next
  Return i
End Function
i = 100
Print AddPoints() + " " + score + " " + Loop()
