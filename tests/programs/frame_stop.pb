; An Update that never calls End is stopped by the test runner.
Global n
Function Update()
  n = n + 1
  If n Mod 250 = 0 Then Print "update " + n
End Function
Print "start"
