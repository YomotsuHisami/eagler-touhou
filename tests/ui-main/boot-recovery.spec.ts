/** CI browser coverage only. Failures/delays are explicitly synthetic module
 * interception, not evidence of a real game, server outage, or GPU failure. */
import {test, expect} from './synthetic-ui-test';

test.beforeEach(async ({page}, info) => {
  info.annotations.push({type:'synthetic-boot-failure', description:'Browser exercises real Framework recovery with intentionally blocked or delayed generated chunks.'});
  await page.addInitScript(() => {
    localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');
    localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');
  });
});

for (const chunk of ['root', 'entry.client']) test(`synthetic missing ${chunk} chunk shows recovery; explicit reload recovers`, async ({page}, info) => {
  const pattern = `**/assets/${chunk}-*.js`;
  await page.route(pattern, route => route.abort('failed'));
  await page.goto('/?uiLocale=en', {waitUntil:'domcontentloaded'});
  const recovery = page.locator('#launcher-boot-emergency');
  await expect(recovery).toBeVisible({timeout:15_000});
  await expect(recovery.getByRole('heading', {name:'Launcher could not load'})).toBeVisible();
  await recovery.getByText('View diagnostics', {exact:true}).click();
  const diagnostic = await page.locator('#launcher-boot-diagnostics').innerText();
  expect(diagnostic).toMatch(/^EAGLER-BOOT\/2\nscope=initial-hydration\nkind=(?:script-load|module-load|javascript|watchdog)\n/);
  expect(diagnostic).not.toMatch(/https?:|uiLocale|\.js|stack=/);
  await info.attach('synthetic-initial-chunk-failure', {body:diagnostic,contentType:'text/plain'});
  await page.unroute(pattern);
  await recovery.getByRole('button', {name:'Reload',exact:true}).click();
  await expect(page.locator('[data-library-stage]')).toBeVisible();
  await expect(recovery).toHaveCount(0);
  await expect(page.locator('[data-runtime-host]')).toHaveCount(1);
});

test('synthetic delayed hydration shows the bounded watchdog then clears after actual app commit', async ({page}) => {
  await page.clock.install();
  let release!: () => void;
  const held = new Promise<void>(resolve => {release=resolve;});
  await page.route('**/assets/entry.client-*.js', async route => {await held; await route.continue();});
  try {
    await page.goto('/?uiLocale=en', {waitUntil:'domcontentloaded'});
    await expect(page.locator('[data-library-stage]')).toHaveCount(0);
    await page.clock.runFor(12_001);
    await expect(page.locator('#launcher-boot-emergency')).toBeVisible();
    expect(await page.locator('#launcher-boot-diagnostics').textContent()).toContain('kind=watchdog');
    release(); await page.clock.resume();
    await expect(page.locator('[data-library-stage]')).toBeVisible();
    await expect(page.locator('#launcher-boot-emergency')).toHaveCount(0);
    await expect(page.locator('[data-runtime-host]')).toHaveCount(1);
    // An unrelated late error cannot resurrect the retired pre-module owner.
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', {message:'Synthetic later UI error', filename:new URL('/assets/synthetic-later-error.js',location.href).href})));
    await expect(page.locator('#launcher-boot-emergency')).toHaveCount(0);
  } finally {release();}
});

test('synthetic route-module render failure uses the route boundary rather than failed-boot diagnostics', async ({page}) => {
  // A valid module with a throwing component tests the route error boundary
  // without relying on Router's separate failed-network-import reload policy.
  await page.route('**/assets/lobby-*.js', route => route.fulfill({status:200,contentType:'text/javascript',body:
    'export default function SyntheticBrokenLobby(){throw new Error("Synthetic route render failure with private details");}'}));
  await page.goto('/lobby?uiLocale=en', {waitUntil:'domcontentloaded'});
  await expect(page.locator('[data-route-recovery]')).toBeVisible();
  await expect(page.getByRole('heading', {name:'This page could not load'})).toBeVisible();
  await expect(page.locator('#launcher-boot-emergency')).toHaveCount(0);
  expect(await page.locator('[data-route-diagnostics]').textContent()).toContain('scope=route');
  expect(await page.locator('[data-route-recovery]').textContent()).not.toContain('private details');
  await page.unroute('**/assets/lobby-*.js');
  await page.getByRole('button', {name:'Reload',exact:true}).click();
  await expect(page.locator('[data-route-recovery]')).toHaveCount(0);
  await expect(page.locator('[data-runtime-host]')).toHaveCount(1);
});
