import {test as base,expect,type Page} from '@playwright/test';
import type {} from './file-workflow-fixture';
import {zipSync} from 'fflate';
const origin=process.env.UI_RUNTIME_FIXTURE_ORIGIN??'http://127.0.0.1:4175';
const test=base.extend<{errors:string[]}>({errors:[async({page},use)=>{const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await use(errors);expect(errors).toEqual([]);},{auto:true}]});
const ordinary='/play/th06?uiLocale=en&extra=a%2Bb#kept';
async function load(page:Page,initial=ordinary) {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(`${origin}/__ui_tests__/file-workflow.html?initial=${encodeURIComponent(initial)}`);
  await expect(page.locator('.settings-file-tools')).toBeVisible();
  await expect(page.locator('.settings-file-tools').getByRole('button',{name:'Import',exact:true})).toBeEnabled();
}
const inspect=(page:Page)=>page.evaluate(()=>window.__fileWorkflow.inspect());
const saveRow=(page:Page)=>page.locator('.settings-file-tool-row').filter({hasText:/^Save/});
const replayRow=(page:Page)=>page.locator('.settings-file-tool-row').filter({hasText:/^Replay/});

test('real App asks overwrite before file chooser, then writes, reloads, verifies and retires without launch',async({page})=>{
  await load(page);const frame=await page.locator('iframe').elementHandle();let pickers=0;page.on('filechooser',()=>pickers++);
  await saveRow(page).getByRole('button',{name:'Import',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Are you sure?',exact:true});await expect(dialog).toContainText('Importing will overwrite the current game save.');
  expect(pickers).toBe(0);expect((await inspect(page)).events).toEqual([]);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(pickers).toBe(0);expect((await inspect(page)).events).toEqual([]);
  await saveRow(page).getByRole('button',{name:'Import',exact:true}).click();
  const picker=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'Continue import',exact:true}).click();
  await (await picker).setFiles({name:'my-save.dat',mimeType:'application/octet-stream',buffer:Buffer.from([9,8,7])});
  await expect.poll(async()=>(await inspect(page)).files.normal?.['score.dat']).toEqual([9,8,7]);
  await expect.poll(()=>page.locator('iframe').evaluate(node=>(node as HTMLIFrameElement).contentWindow?.location.href)).toBe('about:blank');
  const result=await inspect(page);expect(result.events.filter(event=>event==='launch')).toEqual([]);expect(result.events.filter(event=>event.startsWith('ready:normal:'))).toHaveLength(2);expect(result.events).toContain('read:score.dat');expect(result.iframes).toBe(1);
  expect(await frame?.evaluate(node=>node===document.querySelector('iframe'))).toBe(true);expect(page.url()).toBe(origin+ordinary);
});

test('main custom-select opens its own list, restores focus, and commits the React preference',async({page})=>{
 await load(page);
 const native=page.locator('select[id$="-language"]');
 // This fixture has only one language option; the custom trigger mirrors disabled.
 await expect(native.locator('..').getByRole('button')).toBeDisabled();
 await page.locator('.library-panel-back').click();
 const locale=page.getByRole('button',{name:'Interface language',exact:true});
 if(!await locale.isVisible())await page.locator('summary[aria-label="More site information"]').click();
 await locale.click();const menu=page.getByRole('listbox',{name:'Interface language',exact:true});await expect(menu).toBeVisible();
 await menu.getByRole('option',{name:'Simplified Chinese',exact:true}).click();
 await expect(menu).toBeHidden();
 await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
 await page.locator('summary[aria-label="更多站点信息"]').click();
 await page.getByRole('button',{name:'界面语言',exact:true}).press('ArrowDown');
 await expect(page.getByRole('listbox',{name:'界面语言',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('listbox',{name:'界面语言',exact:true})).toBeHidden();
 await expect(page.getByRole('button',{name:'界面语言',exact:true})).toBeFocused();
});

test('missing save download offers a dialog and direct file chooser without a management-page jump',async({page})=>{
  await load(page);await page.evaluate(()=>window.__fileWorkflow.missingSave());
  await saveRow(page).getByRole('button',{name:'Download',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Are you sure?',exact:true});await expect(dialog).toContainText('There is no score.dat yet. Import a save now?');expect(page.url()).toBe(origin+ordinary);
  const picker=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'Choose import file',exact:true}).click();await (await picker).setFiles({name:'recovered.dat',mimeType:'application/octet-stream',buffer:Buffer.from([6,5])});
  await expect.poll(async()=>(await inspect(page)).files.normal?.['score.dat']).toEqual([6,5]);expect(page.url()).toBe(origin+ordinary);expect((await inspect(page)).events).not.toContain('launch');
});

test('missing Replay download imports directly and retires the temporary owner with the original drawer retained',async({page})=>{
  await load(page);await page.evaluate(()=>window.__fileWorkflow.missingReplay());
  await replayRow(page).getByRole('button',{name:'Download',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Are you sure?',exact:true});await expect(dialog).toContainText('There are no replays yet. Import one now?');
  const picker=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'Choose import file',exact:true}).click();await (await picker).setFiles({name:'th6_01.rpy',mimeType:'application/octet-stream',buffer:Buffer.from([3,2])});
  await expect.poll(async()=>Object.entries((await inspect(page)).files.normal??{}).filter(([path])=>path.startsWith('replay/')).map(([,bytes])=>bytes)).toEqual([[3,2]]);
  await expect.poll(()=>page.locator('iframe').evaluate(node=>(node as HTMLIFrameElement).contentWindow?.location.href)).toBe('about:blank');expect(page.url()).toBe(origin+ordinary);expect((await inspect(page)).events).not.toContain('launch');
});

test('room Replay manager overlays the same room and options drawer; Back restores both and keeps one membership',async({page})=>{
  const initial='/play/th06mp?uiLocale=en&mpRoom=1234&roomOptions=1&extra=a%2Bb#kept';await load(page,initial);
  const room=await page.locator('#mpRoomView').elementHandle(),settings=await page.locator('[data-game-settings]').elementHandle(),frame=await page.locator('iframe').elementHandle();
  await replayRow(page).getByRole('link',{name:'Manage',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'Replay manager',exact:true});await expect(manager).toBeVisible();
  expect(await room?.evaluate(node=>node.isConnected)).toBe(true);expect(await settings?.evaluate(node=>node.isConnected)).toBe(true);
  await expect(manager.getByRole('button',{name:'Rename th6_01.rpy',exact:true})).toBeVisible();
  await page.goBack();await expect(manager).toHaveCount(0);await expect(page.locator('[data-game-settings]')).toBeVisible();expect(page.url()).toBe(origin+initial);
  expect(await room?.evaluate(node=>node===document.getElementById('mpRoomView'))).toBe(true);expect(await frame?.evaluate(node=>node===document.querySelector('iframe'))).toBe(true);
  const result=await inspect(page);expect(result.sockets).toHaveLength(1);expect(result.sockets[0].closed).toBe(false);expect(result.iframes).toBe(1);expect(result.events).not.toContain('launch');
});

async function replayRecovery(page:Page) {
  const initial='/play/th06mp?uiLocale=en&extra=a%2Bb#kept';await load(page,initial);await page.evaluate(()=>window.__fileWorkflow.evictData());
  await page.getByRole('button',{name:'Watch Replay',exact:true}).click();
  const importer=page.getByRole('dialog',{name:'Import game package',exact:true});await expect(importer).toBeVisible();
  const pack=await page.evaluate(()=>window.__fileWorkflow.packageFile());
  const archive=zipSync({'package.json':new TextEncoder().encode(JSON.stringify(pack.descriptor)),...Object.fromEntries(Object.entries(pack.entries).map(([path,bytes])=>[path,Uint8Array.from(bytes)]))},{level:0});
  return {importer,archive};
}

async function installSyntheticPackage(page:Page) {
  const pack=await page.evaluate(()=>window.__fileWorkflow.packageFile());
  const archive=zipSync({'package.json':new TextEncoder().encode(JSON.stringify(pack.descriptor)),...Object.fromEntries(Object.entries(pack.entries).map(([path,bytes])=>[path,Uint8Array.from(bytes)]))},{level:0});
  const importer=page.getByRole('dialog',{name:'Import game package',exact:true});await expect(importer).toBeVisible();
  const picker=page.waitForEvent('filechooser');await importer.getByRole('button',{name:'Import',exact:true}).click();await (await picker).setFiles({name:'synthetic-package.zip',mimeType:'application/zip',buffer:Buffer.from(archive)});
  return importer;
}

test('ordinary DATA recovery resumes the original Start without a second input prompt or fullscreen request',async({page})=>{
  await page.addInitScript(()=>{let requests=0;Object.defineProperty(window,'__fullscreenRequests',{get:()=>requests});HTMLElement.prototype.requestFullscreen=async()=>{requests++;};});
  await load(page);await page.evaluate(()=>window.__fileWorkflow.evictData());
  await page.getByRole('button',{name:'Start game',exact:true}).click();const warning=page.locator('[data-launch-warning="music.noneLaunchWarning"]');await expect(warning).toBeVisible();await warning.locator('button').last().click();
  const importer=await installSyntheticPackage(page);await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);await expect(importer).toHaveCount(0);await expect(warning).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {__fullscreenRequests:number}).__fullscreenRequests)).toBe(1);expect((await inspect(page)).iframes).toBe(1);
});

test('room DATA recovery keeps Player, accepts input once and resumes the same server run',async({page})=>{
  await page.addInitScript(()=>{let requests=0;Object.defineProperty(window,'__fullscreenRequests',{get:()=>requests});HTMLElement.prototype.requestFullscreen=async()=>{requests++;};});
  await load(page,'/play/th06mp?uiLocale=en&mpRoom=1234&roomOptions=1#kept');await expect(page.getByText('Multiplayer resources ready',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.__fileWorkflow.evictData());await page.evaluate(()=>window.__fileWorkflow.startRoom());
  const warning=page.locator('[data-launch-warning="music.noneLaunchWarning"]');await expect(warning).toBeVisible();await warning.locator('button').last().click();
  const importer=page.getByRole('dialog',{name:'Import game package',exact:true});await expect(importer).toBeVisible();await expect(page.locator('#mpRoomView')).toHaveCount(0);
  await installSyntheticPackage(page);await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);await expect(importer).toHaveCount(0);await expect(warning).toHaveCount(0);
  const result=await inspect(page);expect(result.sockets).toHaveLength(1);expect(result.sockets[0].closed).toBe(false);expect(result.iframes).toBe(1);
  expect(await page.evaluate(()=>(window as unknown as {__fullscreenRequests:number}).__fullscreenRequests)).toBe(1);
});
test('Replay DATA recovery keeps Player and Replay intent through import, then starts exactly once',async({page})=>{
  const {importer,archive}=await replayRecovery(page);
  await expect(page.locator('[data-dialog-layout="library-panel"]')).toHaveCount(0);expect((await inspect(page)).events).not.toContain('launch');
  const picker=page.waitForEvent('filechooser');await importer.getByRole('button',{name:'Import',exact:true}).click();await (await picker).setFiles({name:'synthetic-package.zip',mimeType:'application/zip',buffer:Buffer.from(archive)});
  await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);
  await expect(importer).toHaveCount(0);await expect(page.locator('[data-dialog-layout="library-panel"]')).toHaveCount(0);expect((await inspect(page)).iframes).toBe(1);
});
test('late Replay DATA import/metadata after navigation cannot launch the old intent',async({page})=>{
  const {importer,archive}=await replayRecovery(page);await page.evaluate(()=>window.__fileWorkflow.holdMetadata());
  const picker=page.waitForEvent('filechooser');await importer.getByRole('button',{name:'Import',exact:true}).click();await (await picker).setFiles({name:'synthetic-package.zip',mimeType:'application/zip',buffer:Buffer.from(archive)});
  await expect.poll(async()=>(await inspect(page)).heldMetadata).toBeGreaterThan(0);
  await page.evaluate(()=>window.__fileWorkflow.navigate('/play/th07?uiLocale=en'));await expect(page).toHaveURL(origin+'/play/th07?uiLocale=en');
  await page.evaluate(()=>window.__fileWorkflow.releaseMetadata());await expect.poll(async()=>(await inspect(page)).heldMetadata).toBe(0);
  await expect(page.getByRole('heading',{name:'東方妖々夢',exact:true})).toBeVisible();expect((await inspect(page)).events).not.toContain('launch');
});
test('actual gameplay reconnect/end window follows the native transport and returns to the same room after sync',async({page})=>{
 const initial='/play/th06mp?uiLocale=en&mpRoom=1234&roomOptions=1#kept';await load(page,initial);
 await page.evaluate(()=>window.__fileWorkflow.startRoom());await expect(page.locator('[data-launch-warning="music.noneLaunchWarning"]')).toBeVisible();await page.locator('[data-launch-warning="music.noneLaunchWarning"] button').last().click();
 await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);await expect(page.locator('[data-dialog-layout="fullscreen"]')).toHaveCount(0);await expect(page).not.toHaveURL(/roomOptions|roomPanel/);
 await page.evaluate(()=>window.__fileWorkflow.connection('recovering'));const connectionWindow=page.locator('.netplay-connection-window');await expect(connectionWindow).toContainText('Reconnecting…');await expect(connectionWindow.getByRole('button',{name:'Return to room',exact:true})).toBeVisible();
 await page.evaluate(()=>window.__fileWorkflow.connection('connected'));await expect(connectionWindow).toHaveCount(0);
 await page.evaluate(()=>window.__fileWorkflow.connection('ended'));await expect(connectionWindow).toContainText('Connection lost');await connectionWindow.getByRole('button',{name:'Return to room',exact:true}).click();
 await expect(page.locator('#mpRoomView')).toBeVisible();await expect.poll(()=>page.locator('iframe').evaluate(node=>(node as HTMLIFrameElement).contentWindow?.location.href)).toBe('about:blank');
 const result=await inspect(page);expect(result.events).toContain('sync');expect(result.sockets).toHaveLength(1);expect(result.sockets[0].closed).toBe(false);expect(result.iframes).toBe(1);
});
test('restricted movement choice after server Start resumes that same run rather than rejecting the choice',async({page})=>{
 const initial='/play/th06mp?uiLocale=en&mpRoom=1234&roomOptions=1#kept';await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(`${origin}/__ui_tests__/file-workflow.html?movement=unlimited&initial=${encodeURIComponent(initial)}`);await expect(page.locator('.settings-file-tools')).toBeVisible();
 await page.evaluate(()=>window.__fileWorkflow.startRoom(true));const decision=page.getByRole('dialog',{name:'Change your cheat movement mode',exact:true});await expect(decision).toBeVisible();
 await decision.getByRole('button',{name:/touch/i}).click();await expect(page.locator('[data-launch-warning="music.noneLaunchWarning"]')).toBeVisible();await page.locator('[data-launch-warning="music.noneLaunchWarning"] button').last().click();
 await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);const result=await inspect(page);expect(result.sockets).toHaveLength(1);expect(result.sockets[0].closed).toBe(false);expect(result.iframes).toBe(1);
});

async function startOrdinary(page:Page) {
 await load(page);await page.getByRole('button',{name:'Start game',exact:true}).click();const warning=page.locator('[data-launch-warning="music.noneLaunchWarning"]');await expect(warning).toBeVisible();await warning.locator('button').last().click();
 await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);
}

test('normal Player Back saves directly and restores the original settings instead of leaving the product',async({page})=>{
 await startOrdinary(page);await expect.poll(()=>page.evaluate(()=>history.state?.usr?.uiPlayer?.active)).toBe(true);
 await page.evaluate(()=>history.back());await expect(page.locator('[data-game-settings]')).toBeVisible();await expect.poll(()=>page.locator('iframe').evaluate(node=>(node as HTMLIFrameElement).contentWindow?.location.href)).toBe('about:blank');
 expect(page.url()).toBe(origin+ordinary);expect((await inspect(page)).events).toContain('sync');await expect(page.getByRole('dialog',{name:'End current game?',exact:true})).toHaveCount(0);
});

test('normal Back asks only after sync failure, then Stay preserves the Player and retry can return',async({page})=>{
 await startOrdinary(page);await expect.poll(()=>page.evaluate(()=>history.state?.usr?.uiPlayer?.active)).toBe(true);await page.evaluate(()=>window.__fileWorkflow.failNextSync());await page.evaluate(()=>history.back());
 const failure=page.getByRole('dialog',{name:'Save incomplete',exact:true});await expect(failure).toBeVisible();await expect(failure).toContainText('Synthetic save failed');await failure.getByRole('button',{name:'Stay in game',exact:true}).click();await expect(failure).toHaveCount(0);
 await expect(page.locator('iframe')).not.toHaveAttribute('src','about:blank');expect((await inspect(page)).events.filter(event=>event==='sync')).toHaveLength(1);
 await page.evaluate(()=>history.back());await expect(page.locator('[data-game-settings]')).toBeVisible();await expect(failure).toHaveCount(0);expect((await inspect(page)).events.filter(event=>event==='sync')).toHaveLength(2);
});

test('multiplayer Player Back returns to the same room and only the next Back leaves membership',async({page})=>{
 await load(page,'/play/th06mp?uiLocale=en&mpRoom=1234&roomOptions=1#kept');await page.evaluate(()=>window.__fileWorkflow.startRoom());const warning=page.locator('[data-launch-warning="music.noneLaunchWarning"]');await expect(warning).toBeVisible();await warning.locator('button').last().click();
 await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);await expect.poll(()=>page.evaluate(()=>history.state?.usr?.uiPlayer?.active)).toBe(true);
 await page.evaluate(()=>history.back());await expect(page.locator('#mpRoomView')).toBeVisible();expect(page.url()).toContain('mpRoom=1234');expect((await inspect(page)).sockets[0].closed).toBe(false);
 await page.locator('#mpRoomView').getByRole('button',{name:'Back',exact:true}).click();await expect(page.locator('#mpRoomView')).toHaveCount(0);expect((await inspect(page)).sockets[0].closed).toBe(true);
});

test('Player Back during ordinary acquisition cancels the pending Start even though product and URL stay the same',async({page})=>{
 await load(page);await page.evaluate(()=>window.__fileWorkflow.holdMetadata());await page.getByRole('button',{name:'Start game',exact:true}).click();const warning=page.locator('[data-launch-warning="music.noneLaunchWarning"]');await expect(warning).toBeVisible();await warning.locator('button').last().click();
 await expect.poll(async()=>(await inspect(page)).heldMetadata).toBeGreaterThan(0);await expect.poll(()=>page.evaluate(()=>history.state?.usr?.uiPlayer?.active)).toBe(true);
 await page.evaluate(()=>history.back());await expect(page.locator('[data-game-settings]')).toBeVisible();await page.evaluate(()=>window.__fileWorkflow.releaseMetadata());await expect.poll(async()=>(await inspect(page)).heldMetadata).toBe(0);
 expect((await inspect(page)).events).not.toContain('launch');expect(page.url()).toBe(origin+ordinary);
});

for(const stay of [false,true]) test(`ordinary ready preparation Back saves before retirement; Stay=${stay}`,async({page})=>{
 await load(page);await page.evaluate(()=>window.__fileWorkflow.holdConfigure());
 await page.getByRole('button',{name:'Start game',exact:true}).click();const warning=page.locator('[data-launch-warning="music.noneLaunchWarning"]');await expect(warning).toBeVisible();await warning.locator('button').last().click();
 await expect.poll(async()=>(await inspect(page)).heldConfigure).toBe(1);
 await expect.poll(()=>page.evaluate(()=>history.state?.usr?.uiPlayer?.active)).toBe(true);
 if(stay)await page.evaluate(()=>window.__fileWorkflow.failNextSync());
 await page.evaluate(()=>history.back());
 await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='sync').length).toBe(1);
 if(stay){
  const failure=page.getByRole('dialog',{name:'Save incomplete',exact:true});await expect(failure).toBeVisible();
  await page.evaluate(()=>window.__fileWorkflow.releaseConfigure());
  expect((await inspect(page)).events).not.toContain('launch');
  await failure.getByRole('button',{name:'Stay in game',exact:true}).click();
  await expect(failure).toHaveCount(0);await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);
 }else{
  await expect(page.locator('[data-game-settings]')).toBeVisible();await page.evaluate(()=>window.__fileWorkflow.releaseConfigure());
  expect((await inspect(page)).events).not.toContain('launch');
 }
 expect((await inspect(page)).events.filter(event=>event.startsWith('ready:'))).toHaveLength(1);
});

test('real browser fullscreen survives first native epoch and ready-to-launch, then exits with Player',async({page})=>{
 await load(page);await page.evaluate(()=>window.__fileWorkflow.holdConfigure());
 await page.getByRole('button',{name:'Start game',exact:true}).click();const warning=page.locator('[data-launch-warning="music.noneLaunchWarning"]');await expect(warning).toBeVisible();await warning.locator('button').last().click();
 await expect.poll(async()=>(await inspect(page)).heldConfigure).toBe(1);
 await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===document.querySelector('[data-player-surface]'))).toBe(true);
 await page.evaluate(()=>window.__fileWorkflow.releaseConfigure());await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);
 expect(await page.evaluate(()=>document.fullscreenElement===document.querySelector('[data-player-surface]'))).toBe(true);
 await page.evaluate(()=>history.back());await expect(page.locator('[data-game-settings]')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
});

test('Player Back from Replay DATA recovery dismisses import and revokes the original Replay intent',async({page})=>{
 const {importer}=await replayRecovery(page);await expect.poll(()=>page.evaluate(()=>history.state?.usr?.uiPlayer?.active)).toBe(true);await page.evaluate(()=>history.back());await expect(importer).toHaveCount(0);await expect(page.locator('[data-game-settings]')).toBeVisible();expect((await inspect(page)).events).not.toContain('launch');
});

test('ordinary native exit consumes its Player layer and returns to the original settings history entry',async({page})=>{
 await load(page);const key=await page.evaluate(()=>history.state.key);await page.getByRole('button',{name:'Start game',exact:true}).click();const warning=page.locator('[data-launch-warning="music.noneLaunchWarning"]');await expect(warning).toBeVisible();await warning.locator('button').last().click();await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);
 await page.evaluate(()=>window.__fileWorkflow.exitGame());await expect(page.locator('[data-game-settings]')).toBeVisible();await expect.poll(()=>page.evaluate(()=>history.state.key)).toBe(key);expect(page.url()).toBe(origin+ordinary);expect((await inspect(page)).iframes).toBe(1);
});


test('first touch Help opens before native ready and does not cancel preparation; tutorials keep one expanded section',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(`${origin}/__ui_tests__/file-workflow.html?touch=1&initial=${encodeURIComponent(ordinary)}`);
 await expect(page.getByRole('button',{name:'Start game',exact:true})).toBeEnabled();
 await page.evaluate(()=>window.__fileWorkflow.holdMetadata());
 await page.getByRole('button',{name:'Start game',exact:true}).click();
 await page.locator('[data-launch-warning="music.noneLaunchWarning"] button').last().click();
 const help=page.getByRole('dialog',{name:'Help',exact:true});await expect(help).toBeVisible();
 expect((await inspect(page)).events).toEqual([]);expect(page.url()).not.toContain('panel=help');
 const focus=help.locator('[data-guide-panel="focus"]');await focus.locator('[data-guide-tab]').click();
 await expect(focus).toHaveClass(/is-finished/);await expect(focus.locator('.guide-replay')).toBeVisible();
 const menu=help.locator('[data-guide-panel="menu"]');await menu.locator('[data-guide-tab]').click();
 await expect(focus.locator('.guide-demo-body')).toBeHidden();await expect(menu.locator('.guide-demo-body')).toBeVisible();
 await help.getByRole('button',{name:'Close help',exact:true}).click();await expect(help).toHaveCount(0);
 await page.evaluate(()=>window.__fileWorkflow.releaseMetadata());
 await expect.poll(async()=>(await inspect(page)).events.filter(event=>event==='launch').length).toBe(1);
 await expect(help).toHaveCount(0);expect(await page.evaluate(()=>localStorage.getItem('eagler-touch-help-seen-v8'))).toBe('1');
});
