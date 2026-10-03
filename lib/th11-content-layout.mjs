// Canonical retail TH11 PCM layout used by the portable SDL3 adapter.
// Keep this independent of any Runtime implementation so host/self-host
// content preparation never needs an old TH11 Wasm parser.
//
// Derived from the game's own THA1 archive entry `thbgm.fmt` (953 bytes, 18
// records of 52 bytes) and validated against the retail thbgm.dat ZWAV v1
// container. `loop` is the intro length in bytes; `length` is the total PCM
// byte length at 44100 Hz, 16-bit stereo (4 bytes per frame).
export const TH11_MUSIC_FILES = Object.freeze([
  "th11_00.ogg", "th11_01.ogg", "th11_02.ogg", "th11_03.ogg", "th11_05.ogg",
  "th11_06.ogg", "th11_07.ogg", "th11_08.ogg", "th11_10.ogg", "th11_12.ogg",
  "th11_13.ogg", "th11_14.ogg", "th11_16.ogg", "th11_15.ogg", "th11_17.ogg",
  "th11_18.ogg", "th11_19.ogg", "th10_17.ogg",
]);

export const TH11_MUSIC_LAYOUT = Object.freeze([
  { offset: 16, loop: 343552, length: 13745536 },
  { offset: 13745552, loop: 413056, length: 17480064 },
  { offset: 31225616, loop: 815104, length: 9795712 },
  { offset: 41021328, loop: 670208, length: 19677696 },
  { offset: 60699024, loop: 591872, length: 19525120 },
  { offset: 80224144, loop: 586368, length: 20531840 },
  { offset: 100755984, loop: 1054464, length: 19082240 },
  { offset: 119838224, loop: 1431040, length: 24717056 },
  { offset: 144555280, loop: 638464, length: 22038656 },
  { offset: 166593936, loop: 708008, length: 31862904 },
  { offset: 198456840, loop: 542208, length: 17896704 },
  { offset: 216353544, loop: 616448, length: 20619264 },
  { offset: 236972808, loop: 633088, length: 29937152 },
  { offset: 266909960, loop: 1103744, length: 33688704 },
  { offset: 300598664, loop: 4111616, length: 27210240 },
  { offset: 327808904, loop: 781824, length: 12770304 },
  { offset: 340579208, loop: 5381088, length: 14921664 },
  { offset: 355500872, loop: 1879240, length: 6741184 },
].map(Object.freeze));
