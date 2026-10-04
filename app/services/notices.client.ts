/** Root-lived notice/content policy. No component DOM, native dialogs, history,
 * browser storage lookup or Runtime owner is created here. */
import {FIRST_USE_NOTICE_FILE, FIRST_USE_NOTICE_SEEN_STORAGE_KEY} from '../../src/launcher/first-use-notice.mts';
import {MULTIPLAYER_GUIDE_FILE} from '../../src/launcher/multiplayer-guide.mts';
import {parseSiteNoticeText, SITE_NOTICE_DURATION_MS, SITE_NOTICE_STORAGE_KEY, SITE_NOTICE_DISMISSED_KEY,
  type SiteNoticeLine} from '../../src/launcher/site-notice.mts';
export {FIRST_USE_NOTICE_SEEN_STORAGE_KEY, SITE_NOTICE_STORAGE_KEY, SITE_NOTICE_DISMISSED_KEY, SITE_NOTICE_DURATION_MS};
/** The old controller's bounded compatibility keys; no new seen schema. */
export const LEGACY_FIRST_USE_KEYS = Object.freeze([
  'eagler-touhou-new-player-notice-seen-v1', 'eagler-touhou-changelog-seen-v2', 'eagler-touhou-changelog-seen-20260822-1',
]);
export type PackagedContentKind = 'first-use' | 'multiplayer';
const files = Object.freeze({'first-use': FIRST_USE_NOTICE_FILE, multiplayer: MULTIPLAYER_GUIDE_FILE});
export interface NoticeStorage {getItem(key: string): string | null; setItem(key: string, value: string): void}
export type PackagedContentNode = Readonly<{kind:'text';text:string}> | Readonly<{kind:'element';tag:string;attributes:Readonly<Record<string,string|number>>;children:ReadonlyArray<PackagedContentNode>}>;
interface ParsedNode {nodeName:string;value?:string;attrs?:Array<{name:string;value:string}>;childNodes?:ParsedNode[]}
const contentTags=new Set(['div','section','span','p','h1','h2','h3','h4','h5','h6','strong','em','del','ul','ol','li','blockquote','pre','code','br','hr','a','img','table','thead','tbody','tr','th','td','details','summary']);
function safeContentUrl(value:string|undefined,baseUrl:string) {
  if(!value)return null;
  try{const url=new URL(value,baseUrl);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
/** The source pipeline already sanitizes Markdown; this lazy, pure parser also
 * limits rendered tags/attributes and resolves relative links for nested routes. */
export async function parsePackagedContent(html:string,baseUrl:string):Promise<ReadonlyArray<PackagedContentNode>> {
  const {parseFragment}=await import('parse5');
  const fragment=parseFragment(html) as unknown as ParsedNode;
  let count=0;
  function visit(node:ParsedNode,depth:number):PackagedContentNode|null {
    if(++count>10000 || depth>64)throw new Error('Packaged content is too complex');
    if(node.nodeName==='#text')return Object.freeze({kind:'text',text:node.value ?? ''});
    if(!contentTags.has(node.nodeName))return null;
    const attrs=Object.fromEntries((node.attrs ?? []).map(item=>[item.name,item.value]));
    const attributes:Record<string,string|number>={};
    if(attrs.class)attributes.className=attrs.class;
    if(attrs.title)attributes.title=attrs.title;
    if(node.nodeName==='a') {
      const href=safeContentUrl(attrs.href,baseUrl);
      if(href){attributes.href=href;if(new URL(href).origin!==new URL(baseUrl).origin){attributes.target='_blank';attributes.rel='noopener noreferrer';}}
    }
    if(node.nodeName==='img') {
      const src=safeContentUrl(attrs.src,baseUrl);if(!src)return null;
      attributes.src=src;attributes.alt=attrs.alt ?? '';attributes.loading='lazy';attributes.decoding='async';
    }
    if(node.nodeName==='ol' && /^-?\d+$/.test(attrs.start ?? ''))attributes.start=Number(attrs.start);
    const children=(node.childNodes ?? []).map(child=>visit(child,depth+1)).filter((child):child is PackagedContentNode=>child!==null);
    return Object.freeze({kind:'element',tag:node.nodeName,attributes:Object.freeze(attributes),children:Object.freeze(children)});
  }
  return Object.freeze((fragment.childNodes ?? []).map(node=>visit(node,0)).filter((node):node is PackagedContentNode=>node!==null));
}
export interface PackagedContent {
  readonly kind: PackagedContentKind;
  readonly status: 'idle' | 'loading' | 'available' | 'empty' | 'error';
  /** Only fixed repository-generated content paths can populate this field.
   * scripts/build-content-pages.mjs escapes raw HTML and filters URL protocols. */
  readonly html: string;
  readonly nodes: ReadonlyArray<PackagedContentNode>;
  readonly error: string | null;
}
export interface NoticesSnapshot {
  readonly baseUrl: string;
  readonly hydrated: boolean;
  readonly firstUseSeen: boolean;
  readonly firstUseOpen: boolean;
  readonly multiplayerOpen: boolean;
  readonly multiplayerGameId: string | null;
  readonly multiplayerRequest: number;
  readonly contents: Readonly<Record<PackagedContentKind, PackagedContent>>;
  readonly site: Readonly<{enabled: boolean; dismissed: boolean; open: boolean; canOptOut: boolean; scrollHidden: boolean;
    lines: ReadonlyArray<SiteNoticeLine>}>;
}
export interface NoticesTimers {set(callback: () => void, delay: number): unknown; clear(handle: unknown): void}
const text = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const content = (kind: PackagedContentKind): PackagedContent => Object.freeze({kind,status:'idle',html:'',nodes:Object.freeze([]),error:null});
export function createNoticesService({baseUrl,storage = null,fetchImpl = globalThis.fetch,timers,
  requestTimeoutMs = 15_000,maxContentBytes = 1_048_576,automaticMode = ()=>'all'}: {
  baseUrl: string; storage?: NoticeStorage | null; fetchImpl?: typeof fetch; timers?: NoticesTimers;
  requestTimeoutMs?: number; maxContentBytes?: number; automaticMode?:()=> 'all'|'site-only'|'none';
}) {
  const base = new URL(baseUrl);
  if (!['http:','https:'].includes(base.protocol) || !base.pathname.endsWith('/') || base.search || base.hash || base.username || base.password) throw new Error('Notices need an application directory URL');
  const clock: NoticesTimers = timers ?? {set:(callback,delay)=>globalThis.setTimeout(callback,delay),clear:handle=>globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)};
  let snapshot: NoticesSnapshot = Object.freeze({baseUrl:base.href,hydrated:false,firstUseSeen:false,firstUseOpen:false,multiplayerOpen:false,multiplayerGameId:null,multiplayerRequest:0,
    contents:Object.freeze({'first-use':content('first-use'),multiplayer:content('multiplayer')}),
    site:Object.freeze({enabled:true,dismissed:false,open:false,canOptOut:false,scrollHidden:false,lines:Object.freeze([])})});
  let disposed = false, siteSerial = 0, firstSerial = 0, guideSerial = 0;
  let siteTimer: unknown = null, siteController: AbortController | null = null;
  let entryPromise: Promise<boolean> | null = null;
  const controllers = new Set<AbortController>(), loads = new Map<PackagedContentKind,Promise<PackagedContent>>();
  const listeners = new Set<() => void>(), positions = new WeakMap<object,number>();
  function update(patch: Partial<NoticesSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({...snapshot,...patch}); for (const listener of [...listeners]) listener();
  }
  function updateContent(kind: PackagedContentKind, value: PackagedContent) {update({contents:Object.freeze({...snapshot.contents,[kind]:Object.freeze(value)})});}
  function updateSite(patch: Partial<NoticesSnapshot['site']>) {update({site:Object.freeze({...snapshot.site,...patch})});}
  function write(key: string,value: string) {try {storage?.setItem(key,value);} catch {}}
  function hydrate() {
    if (disposed || snapshot.hydrated) return;
    let seen = false, enabled = true, dismissed = false;
    try {
      seen = storage?.getItem(FIRST_USE_NOTICE_SEEN_STORAGE_KEY) === '1';
      if (!seen && LEGACY_FIRST_USE_KEYS.some(key=>!!storage?.getItem(key))) {seen = true; write(FIRST_USE_NOTICE_SEEN_STORAGE_KEY,'1');}
    } catch {}
    try {enabled = storage?.getItem(SITE_NOTICE_STORAGE_KEY) !== '0';} catch {}
    try {dismissed = storage?.getItem(SITE_NOTICE_DISMISSED_KEY) === '1';} catch {}
    update({hydrated:true,firstUseSeen:seen,site:Object.freeze({...snapshot.site,enabled,dismissed})});
  }
  async function fetchText(path: string, controller: AbortController): Promise<string> {
    const expected = new URL(path,base);
    const timeout = clock.set(()=>controller.abort(),requestTimeoutMs);
    controllers.add(controller);
    try {
      const response = await fetchImpl(expected.href,{cache:'no-store',signal:controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (response.url) {
        const actual = new URL(response.url);
        if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== expected.search) throw new Error('Packaged content redirected outside its declared source');
      } else if (response.redirected) throw new Error('Packaged content redirect identity unavailable');
      const value = (await response.text()).replace(/^\uFEFF/,'').trim();
      if (controller.signal.aborted || disposed) throw new DOMException('Notice request stopped','AbortError');
      if (new TextEncoder().encode(value).byteLength > maxContentBytes) throw new Error('Packaged content exceeds the size limit');
      return value;
    } finally {clock.clear(timeout);controllers.delete(controller);}
  }
  function loadContent(kind: PackagedContentKind): Promise<PackagedContent> {
    if (!Object.hasOwn(files,kind)) throw new Error('Unknown packaged content kind');
    if (disposed) return Promise.resolve(snapshot.contents[kind]);
    const previous = snapshot.contents[kind];
    if (previous.status === 'available' || previous.status === 'empty') return Promise.resolve(previous);
    const pending = loads.get(kind); if (pending) return pending;
    updateContent(kind,{...previous,status:'loading',error:null});
    const controller = new AbortController();
    const task = fetchText(files[kind],controller).then(async html => {
      const nodes=html?await parsePackagedContent(html,base.href):Object.freeze([]);
      if(html && !nodes.length)throw new Error('Packaged content has no supported readable markup');
      const result: PackagedContent = Object.freeze({kind,status:html?'available':'empty',html,nodes,error:null});
      updateContent(kind,result); return result;
    }).catch(reason => {
      const result: PackagedContent = Object.freeze({kind,status:'error',html:'',nodes:Object.freeze([]),error:text(reason)});
      if (!disposed) updateContent(kind,result);
      return result;
    }).finally(()=>{if(loads.get(kind)===task)loads.delete(kind);});
    loads.set(kind,task); return task;
  }
  async function showFirstUse(automatic = false): Promise<boolean> {
    if (disposed) return false; hydrate();
    if (automatic && (snapshot.firstUseSeen || automaticMode()!=='all')) return false;
    const ticket = ++firstSerial;
    const result = await loadContent('first-use');
    if (disposed || ticket !== firstSerial || automatic && (result.status !== 'available' || automaticMode()!=='all')) return false;
    const seen = snapshot.firstUseSeen || result.status === 'available';
    if (result.status === 'available') write(FIRST_USE_NOTICE_SEEN_STORAGE_KEY,'1');
    // Match main: available content is acknowledged on presentation, not close.
    update({firstUseOpen:true,firstUseSeen:seen}); return true;
  }
  function closeFirstUse() {firstSerial++;update({firstUseOpen:false});}
  async function showMultiplayer(gameId?: string): Promise<boolean> {
    if(disposed)return false;
    const ticket = ++guideSerial;
    update({multiplayerOpen:true,multiplayerGameId:gameId ?? null,multiplayerRequest:ticket});
    await loadContent('multiplayer');
    if(disposed || ticket!==guideSerial)return false;
    update({multiplayerOpen:true});return true;
  }
  function closeMultiplayer() {guideSerial++;update({multiplayerOpen:false});}
  function closeSite({dismiss = false}: {dismiss?: boolean} = {}) {
    siteSerial++;siteController?.abort();siteController=null;
    if(siteTimer!==null)clock.clear(siteTimer);siteTimer=null;
    if(dismiss)write(SITE_NOTICE_DISMISSED_KEY,'1');
    updateSite({open:false,scrollHidden:false,...(dismiss?{dismissed:true}:{})});
  }
  async function loadSite(automatic = false): Promise<boolean> {
    if(disposed || automatic && automaticMode()==='none')return false;hydrate();
    if(!snapshot.site.enabled)return false;
    const ticket = ++siteSerial;siteController?.abort();
    const controller = new AbortController();siteController=controller;
    try {
      const value = await fetchText('NOTICE.txt',controller);
      if(disposed || ticket!==siteSerial || !snapshot.site.enabled || !value || automatic && automaticMode()==='none')return false;
      if(siteTimer!==null)clock.clear(siteTimer);
      updateSite({lines:parseSiteNoticeText(value,base.href),open:true,scrollHidden:false,canOptOut:snapshot.site.dismissed});
      siteTimer=clock.set(()=>closeSite(),SITE_NOTICE_DURATION_MS);return true;
    } catch {return false;}
    finally {if(siteController===controller)siteController=null;}
  }
  function setSiteEnabled(enabled: boolean) {
    if(disposed)return;
    write(SITE_NOTICE_STORAGE_KEY,enabled?'1':'0');updateSite({enabled});
    if(enabled)void loadSite();else closeSite();
  }
  function showEntry(mode: 'all' | 'site-only' | 'none' = 'all'): Promise<boolean> {
    if(disposed || mode==='none')return Promise.resolve(false);
    if(entryPromise)return entryPromise;
    entryPromise=(async()=>{
      hydrate();
      if(mode==='all') {
        const request=showFirstUse(true), ticket=firstSerial;
        const shown=await request;
        if(shown)return true;
        if(disposed || firstSerial!==ticket || snapshot.firstUseOpen)return false;
      }
      return loadSite(true);
    })();return entryPromise;
  }
  return Object.freeze({
    getSnapshot:()=>snapshot,
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    hydrate,loadContent,showFirstUse,closeFirstUse,showMultiplayer,closeMultiplayer,loadSite,closeSite,setSiteEnabled,showEntry,
    /** Scroll only changes visibility; it never records a dismissal. */
    observeScroll(owner: object,position: number) {
      if(disposed || !snapshot.site.open)return;
      const current=Math.max(0,Number(position)||0), previous=positions.get(owner)??current;
      positions.set(owner,current);const delta=current-previous;
      if(Math.abs(delta)<3)return;
      if(delta>0 && current>10)updateSite({scrollHidden:true});
      else if(delta<0)updateSite({scrollHidden:false});
    },
    dispose(){if(disposed)return;disposed=true;siteSerial++;firstSerial++;guideSerial++;
      if(siteTimer!==null)clock.clear(siteTimer);siteTimer=null;
      for(const controller of controllers)controller.abort();controllers.clear();listeners.clear();},
  });
}
export type NoticesService = ReturnType<typeof createNoticesService>;
