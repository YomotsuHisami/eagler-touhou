import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiPreferenceStore, uiText, UI_EXTENSION_MESSAGES, LESS_MOTION_STORAGE_KEY, DIAGNOSTICS_STORAGE_KEY } from '../app/services/ui-preferences.ts';
import { UI_LOCALE_STORAGE_KEY } from '../src/launcher/i18n.mts';
import { SITE_NOTICE_STORAGE_KEY } from '../src/launcher/site-notice.mts';

function memoryStorage(values = {}) {
  const valuesMap = new Map(Object.entries(values));
  return { getItem: key => valuesMap.get(key) ?? null, setItem: (key, value) => valuesMap.set(key, value), removeItem: key => valuesMap.delete(key), values: valuesMap };
}

test('UI preferences preserve existing keys and do not touch product data', () => {
  const productKey = 'eagler-touhou-game-options-v1-th08mp';
  const storage = memoryStorage({ [UI_LOCALE_STORAGE_KEY]: 'en', [productKey]: 'untouched' });
  const store = createUiPreferenceStore(storage);
  assert.equal(store.getSnapshot().locale, 'en');
  assert.equal(store.getSnapshot().diagnostics, null);
  assert.equal(store.getSnapshot().siteNotices, true);
  store.update({ locale: 'zh-CN', lessMotion: true, diagnostics: false, siteNotices: false });
  assert.equal(storage.getItem(UI_LOCALE_STORAGE_KEY), 'zh-CN');
  assert.equal(storage.getItem(LESS_MOTION_STORAGE_KEY), '1');
  assert.equal(storage.getItem(DIAGNOSTICS_STORAGE_KEY), '0');
  assert.equal(storage.getItem(SITE_NOTICE_STORAGE_KEY), '0');
  assert.equal(storage.getItem(productKey), 'untouched');
  store.update({ diagnostics: null });
  assert.equal(storage.getItem(DIAGNOSTICS_STORAGE_KEY), null);
  assert.equal(store.getSnapshot().diagnostics, null);
});

test('preference snapshots are stable, observable, and session-safe under denied storage', () => {
  const storage = memoryStorage(); const store = createUiPreferenceStore(storage);
  assert.equal(store.getSnapshot(), store.getSnapshot());
  let calls = 0; const unsubscribe = store.subscribe(() => { calls++; });
  store.update({ locale: 'en' }); assert.equal(calls, 1);
  store.update({ locale: 'en' }); assert.equal(calls, 1);
  storage.setItem(UI_LOCALE_STORAGE_KEY, 'zh-CN'); store.reload(); assert.equal(calls, 2);
  unsubscribe(); store.update({ lessMotion: true }); assert.equal(calls, 2);
  const denied = createUiPreferenceStore({ getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }, removeItem() { throw Error('denied'); } });
  denied.update({ locale: 'en', lessMotion: true });
  assert.equal(denied.getSnapshot().locale, 'en'); assert.equal(denied.getSnapshot().lessMotion, true);
  assert.equal(denied.getSnapshot().persistenceAvailable, false);
  assert.equal(denied.getServerSnapshot().locale, 'zh-CN');
});

test('shared and extension translation catalogs support both locales and substitutions', () => {
  assert.equal(uiText('en', 'settings.globalTitle'), 'Global settings');
  assert.equal(uiText('zh-CN', 'settings.globalTitle'), '全局设置');
  assert.equal(uiText('en', 'ui.languageUnavailable', { language: 'lang_en' }), 'Saved language lang_en is currently unavailable');
  for (const [key, translations] of Object.entries(UI_EXTENSION_MESSAGES)) {
    assert.equal(translations.length, 2, key); assert.ok(translations.every(value => typeof value === 'string' && value.length), key);
  }
});
