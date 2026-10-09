import {test as base,expect} from './synthetic-ui-test';
import {installRefreshTelemetry, readRefreshTelemetry} from './refresh-telemetry';
const test=base.extend<{browserErrors:string[]}>({browserErrors:[async({page},use)=>{const errors:string[]=[];await page.addInitScript(()=>{try{localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0');}catch{}});page.on('pageerror',error=>errors.push(error.message));await use(errors);expect(errors).toEqual([]);},{auto:true}]});
test('main-derived library and nested help keep one route owner',async({page})=>{
 await page.goto('/play/th06');
 await expect(page.getByRole('heading',{name:'東方紅魔郷'})).toBeVisible();
 await page.getByRole('link',{name:'操作说明',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'帮助',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/\/play\/th06$/);
 await expect(page.getByRole('dialog',{name:'帮助',exact:true})).toHaveCount(0);
 await page.goForward(); await expect(page.getByRole('dialog',{name:'帮助',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'关闭帮助',exact:true}).click();
 await expect(page).toHaveURL(/\/play\/th06$/);
});
test('direct help closes to its product; refresh remains usable',async({page},info)=>{
 await installRefreshTelemetry(page);
 try {
  await page.goto('/play/th06?panel=help'); await expect(page.getByRole('dialog',{name:'帮助',exact:true})).toBeVisible();
  await page.reload(); await expect(page.getByRole('dialog',{name:'帮助',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭帮助',exact:true}).click();
  await expect(page).toHaveURL(/\/play\/th06$/);
  const events = await readRefreshTelemetry(page);
  expect(events.some(event=>event.kind==='pagehide')).toBe(true);
  expect(events.filter(event=>event.kind==='metadata-fetch' && event.phase!=='active')).toEqual([]);
  expect(events.filter(event=>event.kind==='unhandled-rejection' || event.kind==='window-error')).toEqual([]);
 } finally {
  await info.attach('refresh-document-request-lifecycle',{body:JSON.stringify(await readRefreshTelemetry(page),null,2),contentType:'application/json'});
 }
});
test('current-main sample evidence and privacy boundary',async({page},info)=>{
 await page.goto('/'); await expect(page.getByRole('heading',{name:'单机',exact:true})).toBeVisible();
 await page.evaluate(async()=>{
  const images=[...document.querySelectorAll<HTMLImageElement>('main img')];
  await Promise.all(images.map(image=>image.decode()));
  if(images.some(image=>!image.complete || image.naturalWidth===0))throw Error('Declared cover failed to load');
  await document.fonts.load('700 24px \"ET Chill Round\"','東方紅魔郷');
  await document.fonts.ready;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 });
 if(info.project.name === 'mobile-viewport') expect((await page.locator('header').first().boundingBox())!.height).toBeLessThanOrEqual(70);
 await page.screenshot({path:info.outputPath('main-derived-library.png'),fullPage:true});
 expect(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(x=>x.length))).toBe(0);
 const missing=await page.request.get('/runtime/missing.wasm');expect(missing.status()).toBe(404);
 const ownership=await page.request.get('/ui-ownership.json');expect(ownership.status()).toBe(404);
 const legacy=await page.request.get('/app.js');expect(legacy.status()).toBe(404);
});

test('rapid repeated dismissal preserves parent query and focus',async({page})=>{
 await page.goto('/play/th06?filter=single#details');
 const help=page.getByRole('link',{name:'操作说明',exact:true});
 for(let n=0;n<3;n++){
  await help.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
  await expect(help).toBeFocused();
 }
 await page.goto('/play/th06?filter=single&panel=help#details');
 await expect(page.getByRole('dialog',{name:'帮助',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
});

test('Framework Help mounts its keyboard scope in the opening click before immediate Escape',async({page},info)=>{
 await page.goto('/play/th06?filter=single#details');
 const help=page.getByRole('link',{name:'操作说明',exact:true});
 const immediate=await help.evaluate((trigger:HTMLAnchorElement)=>{
  trigger.click();
  const dialog=document.querySelector<HTMLElement>('[data-animated-dialog][data-dialog-layout="dialog"]');
  const value={present:dialog?.dataset.presence,focusedInside:!!dialog?.contains(document.activeElement),count:document.querySelectorAll('[data-animated-dialog][data-dialog-layout="dialog"]').length};
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  return value;
 });
 await info.attach('framework-immediate-help-keyboard-scope',{body:JSON.stringify(immediate),contentType:'application/json'});
 expect(immediate).toEqual({present:'present',focusedInside:true,count:1});
 await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
 await expect(page.locator('[data-animated-dialog][data-dialog-layout="dialog"]')).toHaveCount(0);
 await expect(help).toBeFocused();
 await page.goForward();
 await expect(page.getByRole('dialog',{name:'帮助',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
});

test('canonical settings persist while a dormant Runtime host stays stable',async({page})=>{
 await page.goto('/play/th06');
 const cap=page.getByRole('switch',{name:/高刷新率/});
 await expect(cap).not.toBeChecked();
 await cap.check();
 await expect(cap).toBeChecked();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('eagler-touhou-game-options-v1-th06')!).options.frameLimit60Enabled)).toBe(false);
 await cap.uncheck();
 await expect(cap).not.toBeChecked();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('eagler-touhou-game-options-v1-th06')!).options.frameLimit60Enabled)).toBe(true);
 await cap.check();
 await page.evaluate(()=>{(window as unknown as {sampleFrame:Element|null}).sampleFrame=document.querySelector('[data-runtime-host] iframe');});
 await page.getByRole('link',{name:'操作说明',exact:true}).click();
 await expect(page.locator('[data-runtime-host] iframe')).toHaveCount(1);
 expect(await page.evaluate(()=>(window as unknown as {sampleFrame:Element|null}).sampleFrame===document.querySelector('[data-runtime-host] iframe'))).toBe(true);
 await page.keyboard.press('Escape');
 await expect(cap).toBeChecked();
 await page.reload();
 await expect(cap).toBeChecked();
 // Persistence is observed through the same form after a full reload; exact keys are covered by the service test.
});

for (const method of ['browser Back','explicit return'] as const) test(`library rail survives ${method}`,async({page})=>{
 await page.goto('/');
 const shelf=page.getByRole('region',{name:'单机',exact:true});
 const rail=page.locator('#singleplayer-rail');
 await expect(shelf.getByRole('heading',{name:'单机',exact:true})).toBeVisible();
 await rail.evaluate(element=>element.scrollTo({left:element.scrollWidth,behavior:'instant'}));
 await expect.poll(()=>rail.evaluate(element=>Math.abs(element.scrollLeft-(element.scrollWidth-element.clientWidth)))).toBeLessThan(2);
 const previous=await rail.evaluate(element=>element.scrollLeft);
 await shelf.locator('a[href="/play/th11"]').click();
 await expect(page).toHaveURL('http://127.0.0.1:4173/');
 await expect(shelf.getByRole('button',{name:'浏览東方地霊殿',exact:true})).toHaveAttribute('aria-pressed','true');
 await shelf.locator('a[href="/play/th11"]').click();
 await expect(page).toHaveURL(/\/play\/th11$/);
 if(method==='browser Back')await page.goBack();
 else await page.getByRole('button',{name:'返回游戏库',exact:true}).click();
 await expect(page).toHaveURL('http://127.0.0.1:4173/');
 await expect.poll(()=>rail.evaluate((element,previous)=>Math.abs(element.scrollLeft-previous),previous)).toBeLessThan(2);
 await expect(shelf.getByRole('button',{name:'浏览東方地霊殿',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(shelf.locator('a[href=\"/play/th11\"]')).toBeFocused();
});

test('library restoration clamps changed viewport geometry',async({page})=>{
 await page.goto('/');
 const shelf=page.getByRole('region',{name:'单机',exact:true});
 await shelf.getByRole('button',{name:'浏览東方地霊殿',exact:true}).click();
 await shelf.locator('a[href="/play/th11"]').click();
 await expect(page).toHaveURL(/\/play\/th11$/);
 await page.setViewportSize({width:640,height:720});
 await page.goBack();
 await expect(shelf.getByRole('button',{name:'浏览東方地霊殿',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect.poll(async()=>{
  const card=await shelf.locator('a[href="/play/th11"]').boundingBox();
  const rail=await page.locator('#singleplayer-rail').boundingBox();
  return !!card && !!rail && card.x<rail.x+rail.width && card.x+card.width>rail.x;
 }).toBe(true);
 await expect(shelf.locator('a[href="/play/th11"]')).toBeFocused();
 await expect.poll(()=>page.locator('#singleplayer-rail').evaluate(element=>
  element.scrollLeft>=0 && element.scrollLeft<=element.scrollWidth-element.clientWidth+1
 )).toBe(true);
});

// Synthetic public DataMode strategy exercises Framework-style async completion.
// These tests don't wait for dialog visibility before sending the rapid input.
import type {} from './runtime-controls-fixture';
const helpFixture = `${process.env.UI_RUNTIME_FIXTURE_ORIGIN ?? 'http://127.0.0.1:4175'}/__ui_tests__/runtime-controls.html`;
async function openSyntheticHelp(page: import('@playwright/test').Page, escape = true) {
 return page.getByRole('link',{name:'Synthetic help trigger',exact:true}).evaluate((trigger:HTMLAnchorElement,escape)=>{
  trigger.click();
  const dialog=document.querySelector<HTMLElement>('[data-animated-dialog]');
  const immediate={present:dialog?.dataset.presence,focusedInside:!!dialog?.contains(document.activeElement),count:document.querySelectorAll('[data-animated-dialog]').length};
  if(escape){
   document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
   document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  }
  return immediate;
 },escape);
}

test('Help is keyboard-ready during public async strategy before its final location render',async({page},info)=>{
 await page.goto(helpFixture);
 await expect(page.getByRole('link',{name:'Synthetic help trigger',exact:true})).toBeVisible();
 await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/play/th06?filter=single#details'));
 await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06?filter=single#details');
 await page.evaluate(()=>window.__runtimeControlsFixture.clearNavigationRecords());
 const immediate=await openSyntheticHelp(page);
 expect(immediate).toEqual({present:'present',focusedInside:true,count:1});
 await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
 await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
 await expect(page.getByRole('link',{name:'Synthetic help trigger',exact:true})).toBeFocused();
 const records=await page.evaluate(()=>window.__runtimeControlsFixture.inspectHelpNavigation());
 await info.attach('public-async-help-navigation',{body:JSON.stringify({immediate,...records},null,2),contentType:'application/json'});
 expect(records.records.some(record=>record.state==='loading'&&record.pending?.includes('panel=help'))).toBe(true);
 expect(records.records.some(record=>record.state==='idle'&&record.search.includes('panel=help'))).toBe(true);
 expect(records.records.filter(record=>record.state==='idle'&&record.action==='POP'&&record.pathname==='/play/th06'&&record.search==='?filter=single'&&record.hash==='#details')).toHaveLength(1);
 await page.goForward();
 await expect(page.getByRole('dialog',{name:'帮助',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
});

test('early Help dismissal waits for its matching commit and never guesses a Back before history push',async({page})=>{
 await page.goto(helpFixture);
 await expect(page.getByRole('link',{name:'Synthetic help trigger',exact:true})).toBeVisible();
 await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/play/th06?filter=single#details'));
 await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06?filter=single#details');
 await page.evaluate(()=>window.__runtimeControlsFixture.holdNextHelpNavigation());
 expect(await openSyntheticHelp(page)).toEqual({present:'present',focusedInside:true,count:1});
 expect(await page.evaluate(()=>window.__runtimeControlsFixture.inspectHelpNavigation().held)).toBe(1);
 await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
 await page.evaluate(()=>window.__runtimeControlsFixture.releaseHeldHelpNavigation());
 await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Synthetic help trigger',exact:true})).toBeFocused();
 await expect(page).toHaveURL(/play\/th06\?filter=single#details$/);
});

for(const superseding of ['newer navigation','browser Back'] as const)test(`pending Help dismissal cannot undo ${superseding}`,async({page},info)=>{
 await page.goto(helpFixture);
 await expect(page.getByRole('link',{name:'Synthetic help trigger',exact:true})).toBeVisible();
 await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/?sentinel=1'));
 await expect(page.getByTestId('synthetic-location')).toHaveText('/?sentinel=1');
 await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/play/th06?filter=single#details'));
 await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06?filter=single#details');
 await page.evaluate(()=>window.__runtimeControlsFixture.holdNextHelpNavigation());
 expect(await openSyntheticHelp(page)).toEqual({present:'present',focusedInside:true,count:1});
 if(superseding==='browser Back')await page.goBack();
 else await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/play/th07?newer=1'));
 const target=superseding==='browser Back'?'/?sentinel=1':'/play/th07?newer=1';
 await expect(page.getByTestId('synthetic-location')).toHaveText(target);
 await page.evaluate(()=>window.__runtimeControlsFixture.releaseHeldHelpNavigation());
 await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
 await expect(page.getByTestId('synthetic-location')).toHaveText(target);
 await info.attach('superseded-help-navigation',{body:JSON.stringify(await page.evaluate(()=>window.__runtimeControlsFixture.inspectHelpNavigation()),null,2),contentType:'application/json'});
});

test('an older aborted Help promise cannot acknowledge a newer Help close',async({page})=>{
 await page.goto(helpFixture);
 await expect(page.getByRole('link',{name:'Synthetic help trigger',exact:true})).toBeVisible();
 await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/play/th06?filter=old'));
 await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06?filter=old');
 await page.evaluate(()=>window.__runtimeControlsFixture.holdNextHelpNavigation());
 expect(await openSyntheticHelp(page)).toEqual({present:'present',focusedInside:true,count:1});
 await page.evaluate(()=>window.__runtimeControlsFixture.navigate('/play/th06?filter=newer#new'));
 await expect(page.getByTestId('synthetic-location')).toHaveText('/play/th06?filter=newer#new');
 await expect(page.locator('[data-animated-dialog]')).toHaveCount(0);
 expect(await openSyntheticHelp(page,false)).toEqual({present:'present',focusedInside:true,count:1});
 await expect(page).toHaveURL(/play\/th06\?filter=newer&panel=help#new$/);
 await page.evaluate(()=>window.__runtimeControlsFixture.releaseHeldHelpNavigation());
 await expect(page.getByRole('dialog',{name:'帮助',exact:true})).toBeVisible();
 await expect(page).toHaveURL(/play\/th06\?filter=newer&panel=help#new$/);
 await page.keyboard.press('Escape');
 await expect(page).toHaveURL(/play\/th06\?filter=newer#new$/);
});

test('product settings, resources and Replay use nested Router history',async({page})=>{
 await page.goto('/play/th06');
 await page.getByRole('link',{name:'资源管理',exact:true}).click();
 await expect(page).toHaveURL(/\/play\/th06\/resources$/);await expect(page.getByRole('region',{name:'资源管理',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Replay',exact:true}).click();await expect(page).toHaveURL(/\/play\/th06\/replays$/);
 await page.goBack();await expect(page).toHaveURL(/\/play\/th06\/resources$/);await page.goBack();await expect(page.getByRole('form',{name:'游戏设置'})).toBeVisible();
 await page.goForward();await expect(page).toHaveURL(/\/play\/th06\/resources$/);await page.reload();await expect(page.getByRole('region',{name:'资源管理',exact:true})).toBeVisible();
});
test('resource namespace is never an HTML navigation fallback',async({page})=>{
 for(const path of ['/games/th06','/games/th06/resources','/games/th06/missing.data','/runtime/th06/missing.wasm']){
  const response=await page.request.get(path,{headers:{Accept:'text/html'}});expect(response.status(),path).toBe(404);
 }
 await page.goto('/play/th11/replays');await expect(page.getByRole('heading',{name:'東方地霊殿'})).toBeVisible();
});

test('legacy product links replace into the current route without automatic launch',async({page})=>{
 await page.goto('/index.html?game=th06&filter=single#details');
 await expect(page).toHaveURL(/\/play\/th06\?filter=single#details$/);
 await expect(page.getByRole('heading',{name:'東方紅魔郷'})).toBeVisible();
 await expect(page.getByRole('toolbar',{name:'游戏会话控制'})).toHaveCount(0);
 await page.reload();await expect(page.getByRole('heading',{name:'東方紅魔郷'})).toBeVisible();
 await page.goto('/en.html?game=th11');await expect(page).toHaveURL(/\/play\/th11\?uiLocale=en$/);
 await expect(page.getByRole('toolbar',{name:'游戏会话控制'})).toHaveCount(0);
});
test('directory alias retains product filter and navigation returns to library',async({page})=>{
 await page.goto('/lobby.html?game=th06mp');await expect(page).toHaveURL(/\/lobby\?game=th06mp$/);
 await expect(page.getByRole('heading',{name:'联机大厅',exact:true})).toBeVisible();
 await page.getByRole('link',{name:/返回游戏库$/}).click();await expect(page).toHaveURL(/\/$/);
 await page.getByRole('link',{name:'联机大厅',exact:true}).click();await expect(page).toHaveURL(/\/lobby$/);
 await page.goBack();await expect(page).toHaveURL(/\/$/);
});
