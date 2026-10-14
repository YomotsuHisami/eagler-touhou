# DAT clear and continue records

The launcher reads existing DAT bytes without changing them. `ScoreReport.clears`
remains the compatibility matrix for any recorded clear; `clearKinds` separately
records `none`, `continued`, `no-continue` or `unknown`. A stored no-continue clear
wins over a continued clear for the same loadout/difficulty. Stage access,
practice results and aggregate loadout entries cannot establish a story clear.

| Game | Evidence used | Display |
| --- | --- | --- |
| TH06 | CLRD first five bytes of progress are without continues; second five include all runs. A completed value is 99. HSCR fallback stores continues in the score's units digit. | Green if the first array clears; yellow if only the second clears. |
| TH07 | CLRD first six progress values update to 99 only with zero retries; the second array updates for every clear. HSCR fallback has an explicit continue count. Phantasm is outside the current five-row matrix. | Same green/yellow precedence as TH06. |
| TH08 | CLRD has paired 16-bit progress arrays. Completion bits 0x8000 and 0x4000 cover ending A/Extra and ending B; low stage-access bits are not completion. HSCR fallback has an explicit continue count. | Either ending can establish a clear; first-array completion is green, second-only completion yellow. |
| TH09 | PLST clear counts include all story clears. A ranking's continue byte has no matching per-run clear sentinel, so it cannot classify the aggregate clear. Extra cannot continue. | Story aggregates retain the old green/plain Cleared display; Extra is no-continue. |
| TH10 | CR rankings record completed runs with stage 8 and continues in score_units. Clear counts alone do not identify continue history. Extra cannot continue. | Completed ranking with zero continues is green; continued completion yellow. Aggregate-only history retains the old display. |

Dedicated CLRD progress takes precedence over ranking fallback, independently of
chapter order. TH10's explicitly completed ranking is positive clear evidence,
even if an aggregate count is zero. A failed ranking cannot classify another
run's aggregate clear. The retained green display for `unknown` preserves the
user-requested existing UI; it is not a claim that missing history proves a
no-continue clear. No outline or additional uncertainty text is rendered.

## Primary source verification

The implementation was checked against the native writers, as field names in
some readers are ambiguous. In particular, TH07's first array has a misleading
name; the zero-retry guard in the ending writer establishes its meaning.

- TH06: [CLRD layout](https://github.com/GensokyoClub/th06/blob/4b35ad00b59fa77f31a66e8a1db5b32bdf1d59b5/src/ResultScreen.hpp),
  [ending writer](https://github.com/GensokyoClub/th06/blob/4b35ad00b59fa77f31a66e8a1db5b32bdf1d59b5/src/Ending.cpp).
- TH07: [CLRD layout](https://github.com/YomotsuHisami/th07/blob/02c664e8affaf7bd819c57c496fe5ab901965394/src/ResultScreen.hpp),
  [ending writer](https://github.com/YomotsuHisami/th07/blob/02c664e8affaf7bd819c57c496fe5ab901965394/src/Ending.cpp).
- TH08: [progress layout](https://github.com/GensokyoClub/th08/blob/f345c7dee07b849f2ff93a0029ab5ede126bf12c/src/ScoreDat.hpp),
  [ending flags](https://github.com/GensokyoClub/th08/blob/f345c7dee07b849f2ff93a0029ab5ede126bf12c/src/Ending.cpp),
  [Extra completion](https://github.com/GensokyoClub/th08/blob/f345c7dee07b849f2ff93a0029ab5ede126bf12c/src/GameManager.cpp).
- TH09: [aggregate records](https://github.com/YomotsuHisami/th09/blob/e4e8ea50d77765693b60f476855cf8fce9e1543d/th09_web/cpp/game/PlayerRecords.cpp),
  [ending and continue flow](https://github.com/YomotsuHisami/th09/blob/e4e8ea50d77765693b60f476855cf8fce9e1543d/th09_web/cpp/game/GameSession.cpp).
- TH10: [ranking layout](https://github.com/YomotsuHisami/th10/blob/8a44f50e3156c406a95be47d9e48b77b17452db7/th10_web/cpp/game/ScoreData.hpp),
  [completion writer](https://github.com/YomotsuHisami/th10/blob/8a44f50e3156c406a95be47d9e48b77b17452db7/th10_web/cpp/game/Results.cpp),
  [continue counter](https://github.com/YomotsuHisami/th10/blob/8a44f50e3156c406a95be47d9e48b77b17452db7/th10_web/cpp/game/GameSessionResources.cpp).
- Binary layouts and existing decoder attribution:
  [ThScoreFileConverter](https://github.com/y-iihoshi/ThScoreFileConverter/tree/feb02e2fa390cd0e0c599c97cc12399d9c07fd22),
  `third_party/score-format/LICENSE.txt` (BSD-2-Clause).

Regression checks use encrypted synthetic DAT samples, including both TH08
ending routes, chapter order changes, default/failed rankings, no-continue
precedence and aggregate-only history. The read-only browser sample exercises
the production decoder, model, matrix and stylesheet without importing into the
user's save library or changing native files.
