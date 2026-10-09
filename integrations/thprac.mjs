export const THPRAC_SCHEMA = "eagler-touhou/thprac-session/1";

const GAME_SCHEMAS = Object.freeze({
  th06: Object.freeze({
    defaults: Object.freeze({
      mode: 1, stage: 0, warp: 0, section: 0, phase: 0, frame: 0, dlg: false,
      score: 0, life: 8, bomb: 8, power: 128, graze: 0, point: 0,
      rank: 32, rankLock: false, fakeType: 0
    }),
    ranges: Object.freeze({
      mode: [0, 1], stage: [0, 6], warp: [0, 9], section: [0, 19999], phase: [0, 64], frame: [0, 0x7fffffff],
      score: [0, 999999999], life: [0, 8], bomb: [0, 8], power: [0, 128], graze: [0, 99999],
      point: [0, 9999], rank: [0, 99], fakeType: [0, 4]
    })
  }),
  th07: Object.freeze({
    defaults: Object.freeze({
      mode: 1, stage: 0, warp: 0, section: 0, phase: 0, frame: 0, dlg: false,
      score: 0, life: 8, bomb: 8, power: 128, graze: 0, point: 0,
      point_total: 0, point_stage: 0, cherry: 0, cherryMax: 200000,
      cherryPlus: 0, spellBonus: 0, rank: 16, rankLock: false
    }),
    ranges: Object.freeze({
      mode: [0, 1], stage: [0, 7], warp: [0, 8], section: [0, 19999], phase: [0, 64], frame: [0, 0x7fffffff],
      score: [0, 9999999990], life: [0, 8], bomb: [0, 8], power: [0, 128], graze: [0, 99999],
      point: [0, 9999], point_total: [0, 9999], point_stage: [0, 9999], cherry: [0, 9999990],
      cherryMax: [0, 9999990], cherryPlus: [0, 50000], spellBonus: [0, 30], rank: [10, 99]
    })
  }),
  th08: Object.freeze({
    defaults: Object.freeze({
      mode: 1, stage: 0, warp: 0, section: 0, phase: 0, frame: 0, dlg: false,
      score: 0, life: 2, bomb: 8, power: 128, gauge: 0, graze: 0, point: 0,
      point_total: 0, point_stage: 0, time: 0, value: 60000, night: 0,
      familiar: 0, rank: 12, rankLock: false
    }),
    ranges: Object.freeze({
      mode: [0, 1], stage: [0, 8], warp: [0, 7], section: [0, 19999], phase: [0, 6], frame: [0, 0x7fffffff],
      score: [0, 9999999990], life: [0, 8], bomb: [0, 8], power: [0, 128], gauge: [-10000, 10000],
      graze: [0, 0x7fffffff], point: [0, 9999], point_total: [0, 9999], point_stage: [0, 9999],
      time: [0, 0x7fffffff], value: [0, 9999999], night: [0, 11], familiar: [0, 2000], rank: [8, 99]
    })
  }),
  th10: Object.freeze({
    defaults: Object.freeze({
      mode: 1, stage: 0, warp: 0, section: 0, phase: 0, frame: 0, dlg: false,
      score: 0, life: 9, power: 100, faith: 50000, faith_bar: 130,
      st6_boss9_spd: 160, real_bullet_sprite: false
    }),
    ranges: Object.freeze({
      mode: [0, 1], stage: [0, 6], warp: [0, 5], section: [0, 19999], phase: [0, 1], frame: [0, 0x7fffffff],
      score: [0, 9999999990], life: [0, 9], power: [0, 100], faith: [0, 999990], faith_bar: [0, 130],
      st6_boss9_spd: [-1, 160]
    })
  }),
  th11: Object.freeze({
    defaults: Object.freeze({
      mode: 1, stage: 0, section: 0, phase: 0, dlg: false, life: 9,
      life_fragment: 0, power: 80, graze: 0, signal: 0, value: 50000,
      score: 0, marisa_b_formation: 0
    }),
    ranges: Object.freeze({
      mode: [0, 1], stage: [0, 6], section: [0, 19999], phase: [0, 4],
      life: [0, 9], life_fragment: [0, 4], power: [0, 96], graze: [0, 999999],
      signal: [0, 100], value: [0, 999990], score: [0, 9999999990],
      marisa_b_formation: [0, 4]
    })
  }),
  th15: Object.freeze({
    defaults: Object.freeze({mode: 1, stage: 0, section: 0, phase: 0, dlg: false,
      score: 0, life: 8, life_fragment: 0, bomb: 8, bomb_fragment: 0,
      power: 400, value: 10000, graze: 0, reisen_shield: 0,
      doremy_normal_1_phase: 0, enhanced_para: 0}),
    ranges: Object.freeze({mode: [0, 1], stage: [0, 6], section: [0, 19999], phase: [0, 6],
      score: [0, 9999999990], life: [0, 8], life_fragment: [0, 5], bomb: [0, 8],
      bomb_fragment: [0, 4], power: [0, 400], value: [0, 999990], graze: [0, 999999],
      reisen_shield: [0, 3], doremy_normal_1_phase: [-Math.PI, Math.PI], enhanced_para: [0, 1]}),
    decimalFields: Object.freeze(["doremy_normal_1_phase", "enhanced_para"])
  })
});
export const THPRAC_SUPPORTED_GAMES = Object.freeze(Object.keys(GAME_SCHEMAS));

export const THPRAC_FUNCTIONAL_FEATURES = Object.freeze({
  th06: Object.freeze(["coarse-stage-warp", "direct-frame-warp", "initial-resources", "rank", "rank-lock", "practice-replay-metadata", "midrun-replay-save"]),
  th07: Object.freeze(["coarse-stage-warp", "direct-frame-warp", "initial-resources", "cherry", "rank", "rank-lock", "practice-replay-metadata"]),
  th08: Object.freeze(["coarse-stage-warp", "direct-frame-warp", "exact-section-warp", "multi-phase-spell-start", "section-dialogue", "initial-resources", "gauge", "time", "night", "familiar", "rank", "rank-lock", "practice-replay-metadata", "practice-assists"]),
  th10: Object.freeze(["coarse-stage-warp", "exact-section-warp", "multi-phase-spell-start", "section-dialogue", "initial-resources", "faith", "st6-boss9-speed", "practice-replay-metadata", "practice-assists"]),
  th11: Object.freeze(["coarse-stage-warp", "exact-section-warp", "multi-phase-spell-start", "section-dialogue", "initial-resources", "practice-replay-metadata", "practice-assists"]),
  th15: Object.freeze(["exact-section-warp", "multi-phase-spell-start", "section-dialogue", "initial-resources", "practice-replay-metadata", "practice-assists"])
});

// These parameters remain in the stable session/replay schema so a later
// source-level ECL patcher can add them without invalidating saved metadata.
// They are deliberately not advertised as functional today.
export const THPRAC_DEFERRED_FEATURES = Object.freeze({
  th06: Object.freeze(["exact-section-warp", "multi-phase-spell-start", "section-dialogue", "patchouli-fake-shot"]),
  th07: Object.freeze(["exact-section-warp", "multi-phase-spell-start", "section-dialogue"]),
  th08: Object.freeze([]),
  th10: Object.freeze(["direct-frame-warp", "real-bullet-sprite", "all-clear-bonus"]),
  th11: Object.freeze(["direct-frame-warp"]),
  th15: Object.freeze([])
});

for (const [label, table] of [["functional", THPRAC_FUNCTIONAL_FEATURES], ["deferred", THPRAC_DEFERRED_FEATURES]]) {
  if (JSON.stringify(Object.keys(table)) !== JSON.stringify(THPRAC_SUPPORTED_GAMES)) {
    throw new Error(`thprac ${label} feature table must match supported game schemas`);
  }
}

function schemaFor(game) {
  const schema = GAME_SCHEMAS[game];
  if (!schema) throw new TypeError(`unsupported thprac game: ${game}`);
  return schema;
}

function integer(value, fallback, min, max) {
  const number = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
  return Math.max(min, Math.min(max, number));
}

export function normalizeThpracParams(game, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("thprac params must be an object");
  const schema = schemaFor(game);
  const output = {};
  for (const [key, fallback] of Object.entries(schema.defaults)) {
    if (typeof fallback === "boolean") output[key] = typeof input[key] === "boolean" ? input[key] : fallback;
    else {
      const [min, max] = schema.ranges[key];
      output[key] = schema.decimalFields?.includes(key)
        ? Math.max(min, Math.min(max, Number.isFinite(Number(input[key])) ? Number(input[key]) : fallback))
        : integer(input[key], fallback, min, max);
    }
  }
  if (game === "th15" && output.stage !== 6) output.life_fragment = Math.min(output.life_fragment, 3);
  // Matches thprac: unlocked TH06 rank uses the original 0..32 range.
  if (game === "th06" && !output.rankLock) output.rank = Math.min(output.rank, 32);
  if (game === "th07" && !output.rankLock) output.rank = Math.min(output.rank, 32);
  if (game === "th08" && !output.rankLock) output.rank = Math.min(output.rank, 16);
  return output;
}

export function createThpracSession(game, input = {}) {
  return {
    schema: THPRAC_SCHEMA,
    game,
    params: normalizeThpracParams(game, input),
    features: [...THPRAC_FUNCTIONAL_FEATURES[game]],
    deferredFeatures: [...THPRAC_DEFERRED_FEATURES[game]]
  };
}

export function getThpracSchema(game) {
  const schema = schemaFor(game);
  return JSON.parse(JSON.stringify(schema));
}
