/** Pure, opt-in deployment support for the React entry.
 * No registration, cache writes, network, history mutation, or publication.
 * The caller derives patterns from app/routes.ts and supplies catalog policy.
 * Existing asset/Runtime responses take precedence over shell fallback.
 */
export const UI_DEPLOYMENT_SCHEMA = 'eagler-touhou/ui-deployment/1';
export const UI_LEGACY_ENTRIES = Object.freeze(['/index.html', '/en.html', '/lobby.html']);
export const UI_RESOURCE_PREFIXES = Object.freeze([
  '/games/', '/shared/', '/runtime/', '/assets/', '/packages/', '/language-packs/',
  '/vendor/', '/content/', '/legacy/', '/pwa/',
]);
export const UI_LOCALE_QUERY = 'uiLocale';
const scalar = /^[A-Za-z0-9_-]+$/;

/** Decode before matching. Do not accept traversal, hidden paths or separators
 * meaningful to a filesystem but not to the URL route contract. */
export function decodeUiDeploymentPath(value) {
  if (typeof value !== 'string') return null;
  try {
    const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    if (!pathname.startsWith('/') || /[\\\0]/.test(pathname) || pathname.split('/').some(part => part.startsWith('.'))) return null;
    return pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  } catch { return null; }
}
function mountPath(value) {
  if (typeof value !== 'string' || /[?#%]/.test(value)) throw new Error('UI mount must be an absolute decoded pathname');
  const path = decodeUiDeploymentPath(value);
  if (!path || path !== (value.replace(/\/$/, '') || '/')) throw new Error('UI mount must have canonical path segments');
  return path === '/' ? '/' : `${path}/`;
}
function reserved(path) {
  return UI_RESOURCE_PREFIXES.some(prefix => path === prefix.slice(0, -1) || path.startsWith(prefix));
}
function validatePatterns(patterns) {
  if (!Array.isArray(patterns) || !patterns.length || !patterns.includes('/')) throw new Error('UI navigation must include its library root');
  const checked = patterns.map(pattern => {
    if (typeof pattern !== 'string' || !pattern.startsWith('/') || pattern !== (pattern.replace(/\/$/, '') || '/') ||
        pattern.includes('//') || reserved(pattern)) throw new Error(`Invalid or reserved UI route: ${String(pattern)}`);
    if (UI_LEGACY_ENTRIES.includes(pattern)) return pattern;
    if (pattern !== '/' && pattern.slice(1).split('/').some(part => !scalar.test(part.startsWith(':') ? part.slice(1) : part))) {
      throw new Error(`UI routes require exact segments or named parameters: ${pattern}`);
    }
    return pattern;
  });
  return Object.freeze([...new Set(checked)].sort());
}

/** Serializable input for static-server and single-SW navigation wiring.
 * No fallback is granted for resource prefixes, unknown routes or missing bytes. */
export function createUiDeploymentContract({patterns, mountPath: mount = '/', legacyEntries = UI_LEGACY_ENTRIES} = {}) {
  const normalizedMount = mountPath(mount);
  if (!Array.isArray(legacyEntries) || legacyEntries.some(path => !UI_LEGACY_ENTRIES.includes(path))) throw new Error('Unsupported legacy UI entry');
  return Object.freeze({
    schema: UI_DEPLOYMENT_SCHEMA,
    mountPath: normalizedMount,
    shellPath: `${normalizedMount}index.html`,
    patterns: validatePatterns(patterns),
    legacyEntries: Object.freeze([...new Set(legacyEntries)].sort()),
    resourcePrefixes: UI_RESOURCE_PREFIXES,
    missingAssetPolicy: '404',
    externalResourcePrefixes: Object.freeze(['/games/', '/shared/']),
  });
}
function validContract(contract) {
  if (contract?.schema !== UI_DEPLOYMENT_SCHEMA) throw new Error('Unsupported UI deployment contract');
  // Deserialized contracts need the same checks as in-process creation.
  return createUiDeploymentContract(contract);
}
function relativePath(pathname, contract) {
  const path = decodeUiDeploymentPath(pathname);
  if (!path) return null;
  const base = contract.mountPath;
  if (base === '/') return path;
  if (path === base.slice(0, -1)) return '/';
  return path.startsWith(base) ? `/${path.slice(base.length)}` : null;
}
function exactMatch(path, pattern) {
  if (path === pattern) return true;
  if (path.includes('.')) return false;
  const actual = path.split('/'), expected = pattern.split('/');
  return actual.length === expected.length && expected.every((part, index) => part.startsWith(':') ? scalar.test(actual[index]) : part === actual[index]);
}
export function isUiDeploymentNavigation(pathname, contract) {
  const checked = validContract(contract), path = relativePath(pathname, checked);
  return !!path && !reserved(path) && (checked.legacyEntries.includes(path) || checked.patterns.some(pattern => exactMatch(path, pattern)));
}

function scopedUrl(input, scopeUrl) {
  let scope;
  try { scope = new URL(scopeUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(scope.protocol) || scope.username || scope.password || scope.search || scope.hash || !scope.pathname.endsWith('/')) return null;
  let rawPath, url;
  try {
    const source = input instanceof URL ? input.href : String(input);
    if (source.startsWith('/')) { rawPath = source; url = new URL(scope.origin + source); }
    else {
      const match = /^https?:\/\/[^/?#]+(\/[^?#]*)?(?:[?#]|$)/i.exec(source);
      if (!match) return null;
      rawPath = match[1] || '/'; url = new URL(source);
    }
    if (!decodeUiDeploymentPath(rawPath) || url.origin !== scope.origin || url.username || url.password) return null;
    return {url, scope};
  } catch { return null; }
}
function acceptsHtml(header) {
  return String(header || '').split(',').some(entry => {
    const [type, ...parameters] = entry.trim().toLowerCase().split(';');
    if (type.trim() !== 'text/html') return false;
    const quality = parameters.find(parameter => /^\s*q\s*=/.test(parameter));
    return !quality || Number(quality.split('=')[1]) > 0;
  });
}

/** Return the existing shell cache key for a known navigation, otherwise null.
 * A SW should call only after Runtime handling. A static server should call only
 * after checking existing files. This never turns missing JS/WASM/DATA into HTML.
 * Request-like data is accepted so this can run in a worker without Node or DOM. */
export function uiNavigationFallback(request, {contract, scopeUrl}) {
  const checked = validContract(contract), parsed = scopedUrl(request?.url ?? request, scopeUrl);
  if (!parsed || mountPath(parsed.scope.pathname) !== checked.mountPath) return null;
  const method = String(request?.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) return null;
  const destination = request?.destination || '';
  if (destination && destination !== 'document') return null;
  const accept = request?.headers?.get?.('accept') ?? request?.accept ?? '';
  if (request?.mode !== 'navigate' && !acceptsHtml(accept)) return null;
  return isUiDeploymentNavigation(parsed.url.pathname, checked) ? new URL(checked.shellPath, parsed.scope.origin).href : null;
}

/** Legacy links remain selected-product/room intents, never launch commands.
 * `catalog` supplies existing Product Catalog functions and default identity.
 * `normalizeRoomCode` is the existing route-state helper, passed explicitly to
 * avoid shipping its obsolete history operations in a worker-only helper graph.
 * `savedRoom` must be a normalized value from multiplayer-room-session.load(). */
export function resolveLegacyUiEntry(input, {
  baseUrl, catalog, normalizeRoomCode, testBuild = false, savedRoom = null,
} = {}) {
  if (!catalog || typeof normalizeRoomCode !== 'function') throw new Error('Existing product and room policy owners are required');
  for (const name of ['isProductId', 'isMultiplayerProductId', 'productEnabledForBuild', 'multiplayerConfigForProduct']) {
    if (typeof catalog[name] !== 'function') throw new Error(`Missing Product Catalog policy: ${name}`);
  }
  const parsed = scopedUrl(input, baseUrl);
  if (!parsed) return null;
  const {url, scope} = parsed, base = mountPath(scope.pathname);
  const path = relativePath(url.pathname, {mountPath: base});
  if (path !== '/' && !UI_LEGACY_ENTRIES.includes(path)) return null;
  const params = new URLSearchParams(url.search);
  const permitted = id => catalog.isProductId(id) && catalog.productEnabledForBuild(id, testBuild);
  const requested = params.get('game') || '';
  const product = permitted(requested) ? requested : null;
  const english = path === '/en.html';
  // The explicit English document remains English across a canonical-route
  // reload. This is only a migrated locale hint: translated React strings and
  // the locale provider are separate unfinished work, not activated here.
  const locale = english ? 'en' : params.get(UI_LOCALE_QUERY) === 'en' ? 'en' : 'zh-CN';
  if (english) params.set(UI_LOCALE_QUERY, 'en');
  const result = (kind, target, details = {}) => {
    const destination = new URL(`${base}${target}`, scope.origin);
    destination.search = params.toString(); destination.hash = url.hash;
    return Object.freeze({kind, locale, to: `${destination.pathname}${destination.search}${destination.hash}`,
      href: destination.href, replace: true, autoLaunch: false, ...details});
  };
  if (path === '/lobby.html') {
    const filter = product && catalog.isMultiplayerProductId(product) ? product : null;
    if (!filter) params.delete('game');
    return result('lobby', 'lobby', {productId: filter});
  }
  const roomCode = normalizeRoomCode(params.get('mpRoom'));
  if (roomCode) {
    const roomProduct = product && catalog.isMultiplayerProductId(product) ? product : catalog.DEFAULT_MULTIPLAYER_PRODUCT_ID;
    if (!permitted(roomProduct) || !catalog.isMultiplayerProductId(roomProduct)) throw new Error('Default multiplayer product is unavailable');
    const policy = catalog.multiplayerConfigForProduct(roomProduct);
    if (!policy?.playerCounts?.length || !policy.difficulties?.length) throw new Error('Multiplayer product has no room policy');
    const fromLobby = params.get('fromLobby') === '1';
    const action = fromLobby && ['create', 'join'].includes(params.get('lobbyAction')) ? params.get('lobbyAction') : null;
    const created = action === 'create';
    const saved = savedRoom?.product === roomProduct && savedRoom?.room?.code === roomCode ? savedRoom : null;
    const requestedCount = Number(params.get('lobbyPlayers'));
    const count = created && policy.playerCounts.includes(requestedCount) ? requestedCount : policy.playerCounts[0];
    const requestedDifficulty = Math.trunc(Number(params.get('lobbyDifficulty')) || 0);
    const difficulty = created ? Math.max(0, Math.min(policy.difficulties.length - 1, requestedDifficulty)) : 1;
    const room = Object.freeze({
      code: roomCode,
      playerCount: saved ? saved.room.playerCount : count,
      difficulty: saved ? saved.room.difficulty : difficulty,
      created: created || saved?.room?.created === true,
      visibility: saved?.room?.visibility ?? (params.get('lobbyVisibility') === 'private' ? 'private' : 'public'),
      disableCheatMovement: saved?.room?.disableCheatMovement ?? params.get('lobbyDisableCheatMovement') === '1',
      seat: saved?.seat ?? (created ? 0 : null),
      ready: saved?.ready === true,
      spectatorRequested: saved?.spectatorRequested === true,
      roomSettingsOpen: saved?.roomSettingsOpen === true,
    });
    params.delete('game'); params.set('mpRoom', roomCode);
    // These transport/creation hints remain until actual room join succeeds.
    // The room owner, not this parser, acknowledges and clears them.
    return result('room', `play/${roomProduct}`, {productId: roomProduct, room,
      returnToDirectory: fromLobby, directoryAction: action, autoSeat: fromLobby && action === 'join'});
  }
  params.delete('game');
  return product ? result('product', `play/${product}`, {productId: product}) : result('library', '', {productId: null});
}
