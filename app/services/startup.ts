import {roomCodeFromUrl} from '../../src/launcher/route-state.mts';

export interface StartupBootPort {
  ready(): void;
  fail?(kind: string, detail: string, resource?: string): void;
}
export interface StartupPorts {
  context: 'library' | 'lobby';
  url: string;
  lobbyOptionsEmbed?: boolean;
  /** Existing pre-framework main watchdog owns library decode/reveal/diagnosis. */
  boot: StartupBootPort;
  /** Resolves after the original directory finally/render boundary, on failure
   * as well as success; relay connectivity must not hold the visual boot gate. */
  waitDirectoryRendered(): Promise<void>;
  /** False means the user chose FAQ navigation; do not open another notice. */
  warnDiscouragedBrowser(isCurrent: () => boolean): Promise<boolean>;
  /** The shared content owner must recheck this before opening/marking seen. */
  showFirstUseAutomatically(isCurrent: () => boolean): Promise<boolean>;
  loadSiteNotice(): Promise<unknown>;
  onError(error: unknown): void;
}
export interface StartupOptions {
  document: Document;
  window: Window;
  baseUrl: string;
  decodeImage?: (source: string) => Promise<unknown>;
}
/** Document/session-owned startup policy. Attach after real notice carriers are
 * mounted. Deferred activation ignores StrictMode's immediately retired setup;
 * generations prevent old visual/notice completions affecting a newer binding.
 * This is not a second router or a replacement for the pre-module boot script. */
export function createStartupController(options: StartupOptions) {
  const {document: doc, window: win} = options;
  let generation = 0, disposed = false, libraryReady = false, lobbyRevealed = false;
  // The original Launcher and lobby documents have independent entry notice
  // sequences. Finishing the lobby must not consume an interrupted first-use
  // load when the shared application returns to its Launcher context.
  const noticesCompleted = new Set<StartupPorts['context']>();
  let active: {id: number; ports: StartupPorts} | null = null;
  const timeouts = new Set<number>(), rafs = new Set<number>();
  let removeFontTriggers: (() => void) | null = null;
  const decodeImage = options.decodeImage ?? ((source: string) => {
    const image = doc.createElement('img'); image.src = source;
    if (typeof image.decode === 'function') return image.decode().catch(() => {});
    return new Promise<void>(resolve => {image.onload = () => resolve(); image.onerror = () => resolve();});
  });
  function clearScheduled() {
    removeFontTriggers?.(); removeFontTriggers = null;
    for (const timer of timeouts) win.clearTimeout(timer); timeouts.clear();
    for (const raf of rafs) win.cancelAnimationFrame(raf); rafs.clear();
  }
  function bindDeferredFonts(id: number) {
    const load = () => {
      if (!current(id) || doc.querySelector('link[data-deferred-ui-fonts]')) return;
      const stylesheet = doc.createElement('link'); stylesheet.rel = 'stylesheet';
      stylesheet.href = new URL('ui-fonts-deferred.css', options.baseUrl).href;
      stylesheet.dataset.deferredUiFonts = 'true'; doc.head.append(stylesheet);
    };
    const config = {capture: true, once: true, passive: true};
    win.addEventListener('pointerdown', load, config); win.addEventListener('keydown', load, config);
    removeFontTriggers = () => {win.removeEventListener('pointerdown', load, config); win.removeEventListener('keydown', load, config);};
  }
  function current(id: number) {return !disposed && active?.id === id && generation === id;}
  function delay(callback: () => void, ms: number) {
    const timer = win.setTimeout(() => {timeouts.delete(timer); callback();}, ms); timeouts.add(timer); return timer;
  }
  function frame(callback: () => void) {
    const raf = win.requestAnimationFrame(() => {rafs.delete(raf); callback();}); rafs.add(raf);
  }
  function fonts() {
    if (!doc.fonts) return [];
    return [doc.fonts.load('400 16px "ET Yatra"', '0123456789 Normal Multiplayer'),
      ...[400, 700, 900].map(weight => doc.fonts.load(`${weight} 16px "ET Chill Round"`, '联机大厅東方紅魔郷妖々夢永夜抄花映塚風神録'))];
  }
  async function revealLobby(id: number, ports: StartupPorts) {
    // Work begins alongside manifest/directory initialization, as original main.
    const initial = Promise.allSettled([decodeImage(new URL('assets/launcher-background.webp', options.baseUrl).href), ...fonts()]);
    await ports.waitDirectoryRendered(); if (!current(id)) return;
    const covers = Array.from(doc.querySelectorAll<HTMLImageElement>('.lobby-main img')).filter(image => {
      const rect = image.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.top < win.innerHeight + 80 && rect.bottom > 0;
    });
    const visuals = Promise.allSettled([initial, ...covers.map(image => decodeImage(image.currentSrc || image.src))]);
    let deadline = 0;
    await Promise.race([visuals, new Promise<void>(resolve => {deadline = delay(resolve, 3000);})]);
    win.clearTimeout(deadline); timeouts.delete(deadline); if (!current(id)) return;
    frame(() => {if (!current(id)) return; frame(() => {
      if (!current(id)) return;
      lobbyRevealed = true;
      doc.documentElement.removeAttribute('data-lobby-boot');
      const main = doc.querySelector<HTMLElement>('.lobby-main'); if (main) main.inert = false;
      const preload = doc.getElementById('lobbyPreload');
      preload?.classList.add('is-done'); preload?.setAttribute('aria-hidden', 'true');
      delay(() => {if (current(id)) preload?.remove();}, 200);
    });});
  }
  async function notices(id: number, ports: StartupPorts) {
    const params = new URL(ports.url).searchParams;
    if (ports.lobbyOptionsEmbed) return;
    if (ports.context === 'lobby') {if (current(id)) await ports.loadSiteNotice(); return;}
    const debug = params.get('debug'), preview = params.get('preview');
    // Main's browser-warning condition intentionally has no room exclusion.
    if (!debug && !preview) {
      const continueVisit = await ports.warnDiscouragedBrowser(() => current(id));
      if (!current(id) || !continueVisit) return;
    }
    if (!current(id) || roomCodeFromUrl(ports.url)) return;
    if (debug || preview) {await ports.loadSiteNotice(); return;}
    const shown = await ports.showFirstUseAutomatically(() => current(id));
    if (current(id) && !shown) await ports.loadSiteNotice();
  }
  function attach(ports: StartupPorts): () => void {
    if (disposed) return () => {};
    const id = ++generation; active = {id, ports}; clearScheduled();
    queueMicrotask(() => {
      if (!current(id)) return;
      if (ports.context === 'library') bindDeferredFonts(id);
      if (ports.context === 'library' && !libraryReady) {
        libraryReady = true;
        // A document entered through the lobby has its own boot owner. Moving
        // to the library does not install or restart the library watchdog.
        if (doc.documentElement.getAttribute('data-original-entry') !== 'lobby') ports.boot.ready();
      }
      else if (ports.context === 'lobby' && !lobbyRevealed) void revealLobby(id, ports).catch(error => {if (current(id)) ports.onError(error);});
      if (!noticesCompleted.has(ports.context)) void notices(id, ports).then(() => {if (current(id)) noticesCompleted.add(ports.context);}).catch(error => {if (current(id)) ports.onError(error);});
    });
    return () => {if (active?.id === id) {active = null; generation++; clearScheduled();}};
  }
  return {attach, dispose() {if (disposed) return; disposed = true; active = null; generation++; clearScheduled();}};
}
export type StartupController = ReturnType<typeof createStartupController>;
