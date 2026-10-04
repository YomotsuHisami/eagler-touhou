/** UI-only capability fixture. Never import this from application code.
 * Headless graphics are not this lane's subject: provide a synthetic result for
 * the early compatibility gate's one disposable context only. Canvas calls by
 * the Framework, Runtime, guide, or any later script retain their real behavior.
 * This does not establish browser, GPU, WebGL2, or game support. */
export function installSyntheticBrowserCompatibilityProbe() {
  const prototype = HTMLCanvasElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext')!;
  const nativeGetContext = descriptor.value;
  function restore() {
    if (prototype.getContext === probeContext) Object.defineProperty(prototype, 'getContext', descriptor);
    document.removeEventListener('DOMContentLoaded', restore);
  }
  function probeContext(this: HTMLCanvasElement, contextId: string, ...attributes: unknown[]) {
    const script = document.currentScript;
    if (contextId === 'webgl2' && script?.id === 'browser-compatibility-gate' &&
        script.getAttribute('data-compatibility-url')?.endsWith('/compatibility.html')) {
      restore();
      return {isContextLost: () => false, getExtension: (name: string) => name === 'WEBGL_lose_context' ? {loseContext() {}} : null};
    }
    return Reflect.apply(nativeGetContext, this, [contextId, ...attributes]);
  }
  Object.defineProperty(prototype, 'getContext', {...descriptor, value: probeContext});
  document.addEventListener('DOMContentLoaded', restore, {once: true});
}
