/** SYNTHETIC DOM: no native unload prompt, game bytes or Runtime protocol peer. */
import {createDocumentRequestScope} from '../../app/services/document-request-scope';
import {observeRuntimeRequestResume} from '../../app/runtime/runtime-frame-request-resume';

const frame = document.getElementById('game') as HTMLIFrameElement;
const status = document.getElementById('status')!;
let requests = 0, resolved = 0, rejected = 0, visible = true;
const epoch = 7;
const scope = createDocumentRequestScope({target: window,
  canResume: () => visible && document.visibilityState === 'visible',
  fetchImpl: async () => {requests++; return new Response(null, {status: 204});}});
scope.attach();
let detach = () => {};
function connect() {
  if (!frame.contentDocument?.querySelector('button')) return;
  detach();
  detach = observeRuntimeRequestResume({frame: () => frame,
    context: () => ({target: frame.contentWindow, epoch, ready: true}), resume: scope.resumeFromTrustedInput});
  status.textContent = 'Synthetic input ready';
}
frame.addEventListener('load', connect); connect();
window.__requestResumeFixture = {
  pauseAndRequest() {
    window.dispatchEvent(new Event('beforeunload'));
    void scope.fetch('/synthetic-music.ogg').then(() => {resolved++;}, () => {rejected++;});
  },
  syntheticInput() {
    frame.contentWindow?.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', bubbles: true}));
    frame.contentWindow?.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    window.postMessage({kind: 'resume-network'}, location.origin);
  },
  setVisible(value) {visible = value;},
  hide() {window.dispatchEvent(new Event('pagehide'));},
  inspect: () => ({requests, resolved, rejected, epoch}),
};
declare global {
  interface Window {__requestResumeFixture: {
    pauseAndRequest(): void; syntheticInput(): void; setVisible(value: boolean): void; hide(): void;
    inspect(): {requests: number; resolved: number; rejected: number; epoch: number};
  }}
}
