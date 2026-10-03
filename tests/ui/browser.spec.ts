import {test,expect} from '@playwright/test';
/** These tests exercise UI and navigation only. No real Runtime or user data. */
test.beforeEach(async({page})=>{
 await page.route('http://127.0.0.1:5174/host-manifest.json',route=>route.fulfill({status:404,body:'No game Runtime in UI fixture'}));
 await page.route('http://127.0.0.1:5174/release-catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schema:'eagler-touhou/release-catalog/1',games:{}})}));
});
test('library, settings, nested panel, back and forward keep runtime identity',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'网站公告'})).toBeVisible();
 await page.locator('a[href="/games/th06"]').first().click();
 await expect(page.getByRole('region',{name:'東方紅魔郷',exact:true})).toBeVisible();
 const identity=await page.locator('iframe[title="东方游戏 Runtime"]').evaluate(frame=>{(frame as HTMLIFrameElement).dataset.testIdentity='original';return frame.getAttribute('src');});
 await page.getByRole('link',{name:'资源管理',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goForward();await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/games\/th06$/);
 expect(await page.locator('iframe').getAttribute('data-test-identity')).toBe('original');
 expect(await page.locator('iframe').getAttribute('src')).toBe(identity);
});
test('direct child link and refresh close inside the application',async({page})=>{
 await page.goto('/games/th07/help');await page.reload();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/games\/th07$/);
 await expect(page.getByRole('region',{name:'東方妖々夢',exact:true})).toBeVisible();
});
test('rapid panel interruption never reopens stale target',async({page})=>{
 await page.goto('/games/th06');
 for(let i=0;i<6;i++){
  await page.getByRole('link',{name:'操作帮助',exact:true}).click();
  await page.keyboard.press('Escape');
 }
 await expect(page).toHaveURL(/\/games\/th06$/);await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('a[href="/games/th07"]').first().click();
 await page.waitForTimeout(300);
 await expect(page).toHaveURL(/\/games\/th07$/);
 await expect(page.locator('[data-ui-dialog-live]')).toHaveCount(0);
});
test('single shared settings persist without altering product keys',async({page})=>{
 await page.goto('/games/th06');
 await page.getByTestId('game-settings-disclosure').locator('summary').click();
 const switchControl=page.getByRole('switch',{name:'始终显示判定点'});
 await expect(switchControl).toBeVisible();await switchControl.click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('eagler-touhou-game-options-v1-th06')!));
 expect(saved.options.alwaysHitbox).toBe(true);
 await page.reload();await page.getByTestId('game-settings-disclosure').locator('summary').click();await expect(switchControl).toHaveAttribute('aria-checked','true');
});
test('missing assets never receive the SPA document',async({request})=>{
 for(const path of ['/missing.wasm','/assets/missing.js','/assets/missing.woff2']){
  const response=await request.get(path);expect(response.status()).toBe(404);
  expect(response.headers()['content-type']??'').not.toContain('text/html');
 }
});
test('visual evidence with default animations',async({page},testInfo)=>{
 await page.goto('/games/th06');await expect(page.getByRole('region',{name:'東方紅魔郷',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'東方紅魔郷',exact:true}).locator('..')).toHaveCSS('opacity','1');
 await page.screenshot({path:testInfo.outputPath('game-info.png'),fullPage:true});
 await page.getByRole('link',{name:'操作帮助',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.locator('[data-ui-dialog-live]').locator('..')).toHaveCSS('opacity','1');
 await page.screenshot({path:testInfo.outputPath('nested-help.png'),fullPage:true});
});

test('same-browser legacy visual reference',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:5175/?game=th06');
 if(page.url().includes('/compatibility.html')){
  await page.screenshot({path:testInfo.outputPath('legacy-compatibility-block.png'),fullPage:true});
  await testInfo.attach('legacy-baseline-limit',{body:'The existing launcher rejected this CI browser WebGL2 probe. Its compatibility gate was not bypassed. This is not a gameplay or legacy visual-baseline pass.',contentType:'text/plain'});
  test.skip(true,'Existing legacy WebGL2 gate blocks visual reference in this CI environment');
 }
 const firstNotice=page.locator('#firstUseNoticeDialog');
 await expect(firstNotice).toBeVisible();
 await page.locator('#firstUseNoticeClose').click();await expect(firstNotice).not.toBeVisible();
 await expect(page.locator('#scorePanel')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('legacy-settings-reference.png'),fullPage:true});
});

test('default-motion frame record remains independent of legacy compatibility',async({page},testInfo)=>{
 await page.goto('/games/th06');
 await expect(page.getByRole('region',{name:'東方紅魔郷',exact:true})).toBeVisible();
 await page.evaluate(()=>{
  const record={frames:[] as number[],longTasks:[] as number[],last:null as number|null,running:true,longTaskSupported:PerformanceObserver.supportedEntryTypes.includes('longtask')};
  (window as unknown as {motionRecord:typeof record}).motionRecord=record;
  const frame=(time:number)=>{if(record.last!==null)record.frames.push(time-record.last);record.last=time;if(record.running)requestAnimationFrame(frame);};requestAnimationFrame(frame);
  try{new PerformanceObserver(list=>record.longTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask',buffered:false});}catch{}
 });
 for(let i=0;i<5;i++){await page.getByRole('link',{name:'操作帮助',exact:true}).click();await page.keyboard.press('Escape');}
 const record=await page.evaluate(()=>{const data=(window as unknown as {motionRecord:{frames:number[];longTasks:number[];running:boolean;longTaskSupported:boolean}}).motionRecord;data.running=false;return{frames:data.frames,longTasks:data.longTasks,longTaskSupported:data.longTaskSupported};});
 expect(record.frames.length).toBeGreaterThan(0);
 expect(record.frames.every(interval=>Number.isFinite(interval)&&interval>=0)).toBe(true);
 await testInfo.attach('default-motion-frame-times',{body:JSON.stringify({scope:'parallel CI synthetic browser UI diagnostics only; not a performance pass or physical-phone acceptance',project:testInfo.project.name,viewport:page.viewportSize(),...record},null,2),contentType:'application/json'});
 await page.setViewportSize({width:844,height:390});
 await page.screenshot({path:testInfo.outputPath('new-settings-landscape.png'),fullPage:true});
 await expect(page.locator('iframe')).toHaveCount(1);
});

test('Escape during a cold lazy panel cancels the open without adding parent history',async({page})=>{
 let release!:()=>void;let requested=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 const historySnapshot=()=>page.evaluate(()=>({length:history.length,index:history.state?.idx}));
 await page.route('**/assets/help-*.js',async route=>{requested=true;await gate;await route.continue().catch(()=>{});});
 try{
  await page.goto('/');await expect(page.getByRole('heading',{name:'网站公告'})).toBeVisible();
  const home=await historySnapshot();expect(home.index).toEqual(expect.any(Number));
  await page.locator('a[href="/games/th06"]').first().click();
  // A Link click can finish before its route commits. Establish the parent
  // entry before measuring whether a subsequent cancelled open adds history.
  await expect(page).toHaveURL(/\/games\/th06$/);
  await expect(page.getByRole('region',{name:'東方紅魔郷',exact:true})).toBeVisible();
  const before=await historySnapshot();expect(before.index).toBe(home.index+1);
  await page.getByRole('link',{name:'操作帮助',exact:true}).click();
  await expect.poll(()=>requested).toBe(true);
  await page.keyboard.press('Escape');release();
  await expect(page).toHaveURL(/\/games\/th06$/);await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await historySnapshot()).toEqual(before);
  await page.getByRole('link',{name:'操作帮助',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  expect(await historySnapshot()).toEqual({length:before.length+1,index:before.index+1});
  await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/games\/th06$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await historySnapshot()).index).toBe(before.index);
  await page.goBack();await expect(page).toHaveURL(/\/$/);
  expect((await historySnapshot()).index).toBe(home.index);
  await page.goForward();await expect(page).toHaveURL(/\/games\/th06$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await historySnapshot()).index).toBe(before.index);
  await page.goForward();await expect(page).toHaveURL(/\/games\/th06\/help$/);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await historySnapshot()).index).toBe(before.index+1);
  await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/games\/th06$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await historySnapshot()).index).toBe(before.index);
 }finally{release();}
});

test('compact header menu owns focus and shared preferences',async({page})=>{
 await page.goto('/games/th06');
 const trigger=page.getByRole('button',{name:'更多',exact:true});
 await trigger.click();await expect(page.getByRole('menu')).toBeVisible();
 await page.getByRole('menuitemcheckbox',{name:'显示调试信息'}).click();
 expect(await page.evaluate(()=>localStorage.getItem('eagler-touhou-runtime-diagnostics-v1'))).toBe('1');
 await trigger.click();await page.keyboard.press('Escape');
 await expect(page.getByRole('menu')).toHaveCount(0);await expect(trigger).toBeFocused();
 const motion=page.getByRole('button',{name:'更少动画',exact:true});await motion.click();
 await expect(motion).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>localStorage.getItem('eagler-touhou-less-motion-v1'))).toBe('1');
});

test('Escape during cold browser Forward preserves parent history and a reusable child',async({page})=>{
 await page.goto('/');
 await page.locator('a[href="/games/th06"]').first().click();
 await expect(page).toHaveURL(/\/games\/th06$/);
 await page.getByRole('link',{name:'操作帮助',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/games\/th06$/);
 // Reload at the parent clears the lazy module cache while retaining Forward.
 await page.reload();
 await expect(page.getByRole('region',{name:'東方紅魔郷',exact:true})).toBeVisible();
 const before=await page.evaluate(()=>({length:history.length,index:history.state?.idx}));
 let release!:()=>void;let requested=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/assets/help-*.js',async route=>{requested=true;await gate;await route.continue().catch(()=>{});});
 try{
  await page.evaluate(()=>history.forward());
  await expect.poll(()=>requested).toBe(true);
  await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/games\/th06$/);
  await expect.poll(()=>page.evaluate(()=>history.state?.idx)).toBe(before.index);
  release();await page.waitForTimeout(250);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>history.length)).toBe(before.length);
  await page.goBack();await expect(page).toHaveURL(/\/$/);
  await page.goForward();await expect(page).toHaveURL(/\/games\/th06$/);
  await page.goForward();await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/games\/th06$/);
  await expect.poll(()=>page.evaluate(()=>history.state?.idx)).toBe(before.index);
 }finally{release();}
});
