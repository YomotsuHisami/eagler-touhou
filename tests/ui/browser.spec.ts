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
 await expect(page.getByRole('heading',{name:'東方紅魔郷',exact:true})).toBeVisible();
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
 await expect(page.getByRole('heading',{name:'東方妖々夢',exact:true})).toBeVisible();
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
 const switchControl=page.getByRole('switch',{name:'始终显示判定点'});
 await expect(switchControl).toBeVisible();await switchControl.click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('eagler-touhou-game-options-v1-th06')!));
 expect(saved.options.alwaysHitbox).toBe(true);
 await page.reload();await expect(switchControl).toHaveAttribute('aria-checked','true');
});
test('missing assets never receive the SPA document',async({request})=>{
 for(const path of ['/missing.wasm','/assets/missing.js','/assets/missing.woff2']){
  const response=await request.get(path);expect(response.status()).toBe(404);
  expect(response.headers()['content-type']??'').not.toContain('text/html');
 }
});
test('visual evidence with default animations',async({page},testInfo)=>{
 await page.goto('/games/th06');await expect(page.getByRole('heading',{name:'東方紅魔郷',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('game-settings.png'),fullPage:true});
 await page.getByRole('link',{name:'操作帮助',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('nested-help.png'),fullPage:true});
});

test('same-browser legacy visual reference and default-motion frame record',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:5175/?game=th06');
 await expect(page.locator('#gameTitle')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('legacy-settings-reference.png'),fullPage:true});
 await page.goto('/games/th06');
 await expect(page.getByRole('heading',{name:'東方紅魔郷',exact:true})).toBeVisible();
 await page.evaluate(()=>{
  const record={frames:[] as number[],longTasks:[] as number[],last:performance.now(),running:true};
  (window as unknown as {motionRecord:typeof record}).motionRecord=record;
  const frame=(time:number)=>{record.frames.push(time-record.last);record.last=time;if(record.running)requestAnimationFrame(frame);};requestAnimationFrame(frame);
  try{new PerformanceObserver(list=>record.longTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask',buffered:false});}catch{}
 });
 for(let i=0;i<5;i++){await page.getByRole('link',{name:'操作帮助',exact:true}).click();await page.keyboard.press('Escape');}
 const record=await page.evaluate(()=>{const data=(window as unknown as {motionRecord:{frames:number[];longTasks:number[];running:boolean}}).motionRecord;data.running=false;return{frames:data.frames,longTasks:data.longTasks};});
 await testInfo.attach('default-motion-frame-times',{body:JSON.stringify({scope:'synthetic browser UI only; not physical-phone performance acceptance',project:testInfo.project.name,viewport:page.viewportSize(),...record},null,2),contentType:'application/json'});
 await page.setViewportSize({width:844,height:390});
 await page.screenshot({path:testInfo.outputPath('new-settings-landscape.png'),fullPage:true});
 await expect(page.locator('iframe')).toHaveCount(1);
});
