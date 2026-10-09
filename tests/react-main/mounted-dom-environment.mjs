/** Synthetic DOM capabilities only. No browser, server, network or rendering claim. */
import {JSDOM} from 'jsdom';

export function installMountedDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://launcher.invalid/', pretendToBeVisual: true,
    // No runScripts/resources option: fixtures do not fetch or execute page assets.
  });
  const {window} = dom;
  const errors = [];
  window.addEventListener('error', event => errors.push(String(event.error?.message || event.message)));
  const originalConsoleError = console.error;
  console.error = (...args) => {errors.push(args.map(value => value instanceof Error ? value.message : String(value)).join(' ')); originalConsoleError(...args);};
  const originals = new Map();
  const expose = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  };
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement',
    'HTMLSelectElement', 'HTMLDialogElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent',
    'SubmitEvent', 'CustomEvent', 'MutationObserver', 'DOMRect', 'CSS', 'FormData', 'File', 'Blob']) expose(key, key === 'window' ? window : window[key]);
  expose('getComputedStyle', window.getComputedStyle.bind(window));
  expose('requestAnimationFrame', window.requestAnimationFrame.bind(window));
  expose('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  window.matchMedia = query => ({media: query, matches: query.includes('prefers-reduced-motion'),
    onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() {return true;}});
  expose('matchMedia', window.matchMedia);
  // These fixtures never assert resize/layout correctness. Browser-only observers
  // are quiet because each explicit geometry measurement remains constant.
  window.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
  expose('ResizeObserver', window.ResizeObserver);
  const Pointer = window.PointerEvent ?? class extends window.MouseEvent {
    constructor(type, options = {}) {
      super(type, options);
      Object.defineProperties(this, {
        pointerId: {value: options.pointerId ?? 1}, pointerType: {value: options.pointerType ?? 'mouse'},
        isPrimary: {value: true},
      });
    }
  };
  expose('PointerEvent', Pointer); window.PointerEvent = Pointer;
  if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
  if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function (value = '') {
    this.returnValue = value; this.open = false; this.dispatchEvent(new window.Event('close'));
  };
  window.HTMLElement.prototype.scrollTo = function (options) {
    if (typeof options === 'object') {this.scrollLeft = options.left ?? this.scrollLeft; this.scrollTop = options.top ?? this.scrollTop;}
  };
  // Synthetic measured rectangles support actual editor event handling; they do
  // not replace the layout model or any Router operation, nor test authored CSS.
  const rect = (left, top, width, height) => new window.DOMRect(left, top, width, height);
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hidden || this.closest('[hidden]')) return rect(0, 0, 0, 0);
    if (this.id === 'touchLayoutEditor') return rect(980, 76, 260, 400);
    if (this.id === 'touchLayoutReservedZone') return rect(1000, 0, 280, 50);
    if (this.dataset.touchLayoutControl) return rect(150, 200, 64, 64);
    if (this.classList.contains('game')) return rect(0, 0, 240, 360);
    return rect(0, 0, 1280, 800);
  };
  for (const dimension of ['clientWidth', 'offsetWidth', 'scrollWidth']) Object.defineProperty(window.HTMLElement.prototype, dimension,
    {configurable: true, get() {return this.getBoundingClientRect().width;}});
  for (const dimension of ['clientHeight', 'offsetHeight', 'scrollHeight']) Object.defineProperty(window.HTMLElement.prototype, dimension,
    {configurable: true, get() {return this.getBoundingClientRect().height;}});
  return {window, document: window.document, errors, close() {
    console.error = originalConsoleError;
    window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }};
}
