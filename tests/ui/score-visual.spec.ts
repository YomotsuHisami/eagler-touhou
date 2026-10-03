import {test,expect,type Page,type Locator,type TestInfo} from '@playwright/test';
import {createScoreVisualFixture,type ScoreVisualFixture} from './fixtures/score-visual';
/** Fresh Playwright contexts contain only generated DATs. No Runtime is launched.
 * Existing checked-in UI portrait assets are shown, without acquiring game data. */
test.beforeEach(async({page})=>{
 await page.route('http://127.0.0.1:5174/host-manifest.json',route=>route.fulfill({status:404,body:'No game Runtime in score visual fixture'}));
 await page.route('http://127.0.0.1:5174/release-catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schema:'eagler-touhou/release-catalog/1',games:{}})}));
});
async function settle(page:Page,region:Locator){
 await expect(region).toBeVisible();
 await expect.poll(()=>region.evaluate(element=>{
  for(let parent:Element|null=element;parent;parent=parent.parentElement){
   if(Number(getComputedStyle(parent).opacity)!==1)return false;
   if(parent.getAnimations().some(animation=>animation.playState==='running'))return false;
  }
  return true;
 })).toBe(true);
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
}
async function assertPortraits(region:Locator,fixture:ScoreVisualFixture){
 // The SPA uses /assets/... and the legacy owner uses assets/... . Both must
 // be counted: a leading-slash-only selector silently excludes the reference.
 const images=region.locator('img[src*="assets/dairi/"]');
 await expect(images).toHaveCount(fixture.portraits.length);
 for(const id of fixture.portraits){
  const image=region.locator(`img[src$="/dairi/${id}.png"]`);
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(element=>{const image=element as HTMLImageElement;return image.complete&&image.naturalWidth>0;})).toBe(true);
 }
}
async function assertPortraitGeometry(region:Locator){
 const geometry=await region.evaluate(element=>{
  const layer=element.querySelector('img[src*="assets/dairi/"]')!.parentElement!;
  const panel=element.getBoundingClientRect(),bounds=layer.getBoundingClientRect();
  return{top:bounds.top-panel.top,expectedTop:matchMedia('(max-width:780px) and (orientation:portrait)').matches?145:100,
   scoreOverflow:getComputedStyle(layer.parentElement!).overflowY,
   images:[...layer.querySelectorAll('img')].map(image=>{const rect=image.getBoundingClientRect();return{
    width:rect.width/bounds.width,height:rect.height/bounds.height,right:(bounds.right-rect.right)/bounds.width,top:(rect.top-bounds.top)/bounds.height,
   };})};
 });
 // The legacy art is anchored to the whole panel, not shifted/clipped by the
 // score-content box. These are layout invariants, not a pixel-parity claim.
 expect(geometry.top).toBeCloseTo(geometry.expectedTop,1);
 expect(geometry.scoreOverflow).toBe('visible');
 for(const [index,image] of geometry.images.entries()){
  expect(image.width).toBeCloseTo(index===0?.85:.72,2);
  expect(image.height).toBeCloseTo(.95,2);
  expect(image.right).toBeCloseTo(index===0?.04:.25,2);
  expect(image.top).toBeCloseTo(index===0?0:.05,2);
 }
}
async function capture(page:Page,info:TestInfo,name:string){
 const screenshot=await page.screenshot({path:info.outputPath(name),fullPage:true});
 await info.attach(name,{body:screenshot,contentType:'image/png'});
}
async function recordGeometry(region:Locator,info:TestInfo,name:string){
 const geometry=await region.evaluate(element=>{
  const rectangle=(node:Element)=>{const bounds=node.getBoundingClientRect();return{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};};
  return{region:rectangle(element),portraits:[...element.querySelectorAll('img[src*="/dairi/"]')].map(node=>({src:node.getAttribute('src'),...rectangle(node)}))};
 });
 await info.attach(name,{body:JSON.stringify({scope:'synthetic save UI geometry; not gameplay or physical-phone acceptance',...geometry},null,2),contentType:'application/json'});
}
for(const game of ['th07','th08'] as const){
 test(`populated ${game} save uses real import/select and ${game==='th08'?'paired':'single'} portraits`,async({page},info)=>{
  const fixture=createScoreVisualFixture(game);
  await page.goto(`/games/${game}`);
  const gameRegion=page.getByRole('region',{name:fixture.title,exact:true});
  const scoreRegion=page.getByRole('region',{name:'游玩统计',exact:true});
  await settle(page,gameRegion);
  await expect(scoreRegion).toContainText('游戏保存后，成绩与进度将在这里显示');
  await expect(scoreRegion.locator('img')).toHaveCount(0);
  await capture(page,info,`${game}-react-empty.png`);
  const runtime=page.locator('iframe[title="东方游戏 Runtime"]');
  const runtimeSource=await runtime.getAttribute('src');
  await page.getByRole('link',{name:'存档 / 录像',exact:true}).click();
  const library=page.getByRole('region',{name:'存档库',exact:true});
  await expect(library).toBeVisible();
  await library.locator('input[type="file"]').setInputFiles({name:fixture.name,mimeType:'application/octet-stream',buffer:fixture.bytes});
  const row=library.locator('li').filter({hasText:fixture.name});
  await expect(row).toHaveCount(1);
  await row.getByRole('button',{name:'使用',exact:true}).click();
  await expect(row.getByRole('button',{name:'已选择',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/games/${game}$`));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(scoreRegion).toContainText(fixture.highest.toLocaleString('en-US'));
  await expect(scoreRegion).toContainText(`${fixture.favorite} · ${fixture.count} 次`);
  await assertPortraits(scoreRegion,fixture);await settle(page,gameRegion);
  await assertPortraitGeometry(gameRegion);
  await capture(page,info,`${game}-react-populated.png`);
  await recordGeometry(gameRegion,info,`${game}-react-portrait-geometry`);
  await scoreRegion.locator('details').filter({has:page.locator('summary',{hasText:'排行榜'})}).locator('summary').click();
  await expect(scoreRegion.getByRole('region',{name:'排行榜',exact:true})).toBeVisible();
  await capture(page,info,`${game}-react-ranking.png`);
  expect(await runtime.getAttribute('src')).toBe(runtimeSource);
  // The same selected synthetic slot survives a normal reload through the
  // actual score-slot IndexedDB owner, without writing Runtime IDBFS.
  await page.reload();await expect(scoreRegion).toContainText(fixture.highest.toLocaleString('en-US'));
  await assertPortraits(scoreRegion,fixture);
  expect(await runtime.getAttribute('src')).toBe(runtimeSource);
  await info.attach('fixture-scope',{body:JSON.stringify({game,bytes:fixture.bytes.length,highest:fixture.highest,favorite:fixture.favorite,portraits:fixture.portraits,storage:'fresh test-context score-slot IndexedDB via real import/select',runtime:'never launched',art:'existing bundled UI portraits',note:'Populated legacy reference is captured by its separate test; portrait geometry is intentionally not changed before evidence'},null,2),contentType:'application/json'});
 });
 test(`legacy ${game} populated save reference`,async({page},info)=>{
  const fixture=createScoreVisualFixture(game);
  await page.goto(`http://127.0.0.1:5175/?game=${game}`);
  if(page.url().includes('/compatibility.html')){
   await capture(page,info,`${game}-legacy-compatibility-block.png`);
   test.skip(true,'Legacy WebGL2 compatibility gate blocked this CI browser; no bypass attempted');
  }
  await expect(page.locator('#firstUseNoticeDialog')).toBeVisible();
  await page.locator('#firstUseNoticeClose').click();
  await expect(page.locator('#firstUseNoticeDialog')).not.toBeVisible();
  await expect(page.locator('#scorePanel')).toBeVisible();
  await expect(page.locator('#scorePanel')).toContainText('游戏保存后，成绩与进度将在这里显示');
  await expect(page.locator('.tools img[src*="assets/dairi/"]')).toHaveCount(0);
  await settle(page,page.locator('.tools'));
  await capture(page,info,`${game}-legacy-empty.png`);
  await page.locator('#scoreFilesOpen').click();
  await expect(page.locator('#scoreFilesDialog')).toBeVisible();
  const library=page.locator('#scoreFilesContent .score-save-library');
  await expect(library).toBeVisible();
  await library.locator('input[type="file"]').setInputFiles({name:fixture.name,mimeType:'application/octet-stream',buffer:fixture.bytes});
  const row=library.locator('.score-save-row').filter({hasText:fixture.name});
  await expect(row).toHaveCount(1);await row.locator('.score-save-select').click();
  await expect(row.locator('.score-save-select')).toHaveAttribute('aria-pressed','true');
  await page.locator('#scoreFilesClose').click();
  await expect(page.locator('#scorePanel')).toContainText(fixture.highest.toLocaleString('en-US'));
  await expect(page.locator('#scorePanel')).toContainText(`${fixture.favorite} · ${fixture.count} 次`);
  await assertPortraits(page.locator('.tools'),fixture);await settle(page,page.locator('.tools'));
  await capture(page,info,`${game}-legacy-populated.png`);
  await recordGeometry(page.locator('.tools'),info,`${game}-legacy-portrait-geometry`);
  await page.locator('#scorePanel details').filter({has:page.locator('summary',{hasText:'排行榜'})}).locator('summary').click();
  await capture(page,info,`${game}-legacy-ranking.png`);
 });
}
