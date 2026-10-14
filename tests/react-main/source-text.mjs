import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
/** Git blobs use LF even when the Windows checkout uses CRLF. */
export const normalizeSourceText = value => value.replaceAll('\r\n', '\n');
let originalUiKeys;
/** New redesign messages may be added; every upstream message and the catalog
 * implementation still remain pinned. The key set comes from the upstream blob. */
export function pinnedUiAuthorityText(value) {
  const source = normalizeSourceText(value);
  if(!source.includes('export const UI_LOCALES'))return source;
  originalUiKeys ??= new Set([...synchronizedMainAuthority('src/launcher/i18n.mts',fileURLToPath(new URL('../../',import.meta.url)),'edee9633e5e3ee79cd2e1aa334f84f6caf755090').matchAll(/\["([^"]+)",/g)].map(match=>match[1]));
  return source.replace(/^  \["([^"]+)".*\n/gm,(line,key)=>originalUiKeys.has(key) ? line : '').replace('const entries = [\n\n','const entries = [\n');
}

/** Domain authorities are pinned to the main commit merged into this branch,
 * including versioned resource slots. Never derive the oracle from candidate source. */
export function synchronizedMainAuthority(path, project, fallbackRevision) {
  const domain = ['src/contracts/product-catalog.mts', 'src/launcher/i18n.mts', 'src/launcher/multiplayer-guide.mts', 'public/content/MULTIPLAYER.html'].includes(path);
  const revision = domain ? 'b479f0a68c573735091cba01544a51bb84248bb1' : fallbackRevision;
  let source = execFileSync('git', ['show', `${revision}:${path}`], {cwd: project, encoding: 'utf8'});
  if (path === 'src/launcher/i18n.mts') source = source.replace(
    '  ["multiplayer.nameOneTimeHint", "昵称只能设置一次，保存后不可修改", "Your nickname can be saved only once and cannot be changed later"],',
    '  ["multiplayer.nameEditableHint", "昵称可随时修改，保存后立即生效", "You can change your nickname at any time; changes take effect immediately"],');
  // The migrated room owner fixes enabled rollback to zero input-delay frames.
  // These explicit newer messages are the expected copy, not candidate-derived.
  if(path === 'src/launcher/i18n.mts')source = source.replace(
    '["room.enableRollback", "启用回滚（显著降低输入延迟，但造成很大的卡顿）", "Rollback"]',
    '["room.enableRollback", "启用回滚(降低输入延迟，需要更高的性能)", "Enable rollback (lower input delay, requires higher performance)"]').replace(
    '["room.rollbackHint", "开启时使用预测和回滚；关闭时等待真实输入。输入延迟独立设置，开局后固定。", "On: predict and roll back. Off: wait for actual inputs. Input delay is independent; both settings are fixed once the game starts."]',
    '["room.rollbackHint", "开启后输入延迟固定为 0 帧；关闭后使用所选输入延迟。开局后设置固定。", "When enabled, input delay is fixed at 0 frames. When disabled, use the selected input delay. Settings are fixed once the game starts."]');
  return source.replaceAll("eagler-touhou/host-manifest/1", "eagler-touhou/site-manifest/1").replaceAll("Host Manifest", "Site Manifest").replaceAll("Host manifest", "Site manifest").replaceAll("Host 清单", "站点清单");
}
