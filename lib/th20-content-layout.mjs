// Canonical retail TH20 PCM layout used by the portable SDL3 adapter.
// Keep this independent of any Runtime implementation so host/self-host
// content preparation never needs the TH20 Wasm parser.
//
// The table follows thbgm.fmt's archive order (archive_offset ascending). The
// final track is a TH128 borrow that keeps its original OGG filename; every
// other track is named after its th20_XX source record.
export const TH20_MUSIC_FILES = Object.freeze([
  "th20_01.ogg", "th20_02.ogg", "th20_03.ogg", "th20_04.ogg", "th20_05.ogg",
  "th20_06.ogg", "th20_07.ogg", "th20_08.ogg", "th20_09.ogg", "th20_10.ogg",
  "th20_11.ogg", "th20_13.ogg", "th20_12.ogg", "th20_17.ogg", "th20_18.ogg",
  "th20_15.ogg", "th20_14.ogg", "th20_16.ogg", "th128_08.ogg",
]);

export const TH20_MUSIC_LAYOUT = Object.freeze([
  { offset: 16, loop: 358112, length: 17292480 },
  { offset: 17292496, loop: 2471040, length: 23001472 },
  { offset: 40293968, loop: 498432, length: 17432128 },
  { offset: 57726096, loop: 874016, length: 24779200 },
  { offset: 82505296, loop: 2365856, length: 24280896 },
  { offset: 106786192, loop: 1154704, length: 25786592 },
  { offset: 132572784, loop: 453440, length: 23677952 },
  { offset: 156250736, loop: 872192, length: 29884160 },
  { offset: 186134896, loop: 5001472, length: 31100672 },
  { offset: 217235568, loop: 2756864, length: 31494144 },
  { offset: 248729712, loop: 629248, length: 26837376 },
  { offset: 275567088, loop: 362048, length: 17296768 },
  { offset: 292863856, loop: 2210240, length: 34336192 },
  { offset: 327200048, loop: 622336, length: 32871936 },
  { offset: 360071984, loop: 362464, length: 31570240 },
  { offset: 391642224, loop: 3290976, length: 8438912 },
  { offset: 400081136, loop: 494528, length: 12913664 },
  { offset: 412994800, loop: 132224, length: 10054800 },
  { offset: 423049600, loop: 1879240, length: 6741184 },
].map(Object.freeze));
