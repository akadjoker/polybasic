; A model file named in quotes is read before main runs, so LoadMesh gives
; the whole model at once and it can be changed straight away, as Blitz3D
; programs do.
Global guy, coin

guy = LoadMesh("../../examples/assets/kenney/character.glb")
Print "right after LoadMesh: loaded " + MeshLoaded(guy) + ", " + CountChildren(guy) + " part, " + CountAnimations(guy) + " animations"
FitMesh guy, 0, 0, 0, 2, 2, 2, True
Print "fitted at once: " + MeshHeight(guy) + " high"
Animate guy, FindAnimation(guy, "walk")
Print "animating: " + Animating(guy)
coin = LoadMesh("../../examples/assets/kenney/coin.glb")
Print "a bad animation number is an error at once:"
Animate coin, 1
