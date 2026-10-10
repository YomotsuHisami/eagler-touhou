// Opt-in test observation only. Never changes the frame, its attributes or URL.
(() => {
  function currentDocument(frame) {
    if (!(frame instanceof HTMLIFrameElement) || !frame.isConnected) {
      throw new Error('Runtime iframe is missing or detached');
    }
    const child = frame.contentWindow, document = frame.contentDocument;
    if (!child || !document) throw new Error('Runtime iframe document is inaccessible');
    const href = child.location.href;
    if (document.URL !== href) throw new Error('Runtime iframe document URL does not match its location');
    const url = new URL(href);
    if (href !== 'about:blank' && (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin)) {
      throw new Error('Runtime iframe document must share the Launcher origin');
    }
    return {href, document};
  }
  Object.defineProperty(globalThis, '__originalRuntimeDocumentObservation', {value: Object.freeze({
    url(frame) {return currentDocument(frame).href;},
    hasRuntimeEpoch(frame) {
      try {return currentDocument(frame).href.includes('runtimeEpoch=');}
      catch {return false;}
    },
    blank(frame) {
      try {
        const {href, document} = currentDocument(frame);
        return href === 'about:blank' && document.readyState === 'complete';
      } catch {return false;}
    },
  })});
})();
