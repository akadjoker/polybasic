; Several arrays in one Dim, each with its own type and size.
Dim a(2), b#(1, 1), c$(1)
a(2) = 7
b(1, 0) = 1.5
c(1) = "two"
Print a(2) + " " + b(1, 0) + " " + c(1)
Function Show()
  b(0, 1) = 2.5
  Print a(2) + b(0, 1) + " " + c(1)
End Function
Show()
