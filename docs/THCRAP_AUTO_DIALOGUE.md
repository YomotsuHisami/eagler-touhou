# TH10/TH11 automatic dialogue repair

## Source and ownership

The shared Host compiler must recognize parameterless thmsg instructions such
as `\t7`, `\t8` and `\t9`, not just instructions with a `;` payload separator.
The authority is [thcrap_tsa/src/th06_msg.cpp](https://github.com/thpatch/thcrap/blob/master/thcrap_tsa/src/th06_msg.cpp):
`MSG_TH10` marks 7/8/10 as `OP_AUTO_END`; `MSG_TH11` marks 7/8/9/11 as
`OP_AUTO_END`. `op_auto_end` closes the current auto-line box. The games'
original timecodes, wait rules and input handling are not changed.

Previously parameterless speaker instructions were ignored. Without a wait
instruction to terminate a box, later translated lines were treated as excess
original lines and removed. TH11 `st06_00a.msg` entry 2 is a concrete example:
the old English pack kept time 30 but lost times 150, 210 and 390.

This is a language-package compiler repair, not a Runtime repair. Regenerate
both language ZIPs and their catalog identities, then reassemble any offline
resource/import packages or Hosted publication that contains the old packs.
Do not overwrite ZIPs inside an existing publication without regenerating its
manifest hashes. Keep original archives and generated private packs out of Git.

## Regression gates

Run `node tests/test-thcrap-compiler.mjs` and
`node tests/test-thcrap-static-pack.mjs`. The first covers Chinese and English,
all relevant parameterless speaker opcodes, and original-language fallback.

With local private archives, prepared packs and THTK tools, additionally run:

```text
node tests/test-thcrap-timed-dialogue.mjs th10 ORIGINAL_DAT PACK_DIRECTORY THTK_DIRECTORY TEMP_DIRECTORY
node tests/test-thcrap-timed-dialogue.mjs th11 ORIGINAL_DAT PACK_DIRECTORY THTK_DIRECTORY TEMP_DIRECTORY
```

The binary gate compares every packaged story MSG's control flow against the
original archive, allowing only thcrap's TH11 `OP_DELETE` 25 removal. It checks
that every original text timecode in multi-timecode dialogues without an input
wait remains present. It does not claim visual pixel parity or a full in-game
playthrough.
