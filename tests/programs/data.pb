; Data, Read and Restore.
Data 10, 20, 30
Data "ship", 2.5, -7
Data 3.7, "99", "1.25"

Read a, b, c
Print a + b + c
Read name$, speed#, depth
Print name + " " + speed + " " + depth
; Values convert to the type of the variable they are read into
Read rounded, fromText, fromTextFloat#
Print rounded + " " + fromText + " " + fromTextFloat
Restore
Read again$
Print "after Restore: " + again

Function ReadAll()
  Restore
  Local total = 0
  For i = 1 To 3
    Read v
    total = total + v
  Next
  Return total
End Function
Print ReadAll()

; Data can be anywhere in the main program, even after the Reads
Restore
For i = 1 To 9 : Read skip$ : Next
Read level$
Print level
Data "level one"
