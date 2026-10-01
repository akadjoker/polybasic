"""Narration for the trailer: speaks each scene's line (the `say` of
scenes.mjs, as JSON {id: text}) with the Kokoro voice and checks it by
transcribing it back with faster-whisper.

    <python> tools/trailer/make-voice.py --lines lines.json --out voice
             [--voice bm_george] [--speed 1.0] [--whisper small.en]
             --model kokoro-v1.0.onnx --voices voices-v1.0.bin

<python> has the `kokoro-onnx`, `soundfile`, `numpy` and `faster-whisper`
packages (a virtualenv outside the repository). Writes <out>/<id>.wav (24 kHz
mono) and <out>/voice.json: each line's duration, what was heard and a
similarity score (1: the words match).
"""

import argparse
import difflib
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

RATE = 24000


def words(text):
    text = text.lower().replace('3d', 'three d')
    return re.sub(r"[^a-z0-9' ]+", ' ', text).split()


def trim(audio, threshold=0.004, pad=0.06):
    """Cuts the silence before and after the speech (keeps `pad` s)."""
    loud = np.where(np.abs(audio) > threshold)[0]
    if len(loud) == 0:
        return audio
    return audio[max(0, loud[0] - int(pad * RATE)):min(len(audio), loud[-1] + int(pad * RATE))]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--lines', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--voices', required=True)
    parser.add_argument('--voice', default='bm_george')
    parser.add_argument('--speed', type=float, default=1.0)
    parser.add_argument('--whisper', default='small.en')
    args = parser.parse_args()

    with open(args.lines, encoding='utf-8') as f:
        lines = json.load(f)
    os.makedirs(args.out, exist_ok=True)

    kokoro = Kokoro(args.model, args.voices)
    lang = 'en-gb' if args.voice[0] == 'b' else 'en-us'
    from faster_whisper import WhisperModel
    whisper = WhisperModel(args.whisper, device='cpu', compute_type='int8')

    report = {'voice': args.voice, 'speed': args.speed, 'lines': {}}
    for scene, text in lines.items():
        samples, rate = kokoro.create(text, voice=args.voice, speed=args.speed, lang=lang)
        assert rate == RATE, rate
        audio = trim(np.asarray(samples, dtype=np.float32))
        path = os.path.join(args.out, f'{scene}.wav')
        sf.write(path, audio, RATE, subtype='FLOAT')
        heard = ' '.join(s.text.strip() for s in whisper.transcribe(path, language='en', beam_size=5)[0])
        score = difflib.SequenceMatcher(None, words(text), words(heard)).ratio()
        report['lines'][scene] = {'text': text, 'seconds': round(len(audio) / RATE, 3), 'heard': heard, 'match': round(score, 3)}
        print(f'{scene}: {len(audio) / RATE:.2f} s, match {score:.2f} - heard "{heard}"', file=sys.stderr)

    with open(os.path.join(args.out, 'voice.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)


if __name__ == '__main__':
    main()
