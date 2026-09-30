; Dim arrays and fixed-size [ ] arrays.
Dim scores(5)
For i = 0 To 5 : scores(i) = i * i : Next
For i = 0 To 5 : Write scores(i) + " " : Next : Print

Dim grid$(2, 3)
For y = 0 To 2
  For x = 0 To 3
    grid(y, x) = Chr(65 + y) + x
  Next
Next
For y = 0 To 2
  For x = 0 To 3 : Write grid(y, x) + " " : Next
  Print
Next

Dim cube#(1, 1, 1)
cube(1, 0, 1) = 2.5
cube(0, 1, 1) = cube(1, 0, 1) * 2
Print cube(1, 0, 1) + " " + cube(0, 1, 1) + " " + cube(1, 1, 1)

; Dim again resizes and clears the array
Dim scores(2)
Print scores(0) + " " + scores(2)

; Array size can come from a variable
n = 4
Dim names$(n)
names(n) = "last"
Print names(4) + "|" + names(0) + "|"

; Arrays are global: functions can use them
Function SumScores()
  Local total = 0
  For i = 0 To 2 : total = total + scores(i) : Next
  Return total
End Function
scores(1) = 10 : scores(2) = 20
Print SumScores()

; Int arrays keep 32-bit values
Dim big(0)
big(0) = 2147483647
big(0) = big(0) + 1
Print big(0)

; [ ] arrays have a fixed size: v[3] holds indices 0 to 3
Local v[3]
For i = 0 To 3 : v[i] = i * 10 : Next
Print v[0] + v[1] + v[2] + v[3]
Global names$[2]
names[1] = "middle"
Print "[" + names[0] + "][" + names[1] + "]"

Function Local10#()
  Local a#[1]
  a[0] = 1.5 : a[1] = a[0] * 2
  Return a[0] + a[1]
End Function
Print Local10()
