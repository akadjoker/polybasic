# Trailer

Tools that make the PolyBasic trailer: the scenes are the playground's own
examples, run on a clock that only moves when the script says so, so every
frame is the same on every run.

- `scenes.mjs`: the storyboard and the narration of each scene.
- `capture.html`, `capture.mjs`: run a `.pb` frame by frame and save one JPEG
  per video frame (keys and mouse clicks on chosen frames).
- `cards.mjs`: the title, code (with the JavaScript the compiler really
  makes), playground and closing cards.
- `trailer.mjs`: scenes, cards, narration and ffmpeg together.

## Making it

ffmpeg and the voice are not part of the repository. In a scratch folder:

```
python3 -m venv venv && venv/bin/pip install imageio-ffmpeg piper-tts
export TRAILER_FFMPEG=$(venv/bin/python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
# voices: https://huggingface.co/rhasspy/piper-voices (en/en_US/lessac/medium, en/en_US/ryan/high)
```

Narration, one .wav per scene id (the text is `say` in `scenes.mjs`):

```
venv/bin/python -m piper -m en_US-ryan-high.onnx -c en_US-ryan-high.onnx.json \
  --sentence-silence 0.25 -i title.txt -f voice-ryan/title.wav
```

Then, from the repository root (after `npm run build`):

```
node tools/trailer/trailer.mjs --work work --out out --voices ryan=voice-ryan,lessac=voice-lessac
```

Scene lengths follow the narration. Frames already in `work/frames` are
kept, so after changing a scene's keys delete its folder there and run again.
