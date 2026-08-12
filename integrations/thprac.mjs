export const THPRAC_SCHEMA = "eagler-touhou/thprac-session/1";
export const THPRAC_REPLAY_SCHEMA = "eagler-touhou/thprac-replay/1";

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
  })
});

export const THPRAC_FUNCTIONAL_FEATURES = Object.freeze({
  th06: Object.freeze(["coarse-stage-warp", "direct-frame-warp", "initial-resources", "rank", "rank-lock", "practice-replay-metadata", "midrun-replay-save"]),
  th07: Object.freeze(["coarse-stage-warp", "direct-frame-warp", "initial-resources", "cherry", "rank", "rank-lock", "practice-replay-metadata"])
});

// These parameters remain in the stable session/replay schema so a later
// source-level ECL patcher can add them without invalidating saved metadata.
// They are deliberately not advertised as functional today.
export const THPRAC_DEFERRED_FEATURES = Object.freeze({
  th06: Object.freeze(["exact-section-warp", "multi-phase-spell-start", "section-dialogue", "patchouli-fake-shot"]),
  th07: Object.freeze(["exact-section-warp", "multi-phase-spell-start", "section-dialogue"])
});

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
      output[key] = integer(input[key], fallback, min, max);
    }
  }
  // Matches thprac: unlocked TH06 rank uses the original 0..32 range.
  if (game === "th06" && !output.rankLock) output.rank = Math.min(output.rank, 32);
  if (game === "th07" && !output.rankLock) output.rank = Math.min(output.rank, 32);
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

export function createThpracReplayMetadata(game, input = {}, { source = "advanced-practice" } = {}) {
  const session = createThpracSession(game, input);
  return {
    schema: THPRAC_REPLAY_SCHEMA,
    game,
    source,
    params: session.params
  };
}

export function parseThpracReplayMetadata(value, expectedGame) {
  const metadata = typeof value === "string" ? JSON.parse(value) : value;
  if (!metadata || typeof metadata !== "object" || metadata.schema !== THPRAC_REPLAY_SCHEMA) {
    throw new TypeError("unsupported thprac replay metadata");
  }
  if (metadata.game !== expectedGame) throw new TypeError(`replay metadata is for ${metadata.game}`);
  return createThpracReplayMetadata(expectedGame, metadata.params, { source: metadata.source });
}

export function thpracReplaySidecarPath(replayPath) {
  if (typeof replayPath !== "string" || replayPath.includes("\\") || !/(^|\/)replay\/[^/]+\.rpy$/i.test(replayPath)) {
    throw new TypeError("invalid replay path");
  }
  if (replayPath.split("/").some(part => !part || part === "." || part === "..")) throw new TypeError("invalid replay path");
  return `${replayPath}.thprac.json`;
}

export function getThpracSchema(game) {
  const schema = schemaFor(game);
  return JSON.parse(JSON.stringify(schema));
}
