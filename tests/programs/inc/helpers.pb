; Included from inc/shapes.pb: paths are relative to the including file
Function Describe$(s.Shape)
  Return s\name + " has " + s\sides + " sides"
End Function
Include "../inc/shapes.pb"
