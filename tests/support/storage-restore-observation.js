// Test observation only. This function runs before scripts in each document.
// It neither injects a failure nor changes Runtime events, flags or navigation.
({game, runtimeName}) => {
  const key = '__originalStorageRestoreObservation';
  if (window.parent !== window) {
    try {window.parent[key]?.bind(window, document, window.frameElement);} catch { /* Missing/inaccessible binding must later fail, never fabricate evidence. */ }
    return;
  }
  let armedFrame = null, bound = null, captured = null, phaseViolation = false;
  function currentIdentity(frame, child, childDocument) {
    if (!(frame instanceof HTMLIFrameElement) || !frame.isConnected || document.getElementById('gameFrame') !== frame ||
        frame.contentWindow !== child || frame.contentDocument !== childDocument || child.document !== childDocument) return null;
    const href = child.location.href, url = new URL(href), epochs = url.searchParams.getAll('runtimeEpoch');
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || childDocument.URL !== href ||
        url.pathname.split('/').pop() !== runtimeName || epochs.length !== 1) return null;
    const epoch = Number(epochs[0]);
    if (!Number.isSafeInteger(epoch) || epoch <= 0 || String(epoch) !== epochs[0]) return null;
    return {frame, child, document: childDocument, href, epoch};
  }
  const owner = Object.freeze({
    arm() {
      if (armedFrame) throw new Error('Storage restore observation is already armed');
      const frame = document.getElementById('gameFrame');
      if (!(frame instanceof HTMLIFrameElement) || !frame.isConnected) throw new Error('Storage restore observation requires the real Runtime iframe');
      armedFrame = frame;
    },
    bind(child, childDocument, frame) {
      if (!armedFrame || bound || frame !== armedFrame) return false;
      try {bound = currentIdentity(frame, child, childDocument);} catch {return false;}
      return bound !== null;
    },
    snapshot() {
      if (!captured) throw new Error(phaseViolation
        ? 'Restore failure followed ready/first-frame; no eligible pre-ready observation'
        : 'No authenticated restore-failure observation for the bound Runtime document');
      return captured;
    },
  });
  Object.defineProperty(window, key, {value: owner});
  window.addEventListener('message', event => {
    if (!bound || captured || event.source !== bound.child || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.protocol !== 'eagler-touhou/1' ||
        message.game !== game || !Number.isSafeInteger(message.epoch) || message.epoch <= 0 || message.epoch !== bound.epoch) return;
    let current;
    try {current = currentIdentity(bound.frame, bound.child, bound.document);} catch {return;}
    if (!current || current.href !== bound.href || current.epoch !== bound.epoch) return;
    if (message.event === 'ready' || message.event === 'first-frame') {phaseViolation = true; return;}
    if (phaseViolation || message.event !== 'error' || typeof message.error !== 'string' || !message.error.includes('injected restore failure')) return;
    // All observations happen before later Runtime listeners can retire this
    // document. False flags remain false for the unchanged original assertions.
    captured = Object.freeze({url: current.href,
      injected: bound.child.__eaglerStorageRestoreFailureInjected === true,
      triggered: bound.child.__eaglerStorageRestoreFailureTriggered === true});
  }, {capture: true});
}
