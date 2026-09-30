; End works from inside nested Function calls and loops.
Function Deep(n)
  If n = 0
    Print "ending"
    End
  EndIf
  Deep(n - 1)
  Print "not printed"
End Function
For i = 1 To 3
  Deep(3)
Next
