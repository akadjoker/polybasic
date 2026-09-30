; Errors inside Update stop the loop and name the line.
Global n
Function Update()
  n = n + 1
  Print "update " + n
  If n = 3 Then Print 1 / (n - 3)
End Function
