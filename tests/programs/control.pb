; If, loops, Select and Exit.
x = 7
If x > 5 Then Print "big"
If x > 50 Then Print "huge" Else Print "not huge"
If x = 7 Then Print "seven" : Print "still seven"
If x = 8 Then Print "no" : Print "no again"
If x > 5
  Print "block if"
ElseIf x > 2
  Print "elseif"
Else
  Print "else"
EndIf
For v = 0 To 4
  If v = 0
    Write "zero "
  Else If v = 1
    Write "one "
  ElseIf v < 4
    Write "few "
  Else
    Write "many "
  End If
Next
Print

; Conditions: numbers are true when not 0
f# = 0.25
If f Then Print "float 0.25 is true"
If Not 0.0 Then Print "0.0 is false"

; For with Int and Float, Step up and down
For i = 1 To 5 : Write i + " " : Next : Print
For i = 10 To 1 Step -3 : Write i + " " : Next : Print
For t# = 0 To 1 Step 0.25 : Write t + " " : Next : Print
For i = 5 To 1 : Print "never" : Next
Print "after loop i=" + i

; The To value is read again every pass
n = 3 : c = 0
For i = 1 To n
  If i = 1 Then n = 5
  c = c + 1
Next i
Print "iterations: " + c

; While and Repeat
i = 0
While i < 3
  Print "while " + i
  i = i + 1
Wend
Repeat
  i = i - 1
  Print "repeat " + i
Until i = 0
k = 0
Repeat
  k = k + 1
  If k = 4 Then Exit
Forever
Print "k=" + k

; Exit leaves only the innermost loop
For i = 1 To 3
  For j = 1 To 3
    If j = 2 Then Exit
    Write i + "" + j + " "
  Next
Next
Print

; Select with numbers, strings and floats; no fall-through
For i = 0 To 4
  Select i
    Case 1, 2
      Print i + ": one or two"
    Case 3
      Print i + ": three"
      Exit
    Default
      Print i + ": other"
  End Select
Next
Print "exited at " + i
w$ = "b"
Select w
  Case "a": Print "A"
  Case "b": Print "B"
End Select
Select 3.0
  Case 3: Print "three as a float"
End Select
Select 5 * 2
  Case 10: Print "ten"
End Select
Select x
  Default: Print "only default"
End Select
