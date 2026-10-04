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
    window.__runtimeControlsFixture.start(phase);
    (window as unknown as {syntheticFrame: Element | null}).syntheticFrame = document.querySelector('[data-synthetic-runtime-frame]');
  }, phase);
  await expect(page.getByRole('toolbar', {name: '游戏会话控制'})).toBeVisible();
}
async function sameFrame(page: Page) {
  expect(await page.evaluate(() => (window as unknown as {syntheticFrame: Element | null}).syntheticFrame === document.querySelector('[data-synthetic-runtime-frame]'))).toBe(true);
  await expect(page.locator('[data-synthetic-runtime-frame]')).toHaveCount(1);
}
async function requestNavigation(page: Page, destination = '/games/th07') {
  await page.evaluate(destination => window.__runtimeControlsFixture.navigate(destination), destination);
  await expect(page.getByRole('dialog', {name: '结束当前游戏？'})).toBeVisible();
  await expect(page.getByTestId('synthetic-location')).toHaveText('/games/th06');
}
async function beginSave(page: Page) {
  await page.getByRole('button', {name: '保存并退出', exact: true}).click();
  await expect(page.getByRole('button', {name: '正在保存…', exact: true})).toBeDisabled();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().syncPending)).toBe(true);
}

test.beforeEach(async ({page}) => {
  await page.goto(fixtureUrl);
  await expect(page.getByRole('heading', {name: 'Synthetic Runtime controls fixture, no game execution'})).toBeVisible();
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/games/th06'));
  await expect(page.getByTestId('synthetic-location')).toHaveText('/games/th06');
});

test('synthetic running toolbar Help query, Back, and Forward retain the same iframe', async ({page}) => {
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/games/th06?filter=single#details'));
  await start(page);
  await page.getByRole('link', {name: '游戏操作说明', exact: true}).click();
  await expect(page.getByRole('dialog', {name: '操作说明', exact: true})).toBeVisible();
  await expect(page).toHaveURL(`${origin}/games/th06?filter=single&panel=help#details`);
  await sameFrame(page);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(`${origin}/games/th06?filter=single#details`);
  await expect(page.getByRole('link', {name: '游戏操作说明', exact: true})).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('dialog', {name: '操作说明', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/games/th06?filter=single#details`);
  await expect(page.getByRole('link', {name: '游戏操作说明', exact: true})).toBeFocused();
  await sameFrame(page);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(0);
});

test('synthetic library-origin Runtime uses the single global Help panel without closing its session', async ({page}) => {
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/?filter=single#library'));
  await start(page);
  await page.getByRole('link', {name: '游戏操作说明', exact: true}).click();
  await expect(page.getByRole('dialog', {name: '操作说明', exact: true})).toHaveCount(1);
  await expect(page).toHaveURL(`${origin}/?filter=single&panel=help#library`);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(`${origin}/?filter=single#library`);
  await expect(page.getByRole('link', {name: '游戏操作说明', exact: true})).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('dialog', {name: '操作说明', exact: true})).toHaveCount(1);
  await page.getByRole('button', {name: '关闭', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/?filter=single#library`);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('running');
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(0);
  await sameFrame(page);
});

for (const phase of ['loading', 'configuring', 'prepared', 'launching', 'running', 'error'] as const) {
  test(`synthetic ${phase} session blocks product navigation; cancel and Escape retain it`, async ({page}) => {
    await start(page, phase);
    if (phase === 'prepared') await expect(page.getByRole('toolbar')).toContainText('准备完成，尚未启动');
    await requestNavigation(page);
    await page.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('synthetic-phase')).toHaveText(phase);
    await requestNavigation(page, '/');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(`${origin}/games/th06`);
    await sameFrame(page);
    expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(0);
  });
}

test('synthetic preparation closes before product navigation without inventing a save', async ({page}) => {
  await start(page, 'loading');
  await requestNavigation(page);
  await page.getByRole('button', {name: '保存并退出', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/games/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 1, sync: 0, discard: 0, completed: 1});
  await sameFrame(page);
});

test('synthetic configuring Runtime is already ready and must sync before closing', async ({page}) => {
  await start(page, 'configuring');
  await requestNavigation(page);
  await beginSave(page);
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page).toHaveURL(`${origin}/games/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.sync)).toBe(1);
  await sameFrame(page);
});

test('synthetic save-and-close is single-flight and advances only after sync succeeds', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await page.getByRole('button', {name: '保存并退出', exact: true}).evaluate((button: HTMLButtonElement) => {button.click();button.click();});
  await expect(page.getByRole('button', {name: '正在保存…', exact: true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(`${origin}/games/th06`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(1);
  await sameFrame(page);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page).toHaveURL(`${origin}/games/th07`);
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
  await expect(page.locator('[data-synthetic-runtime-frame]')).toHaveAttribute('src', 'about:blank');
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await page.getByRole('button', {name: '重试保存并退出', exact: true}).click();
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page).toHaveURL(`${origin}/games/th07`);
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
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('running');
  await sameFrame(page);
  await page.getByRole('button', {name: '退出游戏', exact: true}).click();
  await expect(page.getByRole('dialog', {name: '保存未完成'})).toBeVisible();
  await page.getByRole('button', {name: '留在游戏中', exact: true}).click();
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.close)).toBe(1);
});

test('synthetic explicit discard is offered only after failure and never claims a save', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await expect(page.getByRole('button', {name: '不保存退出', exact: true})).toHaveCount(0);
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.rejectSync());
  await page.getByRole('button', {name: '不保存退出', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/games/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 2, sync: 1, discard: 1, completed: 1});
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
  await expect(page).toHaveURL(`${origin}/games/th06`);
  expect(await page.evaluate(() => {
    const {snapshot, calls} = window.__runtimeControlsFixture.inspect();
    return {epoch: snapshot.epoch, ready: snapshot.ready, saveError: !!snapshot.saveError, completed: calls.completed};
  })).toEqual({epoch: null, ready: false, saveError: true, completed: 0});
  await page.getByRole('button', {name: '留在此页', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('toolbar')).toContainText('游戏已意外结束');
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/games/th07'));
  await expect(page.getByRole('dialog', {name: '游戏已结束，保存未完成'})).toBeVisible();
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await page.getByRole('button', {name: '确认丢失风险并离开', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/games/th07`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls)).toEqual({close: 2, sync: 1, discard: 1, completed: 1});
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await sameFrame(page);
});

test('synthetic lost-session completion cannot approve a newer navigation destination', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => {
    void window.__runtimeControlsFixture.navigate('/games/th08');
    window.__runtimeControlsFixture.abnormalExit();
  });
  await expect(page.getByRole('dialog', {name: '游戏已结束，保存未完成'})).toContainText('目标页面：/games/th08');
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await page.getByRole('button', {name: '确认丢失风险并离开', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/games/th08`);
  expect(await page.evaluate(() => window.__runtimeControlsFixture.inspect().calls.sync)).toBe(1);
  await sameFrame(page);
});

test('synthetic toolbar exit shares the guarded save path and stays on its route', async ({page}) => {
  await start(page, 'error');
  await page.getByRole('button', {name: '退出游戏', exact: true}).click();
  await page.getByRole('button', {name: '取消', exact: true}).click();
  await expect(page.getByRole('button', {name: '退出游戏', exact: true})).toBeFocused();
  await page.getByRole('button', {name: '退出游戏', exact: true}).click();
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.rejectSync('Synthetic recovery save failed'));
  await expect(page.getByTestId('synthetic-phase')).toHaveText('error');
  await page.getByRole('button', {name: '重试保存并退出', exact: true}).click();
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await expect(page.locator('#main-content')).toBeFocused();
  await start(page);
  await page.getByRole('button', {name: '退出游戏', exact: true}).click();
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.rejectSync());
  await page.getByRole('button', {name: '不保存退出', exact: true}).click();
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await sameFrame(page);
});

test('synthetic newer blocked destination cannot be advanced by an older save completion', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.navigate('/games/th08'));
  await expect(page.getByRole('dialog')).toContainText('目标页面：/games/th08');
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page.getByRole('button', {name: '确认离开', exact: true})).toBeEnabled();
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await page.getByRole('button', {name: '确认离开', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/games/th08`);
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
    void window.__runtimeControlsFixture.navigate('/games/th06?panel=help');
    window.__runtimeControlsFixture.resolveSync();
  });
  await expect(page).toHaveURL(`${origin}/games/th06?panel=help`);
  await expect(page.getByRole('dialog', {name: '结束当前游戏？'})).toHaveCount(0);
  await expect(page.getByRole('dialog', {name: '操作说明', exact: true})).toBeVisible();
  await sameFrame(page);
});

test('synthetic latest destination may still be canceled after obsolete save completes', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await beginSave(page);
  await page.evaluate(() => {
    void window.__runtimeControlsFixture.navigate('/');
    window.__runtimeControlsFixture.resolveSync();
  });
  await expect(page.getByRole('button', {name: '确认离开', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: '取消', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('synthetic old Cancel cannot erase a newer blocked navigation before React commits', async ({page}) => {
  await start(page);
  await requestNavigation(page);
  await page.getByRole('button', {name: '取消', exact: true}).evaluate((button: HTMLButtonElement) => {
    void window.__runtimeControlsFixture.navigate('/games/th08');
    button.click();
  });
  await expect(page.getByRole('dialog')).toContainText('目标页面：/games/th08');
  await page.getByRole('button', {name: '取消', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/games/th06`);
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
  await expect(page.getByRole('button', {name: '保存并退出', exact: true})).toBeEnabled();
  await page.evaluate(() => window.__runtimeControlsFixture.resolvePreviousSync());
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('running');
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('synthetic-phase')).toHaveText('idle');
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await sameFrame(page);
});

test('synthetic browser Back requires a decision and Forward remains Router-owned', async ({page}) => {
  await page.evaluate(async () => {
    await window.__runtimeControlsFixture.navigate('/games/th07');
    await window.__runtimeControlsFixture.navigate('/games/th06');
  });
  await start(page);
  await page.goBack();
  await expect(page.getByRole('dialog', {name: '结束当前游戏？'})).toBeVisible();
  await page.getByRole('button', {name: '取消', exact: true}).click();
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await page.goBack();
  await beginSave(page);
  await page.evaluate(() => window.__runtimeControlsFixture.resolveSync());
  await expect(page).toHaveURL(`${origin}/games/th07`);
  await page.goForward();
  await expect(page).toHaveURL(`${origin}/games/th06`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await sameFrame(page);
});
