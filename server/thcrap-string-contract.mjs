// Source contract for non-sprite-ASCII strings_lookup() channels in the
// legacy TH06/TH07 games. stringdefs.js supplies ID -> translated UTF-8 text;
// C++ callsites retain the original fallback and ask this table by string ID.

export const THCRAP_STRING_CONTRACT = Object.freeze({
  th06: Object.freeze([
    { id: "th06 BGM In-game format", formatFallback: "♪%s" },
    { id: "th06 Bomb Reimu A" },
    { id: "th06 Bomb Reimu B" },
    { id: "th06 Bomb Marisa A" },
    { id: "th06 Bomb Marisa B" },
    { id: "th06 Stats ReimuA" },
    { id: "th06 Stats ReimuB" },
    { id: "th06 Stats MarisaA" },
    { id: "th06 Stats MarisaB" },
    // GameErrorContext::Log/Fatal. base_tsa installs
    // strings_lookup#cavesize_6 at both variadic formatter entries, so every
    // original diagnostic literal address in th06/stringlocs.v1.02h.js is part
    // of TH06's runtime string contract too.  These fallbacks were extracted
    // directly from the original v1.02h executable; keep the exact newlines
    // (and the original color-composition trailing literal 'n') so printf
    // signature validation cannot silently accept a mismatched translation.
    { id: "th06_error_two_instances", formatFallback: "二つは起動できません\n" },
    { id: "th06_log_header", formatFallback: "東方動作記録 --------------------------------------------- \n" },
    { id: "th06_log_tl_hal", formatFallback: "T&L HAL で動作しま～す\n" },
    { id: "th06_log_directsound_init", formatFallback: "DirectSound は正常に初期化されました\n" },
    { id: "th06_log_no_gamepad", formatFallback: "使えるパッドが存在しないようです、残念\n" },
    { id: "th06_log_valid_pad", formatFallback: "有効なパッドを発見しました\n" },
    { id: "th06_log_unable_to_read_file", formatFallback: "%sが読み込めないです。\n" },
    { id: "th06_log_directinput_init", formatFallback: "DirectInput は正常に初期化されました\n" },
    { id: "th06_log_sound_file_read_error", formatFallback: "error : Sound ファイルが読み込めない データを確認 %s\n" },
    { id: "th06_log_sprite_read_error", formatFallback: "スプライトアニメ %s が読み込めません。データが失われてるか壊れています\n" },
    { id: "th06_log_texture_read_error", formatFallback: "テクスチャ %s が読み込めません。データが失われてるか壊れています\n" },
    { id: "th06_log_export_failure", formatFallback: "ファイルが書き出せません %s\n" },
    { id: "th06_log_read_only_full_disk", formatFallback: "フォルダが書込み禁止属性になっているか、ディスクがいっぱいいっぱいになってませんか？\n" },
    { id: "th06_log_reinit_corrupt_config", formatFallback: "コンフィグデータが破壊されていたので再初期化しました\n" },
    { id: "th06_log_reinit_missing_config", formatFallback: "コンフィグデータが見つからないので初期化しました\n" },
    { id: "th06_log_first_startup_16bit", formatFallback: "初回起動、画面を 16Bits で初期化しました\n" },
    { id: "th06_log_first_startup_32bit", formatFallback: "初回起動、画面を 32Bits で初期化しました\n" },
    { id: "th06_log_character_init_failure", formatFallback: "error : 文字の初期化に失敗しました\n" },
    { id: "th06_log_tl_hal_unavailable", formatFallback: "T&L HAL は使用できないようです\n" },
    { id: "th06_log_hal_unavailable", formatFallback: "HAL も使用できないようです\n" },
    { id: "th06_log_backbuffer_nonlocking_suggestion", formatFallback: "バックバッファをロック不可能にしてみます\n" },
    { id: "th06_log_direct3d_init_failure", formatFallback: "Direct3D の初期化に失敗、これではゲームは出来ません\n" },
    { id: "th06_log_refresh_rate", formatFallback: "リフレッシュレートを60Hzに変更します\n" },
    { id: "th06_log_vertex", formatFallback: "頂点バッファの使用を抑制します\n" },
    { id: "th06_log_fog", formatFallback: "フォグの使用を抑制します\n" },
    { id: "th06_log_16bit_textures", formatFallback: "16Bit のテクスチャの使用を強制します\n" },
    { id: "th06_log_Gouraud_shading", formatFallback: "グーローシェーディングを抑制します\n" },
    { id: "th06_log_color_composition", formatFallback: "テクスチャの色合成を抑制しますn" },
    { id: "th06_log_rasterizer_mode", formatFallback: "リファレンスラスタライザを強制します\n" },
    { id: "th06_log_clear_buffer", formatFallback: "バックバッファの消去を強制します\n" },
    { id: "th06_log_minimum_graphics", formatFallback: "ゲーム周りのアイテムの描画を抑制します\n" },
    { id: "th06_log_depth_test", formatFallback: "デプステストを抑制します\n" },
    { id: "th06_log_force_frame", formatFallback: "６０フレーム強制モードにします\n" },
    { id: "th06_log_directinput_usage", formatFallback: "パッド、キーボードの入力に DirectInput を使用しません\n" },
    { id: "th06_log_window_mode", formatFallback: "ウィンドウモードで起動します\n" },
  ]),
  // TH07 visible general strings: the first 41 records are simple menu/Bomb
  // lookups; the Stats/Result records below intentionally retain base_tsa's
  // persistent Layout_Tabs markup for the game-side layout processor.
  th07: Object.freeze([
    { id: "th07 Key Shot" },
    { id: "th07 Key Bomb" },
    { id: "th07 Key Slow" },
    { id: "th07 Key Skip" },
    { id: "th07 Key Pause" },
    { id: "th07 Key Up" },
    { id: "th07 Key Down" },
    { id: "th07 Key Left" },
    { id: "th07 Key Right" },
    { id: "th07 Key ShotSlow" },
    { id: "th07 Key Reset" },
    { id: "th07 Key Quit" },
    { id: "th07 Option Player" },
    { id: "th07 Option Graphic" },
    { id: "th07 Option BGM" },
    { id: "th07 Option Sound" },
    { id: "th07 Option Window Mode" },
    { id: "th07 Option Slow Mode" },
    { id: "th07 Option Reset" },
    { id: "th07 Option Key Config" },
    { id: "th07 Option Quit" },
    { id: "th07 Menu Start" },
    { id: "th07 Menu Extra Start" },
    { id: "th07 Menu Practice Start" },
    { id: "th07 Menu Replay" },
    { id: "th07 Menu Result" },
    { id: "th07 Menu Music Room" },
    { id: "th07 Menu Option" },
    { id: "th07 Menu Quit" },
    { id: "th07 Bomb Reimu A unfocused" },
    { id: "th07 Bomb Reimu A focused" },
    { id: "th06 Bomb Reimu B" },
    { id: "th07 Bomb Reimu B focused" },
    { id: "th06 Bomb Marisa A" },
    { id: "th07 Bomb Marisa A focused" },
    { id: "th07 Bomb Marisa B unfocused" },
    { id: "th06 Bomb Marisa B" },
    { id: "th07 Bomb Sakuya A unfocused" },
    { id: "th07 Bomb Sakuya A focused" },
    { id: "th07 Bomb Sakuya B unfocused" },
    { id: "th07 Bomb Sakuya B focused" },
    { id: "th07 Stats Retries", formatFallback: "リトライ回数  　 %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Retries +Phantasm", formatFallback: "リトライ回数  　 %6d %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Practice", formatFallback: "プラクティス　   %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Practice +Phantasm", formatFallback: "プラクティス　   %6d %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Continue", formatFallback: "コンティニュー   %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Continue +Phantasm", formatFallback: "コンティニュー   %6d %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Clear Count", formatFallback: "クリア回数  　　 %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Clear Count +Phantasm", formatFallback: "クリア回数  　　 %6d %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Character Format", formatFallback: "%s %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Character Format +Phantasm", formatFallback: "%s %6d %6d %6d %6d %6d %6d %6d" },
    { id: "th07 Stats Play Count" },
    { id: "th07 Stats Play Count +Phantasm" },
    { id: "th07 Stats Total Playtime", formatFallback: "総プレイ時間 %.2d:%.2d:%.2d" },
    { id: "th07 Stats Time Since Startup", formatFallback: "総起動時間   %.2d:%.2d:%.2d" },
    { id: "th07 Spell Result Character Select", formatFallback: "%s %3d枚中%3d枚取得（キャラ切り替え↓↑）" },
    { id: "th07 Stats Total (All Characters)" },
    { id: "th07 Stats SakuyaB" },
    { id: "th07 Stats SakuyaA" },
    { id: "th06 Stats MarisaB" },
    { id: "th06 Stats MarisaA" },
    { id: "th06 Stats ReimuB" },
    { id: "th06 Stats ReimuA" },
    // GameErrorContext::Log/Fatal strings. base_tsa installs the generic
    // strings_lookup breakpoint directly on the fmt argument of both
    // functions, so these are part of the same runtime string contract even
    // though most are diagnostic rather than normal menu text. Keep every
    // original fallback here so the compiler rejects translations that add,
    // remove, or change printf arguments before C varargs ever see them.
    { id: "th06_log_unable_to_read_file", formatFallback: "%sが読み込めないです。\r\n" },
    { id: "th06_log_texture_read_error", formatFallback: "テクスチャ %s が読み込めません。データが失われてるか壊れています\r\n" },
    { id: "th06_log_sound_file_read_error", formatFallback: "error : Sound ファイルが読み込めない データを確認 %s\r\n" },
    { id: "th06_log_directsound_init", formatFallback: "DirectSound は正常に初期化されました\r\n" },
    { id: "th06_log_read_only_full_disk", formatFallback: "フォルダが書込み禁止属性になっているか、ディスクがいっぱいいっぱいになってませんか？\r\n" },
    { id: "th06_log_export_failure", formatFallback: "ファイルが書き出せません %s\r\n" },
    { id: "th07_log_Vsync", formatFallback: "垂直同期を取りません\r\n" },
    { id: "th07_log_BGM_memory", formatFallback: "ＢＧＭをメモリに読み込みます\r\n" },
    { id: "th07_log_draw_screen", formatFallback: "画面周りを毎回描画します\r\n" },
    { id: "th06_log_directinput_usage", formatFallback: "パッド、キーボードの入力に DirectInput を使用しません\r\n" },
    { id: "th06_log_rasterizer_mode", formatFallback: "リファレンスラスタライザを強制します\r\n" },
    { id: "th06_log_window_mode", formatFallback: "ウィンドウモードで起動します\r\n" },
    { id: "th06_log_color_composition", formatFallback: "テクスチャの色合成を抑制しますn" },
    { id: "th06_log_depth_test", formatFallback: "デプステストを抑制します\r\n" },
    { id: "th06_log_Gouraud_shading", formatFallback: "グーローシェーディングを抑制します\r\n" },
    { id: "th06_log_minimum_graphics", formatFallback: "ゲーム周りのアイテムの描画を抑制します\r\n" },
    { id: "th06_log_16bit_textures", formatFallback: "16Bit のテクスチャの使用を強制します\r\n" },
    { id: "th06_log_fog", formatFallback: "フォグの使用を抑制します\r\n" },
    { id: "th06_log_vertex", formatFallback: "頂点バッファの使用を抑制します\r\n" },
    { id: "th07_log_reinit_abnormal_config", formatFallback: "コンフィグデータが異常でしたので再初期化しました\r\n" },
    { id: "th06_log_reinit_missing_config", formatFallback: "コンフィグデータが見つからないので初期化しました\r\n" },
    { id: "th06_log_character_init_failure", formatFallback: "error : 文字の初期化に失敗しました\r\n" },
    { id: "th06_log_valid_pad", formatFallback: "有効なパッドを発見しました\r\n" },
    { id: "th06_log_directinput_init", formatFallback: "DirectInput は正常に初期化されました\r\n" },
    { id: "th06_error_two_instances", formatFallback: "二つは起動できません\r\n" },
    { id: "th06_log_tl_hal", formatFallback: "T&L HAL で動作しま～す\r\n" },
    { id: "th06_log_direct3d_init_failure", formatFallback: "Direct3D の初期化に失敗、これではゲームは出来ません\r\n" },
    { id: "th07_log_refresh_rate_suggestion", formatFallback: "*** リフレッシュレートを60Hzに変更することを推奨します ***\r\n" },
    { id: "th07_log_async_update_failure", formatFallback: "非同期更新も行えません。一番汚いモードに変更します\r\n" },
    { id: "th06_log_hal_unavailable", formatFallback: "HAL も使用できないようです\r\n" },
    { id: "th06_log_tl_hal_unavailable", formatFallback: "T&L HAL は使用できないようです\r\n" },
    { id: "th07_log_async_vsync_test", formatFallback: "VSync非同期可能かどうかを試みます\r\n" },
    { id: "th06_log_first_startup_32bit", formatFallback: "初回起動、画面を 32Bits で初期化しました\r\n" },
    { id: "th06_log_no_gamepad", formatFallback: "使えるパッドが存在しないようです、残念\r\n" },
    { id: "th06_log_header", formatFallback: "東方動作記録 --------------------------------------------- \r\n" },
  ]),
});

export function validateStringContract(game) {
  const records = THCRAP_STRING_CONTRACT[game];
  if (!records) throw new TypeError(`unsupported string contract game: ${game}`);
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record.id !== "string" || !record.id)
      throw new TypeError(`${game}: invalid strings contract record`);
    if (ids.has(record.id)) throw new TypeError(`${game}: duplicate strings contract ID: ${record.id}`);
    ids.add(record.id);
    if (record.formatFallback !== undefined && typeof record.formatFallback !== "string")
      throw new TypeError(`${game}: invalid formatFallback for ${record.id}`);
  }
  return { records, ids };
}
