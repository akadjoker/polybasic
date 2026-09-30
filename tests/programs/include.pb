; Include pulls in another file; each file is included once.
Include "inc/shapes.pb"
Include "inc/shapes.pb"
MakeShape "triangle", 3
MakeShape "square", SQUARE
For s.Shape = Each Shape
  Print Describe(s)
Next
