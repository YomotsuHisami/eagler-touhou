from pathlib import Path

def replace(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    assert text.count(old) == 1, (path, old[:80], text.count(old))
    p.write_text(text.replace(old, new), encoding='utf-8')

replace('src/launcher/app.mts', 'if (!languageCatalog("th07").some(entry => entry.id === value)) return;', 'if (!languageCatalog(state.game).some(entry => entry.id === value)) return;')
replace('src/launcher/multiplayer-identity.mts', '''  const lobbyClientId = (product: string): string => {
    const key = multiplayerLobbyClientStorageKey(product);''', '''  // Session storage persists across reloads; memory is the authority within
  // this document, including when storage is absent or a write fails.
  const clientIds = new Map<string, string>();
  const rememberClientId = (product: string, value: string): string => {
    clientIds.set(product, value);
    return value;
  };
  const lobbyClientId = (product: string): string => {
    const remembered = clientIds.get(product);
    if (remembered) return remembered;
    const key = multiplayerLobbyClientStorageKey(product);''')
replace('src/launcher/multiplayer-identity.mts', 'if (validMultiplayerClientId(existing)) return existing;', 'if (validMultiplayerClientId(existing)) return rememberClientId(product, existing);')
replace('src/launcher/multiplayer-identity.mts', '''      sessionStorage?.setItem(key, value);
      return value;
    } catch {
      return fallbackClientId();''', '''      rememberClientId(product, value);
      sessionStorage?.setItem(key, value);
      return value;
    } catch {
      return clientIds.get(product) || rememberClientId(product, fallbackClientId());''')
p = Path('tests/test-multiplayer-identity.mjs')
p.write_text(p.read_text(encoding='utf-8') + '''
// Reconnection must not create a new participant when storage is unavailable.
for (const sessionStorage of [null, hostile, {
  getItem() { return null; },
  setItem() { throw new Error("write unavailable"); },
}]) {
  let serial = 0;
  const isolated = createMultiplayerIdentityStore({
    persistentStorage: null,
    sessionStorage,
    randomWords: () => [++serial, 0],
    fallbackClientId: () => `fallback_${++serial}`,
  });
  const first = isolated.lobbyClientId("th06mp");
  assert.equal(isolated.lobbyClientId("th06mp"), first);
  const other = isolated.lobbyClientId("th07mp");
  assert.notEqual(other, first);
  assert.equal(isolated.lobbyClientId("th07mp"), other);
}
console.log("Multiplayer identity without session storage: PASS");
''', encoding='utf-8')
print('Applied AUD-11 and AUD-17. AUD-01 remains unchanged.')
