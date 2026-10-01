// The trailer's storyboard. Every scene has a narration line; its length on
// screen is that of the narration plus a pause, or `min` seconds when that is
// longer. Everything said here is something the repository does today.
//
// A scene shows one of:
//   card:   'title' | 'code' | 'playground' | 'close'  (tools/trailer/cards.mjs)
//   live:   for a card, frames of another scene shown in its screen
//   clips:  [{ program, keys, clicks }]  programs run on the capture clock,
//           the scene's time shared equally between them. `keys` are
//           [key, fromSecond, toSecond] held down; `clicks` are
//           [x, y, atSecond] mouse presses (video pixels).

export const SCENES = [
  {
    id: 'title',
    card: 'title',
    min: 4,
    say: 'PolyBasic. A friendly BASIC for making 3D games, compiled to JavaScript.'
  },
  {
    id: 'code',
    card: 'code',
    min: 9,
    say: 'You write BASIC, in the spirit of Blitz Basic. PolyBasic compiles it to plain, fast JavaScript, and runs it right in your browser.'
  },
  {
    id: 'engine',
    min: 10,
    say: 'Underneath is a 3D engine of its own. Three J S only draws, behind a backend you can swap. Physics runs on Rapier, behind our own A P I.',
    clips: [{
      program: 'examples/crates.pb',
      clicks: [[560, 330, 1.2], [700, 300, 2.6], [610, 350, 4.2], [500, 320, 5.8], [650, 340, 7.4]],
      keys: [['ArrowRight', 0.2, 9]]
    }]
  },
  {
    id: 'driver',
    min: 9,
    say: "Blitz3D's own samples come along. This driving demo is a port: a car held up by four wheels, rolling over a heightmap terrain.",
    clips: [{ program: 'examples/driver.pb', keys: [['ArrowUp', 1.2, 14], ['ArrowLeft', 4.2, 5.4], ['ArrowRight', 6.6, 7.4]] }]
  },
  {
    id: 'dragon',
    min: 8,
    say: 'An M D 2 dragon, over a mirror floor. The same commands: Load M D 2, and Create Mirror.',
    // The dragon's camera turns 2 degrees an Update and zooms 1 unit: short
    // presses, the view settling between them.
    clips: [{ program: 'examples/dragon.pb', keys: [['ArrowRight', 0.5, 1.7], ['ArrowUp', 2.3, 2.55], ['ArrowLeft', 3.2, 5.0], ['ArrowDown', 5.6, 5.8]] }]
  },
  {
    id: 'fox',
    min: 11,
    say: 'Skeletons are here too. One fox, one skeleton, and animations that blend, layer, and load from other files.',
    clips: [{ program: 'examples/skinning.pb', keys: [['Digit3', 1.4, 1.5], ['KeyH', 5, 5.1], ['Digit1', 7.4, 7.5], ['Space', 9.4, 9.5]] }]
  },
  {
    id: 'effects',
    min: 10,
    say: 'Shadows. Trees grown from numbers. Grass that bends as you walk through it. And sound, synthesized by the engine itself.',
    clips: [
      { program: 'examples/shadows.pb', keys: [['ArrowRight', 0, 4], ['KeyD', 0.5, 2.5]] },
      { program: 'examples/trees.pb', keys: [['ArrowRight', 0, 4], ['ArrowUp', 1, 2]] },
      { program: 'examples/grass.pb', keys: [['ArrowRight', 0.3, 2.2], ['ArrowUp', 1.5, 4]] }
    ]
  },
  {
    id: 'playground',
    card: 'playground',
    // The playground's screen shows the frames of this scene's first clip
    // (x, y, width, height of the screen in the picture, and the 4:3 crop).
    live: { scene: 'fox', box: [807, 90, 416, 312], crop: '960:720' },
    min: 9,
    say: 'The playground has an editor, live errors, examples to start from, projects saved in your browser, and export to a single web page.'
  },
  {
    id: 'close',
    card: 'close',
    min: 5,
    say: 'PolyBasic. Open the playground, and make a game.'
  }
];
