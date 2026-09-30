; Included by include.pb
Type Shape
  Field sides
  Field name$
End Type

Const SQUARE = 4

Function MakeShape.Shape(name$, sides)
  s.Shape = New Shape
  s\name = name : s\sides = sides
  Return s
End Function

Include "helpers.pb"
