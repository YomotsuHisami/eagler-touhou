// Source contract for the legacy TH06/TH07 thcrap strings/ascii hooks.
//
// This is deliberately a fallback-alias table, not a translation table:
// stringdefs.js supplies optional ID -> translated text at pack build time.
// Multiple original literals can share one ID (TH07 uses both "Stage1" and
// "Stage1  " for th06_ascii_replay_stage_1 at different stringloc addresses).
//
// TH07 IDs/addresses come from base_tsa/th07/stringlocs.v1.00b.js. The six
// alignment records come from thcrap_tsa/src/ascii.cpp::ascii_vpatchf_th07_th08.

export const THCRAP_ASCII_CONTRACT = Object.freeze({
  th06: Object.freeze([
    // Stage-clear summary block, base_tsa/th06/stringlocs.v1.02h.js
    // Rx6a978..Rx6a834. The embedded newlines are part of the original
    // literals and therefore part of strings_id() pointer identity.
    { id: "th06_ascii_clear_header", aliases: ["Stage Clear\n\n"] },
    { id: "th06_ascii_clear_header_all", aliases: ["All Clear!\n\n"] },
    { id: "th06_ascii_clear_bonus_stage", aliases: ["Stage * 1000 = %5d\n"] },
    { id: "th06_ascii_clear_bonus_power", aliases: ["Power *  100 = %5d\n"] },
    { id: "th06_ascii_clear_bonus_graze", aliases: ["Graze *   10 = %5d\n"] },
    { id: "th06_ascii_clear_bonus_point", aliases: ["    * Point Item %3d\n"] },
    { id: "th06_ascii_clear_bonus_player", aliases: ["Player    = %8d\n"] },
    { id: "th06_ascii_clear_bonus_bomb", aliases: ["Bomb      = %8d\n"] },
    { id: "th06_ascii_clear_bonus_easy", aliases: ["Easy Rank      * 0.5\n"] },
    { id: "th06_ascii_clear_bonus_normal", aliases: ["Normal Rank    * 1.0\n"] },
    { id: "th06_ascii_clear_bonus_hard", aliases: ["Hard Rank      * 1.2\n"] },
    { id: "th06_ascii_clear_bonus_lunatic", aliases: ["Lunatic Rank   * 1.5\n"] },
    { id: "th06_ascii_clear_bonus_extra", aliases: ["Extra Rank     * 2.0\n"] },
    { id: "th06_ascii_clear_bonus_penalty_0.5", aliases: ["Player Penalty * 0.5\n"] },
    { id: "th06_ascii_clear_bonus_penalty_0.2", aliases: ["Player Penalty * 0.2\n"] },
    { id: "th06_ascii_clear_bonus_total", aliases: ["Total     = %8d"] },

    // In-game transient/score strings. TH06's full-power source has two
    // exclamation marks, unlike TH07's one-mark baseline.
    { id: "th06_ascii_bonus_format", aliases: ["BONUS %8d"] },
    { id: "th06_ascii_fullpower", aliases: ["Full Power Mode!!"] },
    { id: "th06_ascii_centered_spell_bonus", aliases: ["Spell Card Bonus!"] },
    { id: "th06_ascii_score_format", aliases: ["%.9d"] },
    { id: "th06_ascii_centered_stage", aliases: ["STAGE %d"] },
    { id: "th06_ascii_centered_stage_final", aliases: ["FINAL STAGE"] },
    { id: "th06_ascii_centered_stage_extra", aliases: ["EXTRA STAGE"] },
    { id: "th06_ascii_centered_stage_demo", aliases: [" DEMO PLAY"] },

    // Result screen special formats/ranks.
    { id: "th06_ascii_result_rank_easy", aliases: ["     Easy"] },
    { id: "th06_ascii_result_rank_normal", aliases: ["   Normal"] },
    { id: "th06_ascii_result_rank_hard", aliases: ["     Hard"] },
    { id: "th06_ascii_result_rank_lunatic", aliases: ["  Lunatic"] },
    { id: "th06_ascii_result_rank_extra", aliases: ["    Extra"] },
    { id: "th06_ascii_result_score_format", aliases: ["%8s %9d(%d)"] },
    { id: "th06_ascii_result_score_format_1", aliases: ["%8s %9d(1)"] },
    { id: "th06_ascii_result_score_format_clear", aliases: ["%8s %9d(C)"] },
    { id: "th06_ascii_2_digit_number_format", aliases: ["No.%.2d"] },

    // Replay/save/practice strings and every `%s` argument label translated
    // recursively by upstream strings_va_lookup().
    { id: "th06_ascii_replay_header", aliases: ["No.   Name      Date     Player   Rank"] },
    { id: "th06_ascii_replay", aliases: ["%s %8s  %8s %7s  %7s"] },
    { id: "th06_ascii_replay_stage_header", aliases: ["Stage  LastScore"] },
    { id: "th06_ascii_replay_stage", aliases: ["%s %9d"] },
    { id: "th06_ascii_replay_stage_empty", aliases: ["%s ---------"] },
    { id: "th06_ascii_replay_stage_1", aliases: ["Stage1"] },
    { id: "th06_ascii_replay_stage_2", aliases: ["Stage2"] },
    { id: "th06_ascii_replay_stage_3", aliases: ["Stage3"] },
    { id: "th06_ascii_replay_stage_4", aliases: ["Stage4"] },
    { id: "th06_ascii_replay_stage_5", aliases: ["Stage5"] },
    { id: "th06_ascii_replay_stage_6", aliases: ["Stage6"] },
    { id: "th06_ascii_replay_stage_extra", aliases: ["Extra "] },
    { id: "th06_ascii_easy", aliases: ["Easy   "] },
    { id: "th06_ascii_normal", aliases: ["Normal "] },
    { id: "th06_ascii_hard", aliases: ["Hard   "] },
    { id: "th06_ascii_lunatic", aliases: ["Lunatic"] },
    { id: "th06_ascii_extra", aliases: ["Extra  "] },
    { id: "th06_ascii_reimu_a", aliases: ["ReimuA "] },
    { id: "th06_ascii_reimu_b", aliases: ["ReimuB "] },
    { id: "th06_ascii_marisa_a", aliases: ["MarisaA"] },
    { id: "th06_ascii_marisa_b", aliases: ["MarisaB"] },
    { id: "th06_ascii_replay_save_header", aliases: ["No.   Name     Date     Player Score"] },
    { id: "th06_ascii_replay_save", aliases: ["No.%.2d %8s %8s %7s %9d"] },
    { id: "th06_ascii_replay_save_empty", aliases: ["No.%.2d -------- --/--/-- -------         0"] },

    // v1.02h defines Rx6c4c8 twice. Standard JSON object resolution keeps the
    // later `th06_practice_format`, so do not force the earlier
    // `th06_ascii_practice_format` special handler branch here.
    { id: "th06_practice_format", aliases: ["STAGE %d  %.9d"] },

    // These are looked up directly by ascii_vpatchf_th06 via
    // strings_get_fallback(), not through a stringloc pointer.
    { id: "th06_ascii_centered_stage_format", aliases: [], lookupOnly: true, signatureFallback: "STAGE %d" },
    { id: "th06_ascii_result_clear", aliases: [], lookupOnly: true, signatureFallback: "(C)" },
  ]),
  th07: Object.freeze([
    // Stage-clear summary block, Rx98518..Rx983f8.
    { id: "th07 Stage Clear", aliases: ["Stage Clear"] },
    { id: "th07 All Clear", aliases: ["All Clear!"] },
    { id: "th07 Clear Bonus Format", aliases: ["Clear  = %8d"] },
    { id: "th07 Clear Point Items Format", aliases: ["Point  = %8d"] },
    { id: "th07 Clear Graze Format", aliases: ["Graze  = %8d"] },
    { id: "th07 Clear Cherry Format", aliases: ["Cherry = %8d"] },
    { id: "th07 Clear Bonus Life Format", aliases: ["Player =%9d"] },
    { id: "th07 Clear Bonus Bomb Format", aliases: ["Bomb   = %8d"] },
    { id: "th07 Clear Easy Multiplier", aliases: ["Easy Rank    *0.5"] },
    { id: "th07 Clear Normal Multiplier", aliases: ["Normal Rank  *1.0"] },
    { id: "th07 Clear Hard Multiplier", aliases: ["Hard Rank    *1.2"] },
    { id: "th07 Clear Lunatic Multiplier", aliases: ["Lunatic Rank *1.5"] },
    { id: "th07 Clear Extra Multiplier", aliases: ["Extra Rank   *2.0"] },
    { id: "th07 Clear Phantasm Multiplier", aliases: ["Phantasm Rank*2.0"] },
    { id: "th07 Clear Player Penalty*0.5", aliases: ["Player Penalty*0.5"] },
    { id: "th07 Clear Player Penalty*0.2", aliases: ["Player Penalty*0.2"] },
    { id: "th07 Clear Total Score Format", aliases: ["Total = %8d0"] },

    // In-game transient ASCII. BONUS %8d intentionally has no TH07 stringloc.
    { id: "th07 Full Power", aliases: ["Full Power Mode!"], align: { baseline: "Full Power Mode!", extraX: 8.5 } },
    { id: "th07 Supernatural Border", aliases: ["Supernatural Border!!"], align: { baseline: "Supernatural Border!!", extraX: -11.5 } },
    { id: "th07 CherryPoint Max", aliases: ["CherryPoint Max!"], align: { baseline: "CherryPoint Max!", extraX: 8.5 } },
    { id: "th07 Border Bonus Format", aliases: ["Border Bonus %7d"], align: { baseline: "Border Bonus 1234567", extraX: -7.5 } },
    { id: "th06_ascii_centered_spell_bonus", aliases: ["Spell Card Bonus!"], align: { baseline: "Spell Card Bonus!", extraX: 17.5 } },
    { id: "th07 MAX", aliases: ["MAX"] },

    // Replay/practice formats proven by stringloc/source-address mapping.
    { id: "th07 Replay Header", aliases: ["No.   Name       Date  Player   Rank"] },
    { id: "th07 Replay", aliases: ["%s %8s  %6s %7s  %8s"] },
    { id: "th07 Replay Stage Header", aliases: ["Stage    LastScore"] },
    { id: "th07 Practice Stage Header", aliases: ["Stage    HI-Score"] },
    { id: "th07 Results Header", aliases: ["No  Name      Score(Stage)  Date   Slow"] },
    { id: "th06_ascii_2_digit_number_format", aliases: ["No.%.2d"] },
    { id: "th07 Max Bonus", aliases: ["MaxBonus %8d"] },
    { id: "th07 Replay Save Header", aliases: ["No.   Name     Date   Player Score"] },
    { id: "th07 Replay Save", aliases: ["No.%.2d %8s %5s  %7s %9d0"] },
    { id: "th07 Replay Save Empty", aliases: ["No.%.2d -------- --/--  -------          0"] },

    // Two original arrays share these stage IDs: Practice uses unpadded
    // aliases, Replay uses padded aliases. Address order in stringlocs matches
    // the source array order for both groups.
    { id: "th06_ascii_replay_stage_1", aliases: ["Stage1", "Stage1  "] },
    { id: "th06_ascii_replay_stage_2", aliases: ["Stage2", "Stage2  "] },
    { id: "th06_ascii_replay_stage_3", aliases: ["Stage3", "Stage3  "] },
    { id: "th06_ascii_replay_stage_4", aliases: ["Stage4", "Stage4  "] },
    { id: "th06_ascii_replay_stage_5", aliases: ["Stage5", "Stage5  "] },
    { id: "th06_ascii_replay_stage_6", aliases: ["Stage6", "Stage6  "] },
    { id: "th06_ascii_easy", aliases: ["Easy    "] },
    { id: "th06_ascii_normal", aliases: ["Normal  "] },
    { id: "th06_ascii_hard", aliases: ["Hard    "] },
    { id: "th06_ascii_lunatic", aliases: ["Lunatic "] },
    { id: "th06_ascii_extra", aliases: ["Extra   "] },
    { id: "th07 Ascii Phantasm", aliases: ["Phantasm"] },
  ])
});

export function validateAsciiContract(game) {
  const records = THCRAP_ASCII_CONTRACT[game];
  if (!records) throw new TypeError(`unsupported ASCII contract game: ${game}`);
  const aliases = new Map();
  const ids = new Set();
  for (const record of records) {
    if (typeof record.id !== "string" || !record.id || !Array.isArray(record.aliases) ||
        (!record.aliases.length && !record.lookupOnly)) {
      throw new TypeError(`${game}: invalid ASCII contract record`);
    }
    if (record.lookupOnly && record.aliases.length) {
      throw new TypeError(`${game}: lookup-only ASCII contract record must not define aliases: ${record.id}`);
    }
    if (record.lookupOnly && typeof record.signatureFallback !== "string") {
      throw new TypeError(`${game}: lookup-only ASCII record requires signatureFallback: ${record.id}`);
    }
    ids.add(record.id);
    for (const alias of record.aliases) {
      if (typeof alias !== "string" || !alias) throw new TypeError(`${game}: invalid ASCII fallback alias`);
      const previous = aliases.get(alias);
      if (previous && previous !== record.id) {
        throw new TypeError(`${game}: ASCII fallback alias collision: ${JSON.stringify(alias)} -> ${previous}/${record.id}`);
      }
      aliases.set(alias, record.id);
    }
    if (record.align) {
      if (typeof record.align.baseline !== "string" || !Number.isFinite(record.align.extraX)) {
        throw new TypeError(`${game}: invalid ASCII alignment contract for ${record.id}`);
      }
    }
  }
  return Object.freeze({ records, aliases, ids });
}

export function legacyAsciiPrintfSignature(format) {
  if (typeof format !== "string") throw new TypeError("legacy ASCII format must be a string");
  const signature = [];
  for (let index = 0; index < format.length; index++) {
    if (format[index] !== "%") continue;
    index++;
    if (index >= format.length) throw new TypeError(`unterminated printf specifier: ${JSON.stringify(format)}`);
    if (format[index] === "%") continue;
    while (index < format.length && "-+ #0'".includes(format[index])) index++;
    if (format[index] === "*") throw new TypeError(`unsupported printf '*' width: ${JSON.stringify(format)}`);
    while (index < format.length && /[0-9]/.test(format[index])) index++;
    if (format[index] === "$") throw new TypeError(`unsupported positional printf format: ${JSON.stringify(format)}`);
    if (format[index] === ".") {
      index++;
      if (format[index] === "*") throw new TypeError(`unsupported printf '*' precision: ${JSON.stringify(format)}`);
      while (index < format.length && /[0-9]/.test(format[index])) index++;
    }
    if (index >= format.length) throw new TypeError(`unterminated printf specifier: ${JSON.stringify(format)}`);
    if (/[hljztLI]/.test(format[index])) {
      throw new TypeError(`unsupported printf length modifier: ${JSON.stringify(format)}`);
    }
    const conversion = format[index];
    if (conversion === "d" || conversion === "i") signature.push("int");
    else if ("uoxX".includes(conversion)) signature.push("uint");
    else if ("fFeEgGaA".includes(conversion)) signature.push("double");
    else if (conversion === "c") signature.push("char");
    else if (conversion === "s") signature.push("string");
    else if (conversion === "p") signature.push("pointer");
    else throw new TypeError(`unsupported printf conversion %${conversion}: ${JSON.stringify(format)}`);
  }
  return signature;
}
