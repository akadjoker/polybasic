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
python3 -m venv venv && venv/bin/pip install imageio-ffmpeg
export TRAILER_FFMPEG=$(venv/bin/python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
```

Narration with the Kokoro voice (https://huggingface.co/hexgrad/Kokoro-82M;
the model and voices files of kokoro-onnx), one .wav per scene id, each line
checked by transcribing it back with faster-whisper:

```
venv/bin/pip install kokoro-onnx soundfile faster-whisper
node -e "import('./tools/trailer/scenes.mjs').then(m=>console.log(JSON.stringify(Object.fromEntries(m.SCENES.map(s=>[s.id,s.say])))))" > lines.json
venv/bin/python tools/trailer/make-voice.py --lines lines.json --out voice-george \
  --model kokoro-v1.0.onnx --voices voices-v1.0.bin --voice bm_george
```

Then, from the repository root (after `npm run build`):

```
node tools/trailer/trailer.mjs --work work --out out --voices george=voice-george
```

The narration is normalised to -14 LUFS / -2 dBTP (loudnorm, two passes).
Scene lengths follow the narration. Frames already in `work/frames` are
kept, so after changing a scene's keys delete its folder there and run again.
