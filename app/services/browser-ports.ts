import type {MidiSynthConstructor} from '../../src/launcher/app-types.mts';
/** Native browser edges, deliberately separate from file/package/session policy. */
export function createBrowserPorts({document, window, baseUrl}: {document: Document; window: Window; baseUrl: string}) {
  const vendorLoads = new Map<string, Promise<void>>();
  function loadVendor(path: string, ready: () => boolean, label: string): Promise<void> {
    if (ready()) return Promise.resolve();
    const pending = vendorLoads.get(path);
    if (pending) return pending;
    const task = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return; settled = true;
        window.clearTimeout(timer); script.onload = script.onerror = null;
        if (error) {script.remove(); reject(error);} else resolve();
      };
      const timer = window.setTimeout(() => finish(new Error(`${label} 加载超时，请重试`)), 30_000);
      script.src = new URL(path, baseUrl).href; script.async = true;
      script.onload = () => finish(ready() ? undefined : new Error(`${label} 加载后没有注册组件`));
      script.onerror = () => finish(new Error(`${label} 加载失败`));
      document.head.append(script);
    }).catch(error => {vendorLoads.delete(path); throw error;});
    vendorLoads.set(path, task); return task;
  }
  return {
    async copyText(text: string): Promise<boolean> {
      try {if (window.navigator.clipboard?.writeText) {await window.navigator.clipboard.writeText(text); return true;}} catch {}
      const area = document.createElement('textarea'), active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      area.value = text; area.readOnly = true; area.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0;pointer-events:none';
      (document.fullscreenElement || document.body).append(area); area.select(); area.setSelectionRange(0, area.value.length);
      let copied = false; try {copied = document.execCommand('copy');} catch {} area.remove(); active?.focus({preventScroll: true}); return copied;
    },
    async loadSynth(): Promise<MidiSynthConstructor | undefined> {
      const host = window as Window & {WebAudioTinySynth?: MidiSynthConstructor};
      await loadVendor('vendor/webaudio-tinysynth.min.js', () => !!host.WebAudioTinySynth, 'MIDI 合成器');
      return host.WebAudioTinySynth;
    },
    pickFile(accept: string): Promise<File | null> {
      const input = document.querySelector<HTMLInputElement>('#fileInput');
      if (!input) return Promise.reject(new Error('Launcher file input is not mounted'));
      input.accept = accept; input.multiple = false; input.value = '';
      return new Promise(resolve => {
        let settled = false;
        const finish = (file: File | null = null) => {if (settled) return; settled = true; input.onchange = input.oncancel = null; resolve(file);};
        input.onchange = () => finish(input.files?.[0] ?? null); input.oncancel = () => finish(); input.click();
      });
    },
    download(name: string, bytes: ArrayBuffer, mime: string) {
      const url = URL.createObjectURL(new Blob([bytes], {type: mime})), link = document.createElement('a');
      link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    afterPaint: () => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))),
  };
}
