import {test as base, expect, type Page} from '@playwright/test';
import type {} from './runtime-controls-fixture';

// This suite exercises the real React/Router/Radix controls against a controlled
// fake service and an empty iframe. It is not game, persistence, or device QA.
const origin = process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175';
const fixtureUrl = `${origin}/__ui_tests__/runtime-controls.html`;
const test = base.extend<{browserErrors: string[]}>({browserErrors: [async ({page}, use) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await use(errors);
  expect(errors).toEqual([]);
}, {auto: true}]});

async function start(page: Page, phase: 'loading' | 'configuring' | 'prepared' | 'launching' | 'running' | 'error' = 'running') {
  await page.evaluate(phase => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-synthetic-runtime-frame]');
    const markers = window as unknown as {syntheticFrame: HTMLIFrameElement | null; syntheticFrameDocument: Document | null};
    markers.syntheticFrame = frame;
    markers.syntheticFrameDocument = frame?.contentDocument ?? null;
    window.__runtimeControlsFixture.start(phase);
  }, phase);
  await expect(page.getByRole('toolbar', {name: '游戏会话控制'})).toBeVisible();
}
async function sameFrame(page: Page) {
  expect(await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-synthetic-runtime-frame]');
    const markers = window as unknown as {syntheticFrame: HTMLIFrameElement | null; syntheticFrameDocument: Document | null};
    return {frame: markers.syntheticFrame === frame, document: markers.syntheticFrameDocument !== null && markers.syntheticFrameDocument === frame?.contentDocument};
  })).toEqual({frame: true, document: true});
  await expect(page.locator('[data-synthetic-runtime-frame]')).toHaveCount(1);
}
async function requestNavigation(page: Page, destination = '/play/th07') {
  await page.evaluate(destination => window.__runtimeControlsFixture.navigate(destination), destination);
  await expect(page.getByRole('dialog', {name: '结束当前游戏？'})).toBeVisible();
  await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06');
}
async function beginSave(page: Page) {
  const confirm=page.getByRole('button', {name: '保存并退出', exact: true});
  if(await confirm.count()&&await confirm.isEnabled())await confirm.click();
  await expect(page.getByRole('button', {name: '正在保存…', exact: true})).toBeDisabled();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().syncPending)).toBe(true);
}

test.beforeEach(async ({page}) => {
  await page.goto(fixtureUrl);
  await expect(page.getByRole('heading', {name: 'Synthetic Runtime controls fixture, no game execution'})).toBeVisible();
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/play/th06'));
  await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06');
});

test('synthetic running toolbar Help query, Back, and Forward retain the same iframe', async ({page}) => {
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/play/th06?filter=single#details'));
  await start(page);
  await page.getByRole('link', {name: '游戏操作说明', exact: true}).click();
  await expect(page.getByRole('dialog', {name: '帮助', exact: true})).toBeVisible();
  await expect(page).toHaveURL(`${origin}/play/th06?filter=single&panel=help#details`);
  await sameFrame(page);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(`${origin}/play/th06?filter=single#details`);
  await expect(page.getByRole('link', {name: '游戏操作说明', exact: true})).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('dialog', {name: '帮助', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/play/th06?filter=single#details`);
  await expect(page.getByRole('link', {name: '游戏操作说明', exact: true})).toBeFocused();
  await sameFrame(page);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(0);
});

test('synthetic library-origin Runtime uses the single global Help panel without closing its session', async ({page}) => {
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/?filter=single#library'));
  await start(page);
  await page.getByRole('link', {name: '游戏操作说明', exact: true}).click();
  await expect(page.getByRole('dialog', {name: '帮助', exact: true})).toHaveCount(1);
  await expect(page).toHaveURL(`${origin}/?filter=single&panel=help#library`);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(`${origin}/?filter=single#library`);
  await expect(page.getByRole('link', {name: '游戏操作说明', exact: true})).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('dialog', {name: '帮助', exact: true})).toHaveCount(1);
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/?filter=single#library`);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('running');
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(0);
  await sameFrame(page);
});

for (const phase of ['loading', 'configuring', 'prepared', 'launching', 'running', 'error'] as const) {
  test(`main ${phase} departure saves automatically and only a failure asks whether to stay`, async ({page}) => {
    await start(page, phase);
    if (phase === 'prepared') await expect(page.getByRole('toolbar')).toContainText('准备完成，尚未启动');
    if(phase==='loading') {await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/play/th07'));await expect(page).toHaveURL(`${origin}/play/th07`);expect((await page.evaluate(()=>window.__runtimeControlsFixture.inspect())).calls.sync).toBe(0);return;}
    await requestNavigation(page);await beginSave(page);await page.evaluate(()=>window.__runtimeControlsFixture.rejectSync());
    await page.getByRole('button', {name: '留在游戏中', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('synthetic-phase')).toHaveText(phase);
    await requestNavigation(page, '/');await beginSave(page);await page.evaluate(()=>window.__runtimeControlsFixture.resolveSync());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(`${origin}/`);
    await sameFrame(page);
    expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(2);
  });
}

test('synthetic preparation closes before product navigation without inventing a save', async ({page}) => {
  await start(page, 'loading');
  await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/play/th07'));
  await expect(page).toHaveURL(`${origin}/play/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 1, sync: 0, discard: 0, completed: 1});
  await sameFrame(page);
});

test('synthetic configuring Runtime is already ready and must sync before closing', async ({page}) => {
  await start(page, 'configuring');
  await requestNavigation(page);
  await beginSave(page);
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page).toHaveURL(`${origin}/play/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.sync)).toBe(1);
  await sameFrame(page);
});

test('synthetic save-and-close is single-flight and advances only after sync succeeds', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await page.evaluate(()=>{const button=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-runtime-toolbar] button')).find(button=>button.textContent==='退出游戏');button?.click();button?.click();});
  await expect(page.getByRole('button', {name: '正在保存…', exact: true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(`${origin}/play/th06`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(1);
  await sameFrame(page);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page).toHaveURL(`${origin}/play/th07`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('idle');
  await sameFrame(page);
});

test('synthetic save failure keeps the session; retry saves before proceeding', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.rejectSync());
  await expect(page.getByRole('dialog', {name: '保存未完成'})).toBeVisible();
  await expect(page.getByTestId('synthetic-phase')).toHaveText('running');
  await expect(page.locator('[data-synthetic-runtime-frame]')).toHaveAttribute('data-synthetic-session', 'active');
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await page.getByRole('button', {name: '重试保存并退出', exact: true}).click();
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page).toHaveURL(`${origin}/play/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 2, sync: 2, discard: 0, completed: 1});
  await sameFrame(page);
});

test('synthetic failed save can stay without losing the frame or navigation ownership', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.rejectSync());
  await page.getByRole('button', {name: '留在游戏中', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('running');
  await sameFrame(page);
  await page.getByRole('button', {name: '退出游戏', exact: true}).click();
  await beginSave(page);await page.evaluate(()=>window.__runtimeControlsFixture.rejectSync());await expect(page.getByRole('dialog', {name: '保存未完成'})).toBeVisible();
  await page.getByRole('button', {name: '留在游戏中', exact: true}).click();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(2);
});

test('synthetic explicit discard is offered only after failure and never claims a save', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await expect(page.getByRole('button', {name: '不保存退出', exact: true})).toHaveCount(0);
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.rejectSync());
  await page.getByRole('button', {name: '不保存退出', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/play/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 2, sync: 1, discard: 1, completed: 1});
  await sameFrame(page);
});

test('synthetic successful sync with failed cleanup is an exit failure, not a save failure', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await page.evaluate(() => window.__runtimeControlsFixture.failNextClose());
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page.getByRole('dialog', {name: '退出未完成', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: '重试退出', exact: true})).toBeEnabled();
  await expect(page.getByRole('button', {name: '重试保存并退出', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '不保存退出', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '确认丢失风险并离开', exact: true})).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/play/th06`);
  expect(await page.evaluate(() => {
    const {snapshot} = window.__runtimeControlsFixture.inspect();
    return {retained: snapshot.epoch !== null, ready: snapshot.ready, saveError: snapshot.saveError,
      saveUnavailable: snapshot.saveUnavailable, closeError: !!snapshot.closeError};
  })).toEqual({retained: true, ready: true, saveError: null, saveUnavailable: false, closeError: true});
  await page.getByRole('button', {name: '重试退出', exact: true}).click();
  await expect(page.getByRole('button', {name: '正在保存…', exact: true})).toBeDisabled();
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page).toHaveURL(`${origin}/play/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 2, sync: 2, discard: 0, completed: 1});
  await sameFrame(page);
});

test('synthetic lost document with retained cleanup epoch cannot retry saving or bypass failed cleanup', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.abnormalExit('Synthetic lost document', true));
  await expect(page.getByRole('dialog', {name: '游戏已结束，保存未完成'})).toBeVisible();
  await expect(page.getByRole('button', {name: '重试保存并退出', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '重试退出', exact: true})).toHaveCount(0);
  expect(await page.evaluate(() => {
    const {snapshot} = window.__runtimeControlsFixture.inspect();
    return {retained: snapshot.epoch !== null, ready: snapshot.ready, saveUnavailable: snapshot.saveUnavailable,
      saveError: !!snapshot.saveError, closeError: !!snapshot.closeError};
  })).toEqual({retained: true, ready: false, saveUnavailable: true, saveError: true, closeError: true});
  await page.evaluate(() => window.__runtimeControlsFixture.failNextClose('Synthetic cleanup still unavailable'));
  await page.getByRole('button', {name: '确认丢失风险并离开', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('Synthetic cleanup still unavailable');
  await expect(page).toHaveURL(`${origin}/play/th06`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.sync)).toBe(1);
  await page.getByRole('button', {name: '确认丢失风险并离开', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/play/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 3, sync: 1, discard: 2, completed: 1});
  await sameFrame(page);
});

test('synthetic successful native exit with failed cleanup retries only exit without inventing loss', async ({page}) => {
  await start(page);
  await page.evaluate(() => window.__runtimeControlsFixture.successfulExit(true));
  await page.evaluate(()=>window.__runtimeControlsFixture.failNextClose());await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/play/th07'));
  await expect(page.getByRole('dialog', {name: '退出未完成', exact: true})).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('不会再次保存');
  await expect(page.getByRole('button', {name: '重试保存并退出', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '不保存退出', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '确认丢失风险并离开', exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: '重试退出', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/play/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 2, sync: 0, discard: 0, completed: 1});
  await sameFrame(page);
});

test('synthetic fully cleaned successful exit needs no further save or cleanup decision', async ({page}) => {
  await start(page);
  await page.evaluate(() => window.__runtimeControlsFixture.successfulExit());
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/play/th07'));
  await expect(page).toHaveURL(`${origin}/play/th07`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 0, sync: 0, discard: 0, completed: 0});
  await sameFrame(page);
});

test('synthetic native exit during sync requires explicit loss acknowledgment before leaving', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.abnormalExit());
  await expect(page.getByRole('dialog', {name: '游戏已结束，保存未完成'})).toBeVisible();
  await expect(page.getByRole('button', {name: '重试保存并退出', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '确认离开', exact: true})).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText('无法再重试保存');
  await expect(page).toHaveURL(`${origin}/play/th06`);
  expect(await page.evaluate(() => {
    const {snapshot, calls} = window.__runtimeControlsFixture.inspect();
    return {epoch: snapshot.epoch, ready: snapshot.ready, saveError: !!snapshot.saveError, completed: calls.completed};
  })).toEqual({epoch: null, ready: false, saveError: true, completed: 0});
  await page.getByRole('button', {name: '留在此页', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('toolbar')).toContainText('游戏已意外结束');
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/play/th07'));
  await expect(page.getByRole('dialog', {name: '游戏已结束，保存未完成'})).toBeVisible();
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await page.getByRole('button', {name: '确认丢失风险并离开', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/play/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 2, sync: 1, discard: 1, completed: 1});
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await sameFrame(page);
});

test('synthetic lost-session completion cannot approve a newer navigation destination', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => {
    void window.__runtimeControlsFixture.navigate('/play/th08');
    window.__runtimeControlsFixture.abnormalExit();
  });
  await expect(page.getByRole('dialog', {name: '游戏已结束，保存未完成'})).toContainText('目标页面：/play/th08');
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await page.getByRole('button', {name: '确认丢失风险并离开', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/play/th08`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.sync)).toBe(1);
  await sameFrame(page);
});

test('synthetic toolbar exit shares the guarded save path and stays on its route', async ({page}) => {
  await start(page, 'error');
  await page.getByRole('button', {name: '退出游戏', exact: true}).click();
  await beginSave(page);await page.evaluate(()=>window.__runtimeControlsFixture.rejectSync());await page.getByRole('button', {name: '留在游戏中', exact: true}).click();
  await expect(page.getByRole('button', {name: '退出游戏', exact: true})).toBeFocused();
  await page.getByRole('button', {name: '退出游戏', exact: true}).click();
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.rejectSync('Synthetic recovery save failed'));
  await expect(page.getByTestId('synthetic-phase')).toHaveText('error');
  await page.getByRole('button', {name: '重试保存并退出', exact: true}).click();
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await expect(page.locator('#main-content')).toBeFocused();
  await start(page);
  await page.getByRole('button', {name: '退出游戏', exact: true}).click();
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.rejectSync());
  await page.getByRole('button', {name: '不保存退出', exact: true}).click();
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await sameFrame(page);
});

test('automatic save completion follows the latest destination and never the obsolete one', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/play/th08'));
  await expect(page.getByRole('dialog')).toContainText('目标页面：/play/th08');
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page).toHaveURL(`${origin}/play/th08`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(1);
  await sameFrame(page);
});

test('synthetic newer Help navigation invalidates an in-flight destination before React commits', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  // Deliberately resolve in the same task as navigate: an effect-only ticket
  // check would permit the stale th07 destination through this race.
  await page.evaluate(() => {
    void window.__runtimeControlsFixture.navigate('/play/th06?panel=help');
    window.__runtimeControlsFixture.resolveSync();
  });
  await expect(page).toHaveURL(`${origin}/play/th06?panel=help`);
  await expect(page.getByRole('dialog', {name: '结束当前游戏？'})).toHaveCount(0);
  await expect(page.getByRole('dialog', {name: '帮助', exact: true})).toBeVisible();
  await sameFrame(page);
});

test('main automatic save completion can return to the latest library destination', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => {
    void window.__runtimeControlsFixture.navigate('/');
    window.__runtimeControlsFixture.resolveSync();
  });
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('synthetic old Cancel cannot erase a newer blocked navigation before React commits', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);await page.evaluate(()=>window.__runtimeControlsFixture.rejectSync());
  await page.getByRole('button', {name: '留在游戏中', exact: true}).evaluate((button: HTMLButtonElement) => {
    void window.__runtimeControlsFixture.navigate('/play/th08');
    button.click();
  });
  await expect(page.getByRole('dialog')).toContainText('目标页面：/play/th08');
  await beginSave(page);await page.evaluate(()=>window.__runtimeControlsFixture.rejectSync());await page.getByRole('button', {name: '留在游戏中', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await sameFrame(page);
});

test('synthetic replacement owner does not inherit a pending close or stale completion', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => {
    window.__runtimeControlsFixture.replaceOwner();
    window.__runtimeControlsFixture.start('running');
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', {name: '退出游戏', exact: true}).click();
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.resolvePreviousSync());
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('saving');
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('idle');
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await sameFrame(page);
});

test('main Player Back saves automatically before product Back and Forward stays Router-owned', async ({page}) => {
  // Real Link clicks create the user-initiated entries this flow must traverse.
  await page.getByRole('link', {name: 'Synthetic TH07', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/play/th07`);
  await page.getByRole('link', {name: 'Synthetic TH06', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06');
  const entriesBeforeStart = await page.evaluate(() => window.history.length);
  await start(page);
  await sameFrame(page);
  await expect.poll(()=>page.evaluate(()=>window.history.length)).toBe(entriesBeforeStart+1);
  // Numeric Router navigation traverses createBrowserRouter's real browser
  // history. Trigger only; page.goBack() would wait for a navigation/load event
  // that a blocked, immediately restored POP need not emit in WebKit. Observe
  // the decision and settled URL instead of returning a navigation promise.
  await page.evaluate(() => {void window.__runtimeControlsFixture.navigate(-1);});
  await expect(page.getByRole('dialog', {name: '结束当前游戏？'})).toBeVisible();
  await beginSave(page);await page.evaluate(()=>window.__runtimeControlsFixture.resolveSync());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('idle');
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(1);
  await page.evaluate(() => {void window.__runtimeControlsFixture.navigate(-1);});
  await expect(page).toHaveURL(`${origin}/play/th07`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => {void window.__runtimeControlsFixture.navigate(1);});
  await expect(page).toHaveURL(`${origin}/play/th06`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.history.length)).toBe(entriesBeforeStart+1);
  await sameFrame(page);
});

test('same-product management routes retain the Runtime without a close request',async({page})=>{
 await page.goto(fixtureUrl);await page.getByRole('link',{name:'Synthetic TH06',exact:true}).click();await start(page,'prepared');
 await page.getByRole('link',{name:'Synthetic resources',exact:true}).click();await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06/resources');
 await expect(page.getByRole('dialog')).toHaveCount(0);expect((await page.evaluate(()=>window.__runtimeControlsFixture.inspect())).calls.close).toBe(0);
 await page.goBack();await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('draft save failure stays on route; explicit discard can proceed',async({page})=>{
 await page.goto(fixtureUrl);await page.getByRole('link',{name:'Synthetic TH06',exact:true}).click();
 await page.getByRole('button',{name:'Edit synthetic draft'}).click();await page.getByRole('button',{name:'Fail draft save'}).click();
 await page.getByRole('link',{name:'Synthetic library',exact:true}).click();await expect(page.getByRole('dialog')).toHaveAccessibleName('保存未完成的设置？');
 await page.getByRole('button',{name:'保存设置并继续'}).click();await expect(page.getByRole('alert')).toContainText('Synthetic draft storage failed');await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06');
 await page.getByRole('button',{name:'放弃修改并继续'}).click();await expect(page.getByTestId('synthetic-location')).toHaveText('/');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('draft confirmation precedes automatic Runtime save and a save failure retains the game',async({page})=>{
 await page.goto(fixtureUrl);await page.getByRole('link',{name:'Synthetic TH06',exact:true}).click();await start(page,'prepared');await page.getByRole('button',{name:'Edit synthetic draft'}).click();
 await page.getByRole('link',{name:'Synthetic library',exact:true}).click();await page.getByRole('button',{name:'保存设置并继续'}).click();
 await beginSave(page);expect((await page.evaluate(()=>window.__runtimeControlsFixture.inspect())).calls.close).toBe(1);await page.evaluate(()=>window.__runtimeControlsFixture.rejectSync());
 await page.getByRole('button',{name:'留在游戏中',exact:true}).click();await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06');await expect(page.getByTestId('draft-dirty')).toHaveText('false');
});

test('Runtime starting while draft decision is open must save after the draft before departure',async({page})=>{
 await page.goto(fixtureUrl);await page.getByRole('link',{name:'Synthetic TH06',exact:true}).click();await page.getByRole('button',{name:'Edit synthetic draft'}).click();
 await page.getByRole('link',{name:'Synthetic library',exact:true}).click();await expect(page.getByRole('dialog')).toHaveAccessibleName('保存未完成的设置？');
 await page.evaluate(()=>window.__runtimeControlsFixture.start('prepared'));
 await expect(page.getByTestId('synthetic-phase')).toHaveText('prepared');
 await page.getByRole('button',{name:'保存设置并继续'}).click();
 await beginSave(page);await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06');expect((await page.evaluate(()=>window.__runtimeControlsFixture.inspect())).calls.close).toBe(1);
 await page.evaluate(()=>window.__runtimeControlsFixture.resolveSync());await expect(page.getByTestId('synthetic-location')).toHaveText('/');
});

test('retired asynchronous draft operation cannot freeze a replacement owner',async({page})=>{
 await page.goto(fixtureUrl);await page.getByRole('link',{name:'Synthetic TH06',exact:true}).click();await page.getByRole('button',{name:'Edit synthetic draft'}).click();
 await page.evaluate(()=>window.__runtimeControlsFixture.holdNextDraftSave());await page.getByRole('link',{name:'Synthetic library',exact:true}).click();await page.getByRole('button',{name:'保存设置并继续'}).click();
 await expect.poll(()=>page.evaluate(()=>window.__runtimeControlsFixture.draftSavePending())).toBe(true);
 await page.evaluate(()=>window.__runtimeControlsFixture.replaceOwner());await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('link',{name:'Synthetic TH07',exact:true}).click();await expect(page.getByRole('dialog')).toHaveAccessibleName('保存未完成的设置？');
 await page.getByRole('button',{name:'继续编辑',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06');
 await page.evaluate(()=>window.__runtimeControlsFixture.resolveDraftSave());await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06');
});

test('toolbar user/system motion changes retain the toolbar, focus and Runtime frame', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.evaluate(() => window.__runtimeControlsFixture.setLessMotion(true));
  await start(page);
  const toolbar = page.getByRole('toolbar');
  const retained = await toolbar.elementHandle();
  await expect(toolbar).toHaveAttribute('data-reduced-motion', 'true');
  await expect(toolbar).toHaveCSS('opacity', '1');
  await expect(toolbar).toHaveCSS('transform', 'none');
  const help = page.getByRole('link', {name: '游戏操作说明', exact: true});
  await help.focus();
  await page.evaluate(() => window.__runtimeControlsFixture.setLessMotion(false));
  await expect(toolbar).toHaveAttribute('data-reduced-motion', 'false');
  expect(await retained!.evaluate(node => node === document.querySelector('[data-runtime-toolbar]'))).toBe(true);
  await expect(help).toBeFocused();
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(toolbar).toHaveAttribute('data-reduced-motion', 'true');
  await expect(help).toBeFocused();
  await sameFrame(page);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(0);
});

test('reducing motion interrupts only the default toolbar entrance and never the Runtime session', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.evaluate(async () => {
    const fixture = window.__runtimeControlsFixture;
    fixture.setLessMotion(false);
    await document.fonts.ready;
    fixture.start();
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      const toolbar = document.querySelector('[data-runtime-toolbar]');
      if (!toolbar) continue;
      const style = getComputedStyle(toolbar);
      const y = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
      if (Number(style.opacity) > 0 && Number(style.opacity) < .99 && y < 0) {
        fixture.setLessMotion(true);
        return;
      }
    }
    throw new Error('Default toolbar entrance was not observed');
  });
  await expect(page.getByRole('toolbar')).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.getByRole('toolbar')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('toolbar')).toHaveCSS('transform', 'none');
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().snapshot.phase)).toBe('running');
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(0);
});
