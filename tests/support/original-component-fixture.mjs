import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {authoredSourcesPlugin} from '../react-main/authored-sources.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));

/** Adapter entry only: mount the production React owner behind the original
 * harness's show/returns probes. No copied markup, copy, model or assertions.
 * The network input replaces the original calibration-only DOM harness, not a
 * native Runtime or authenticated multiplayer session. */
export async function buildOriginalComponentFixture(name) {
  const entries = {
    'netplay-recovery': `
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {NetplayConnectionWindow} from './app/components/NetplayConnectionWindow.tsx';
    import {createNetplayCalibration} from './app/models/netplay-calibration.ts';
    const calibration = createNetplayCalibration({epoch: 1, userAgent: navigator.userAgent, timers: window});
    const network = {connection: null, returnToRoom: false, calibrationEligible: true,
      playerStatusVisible: false, playerStatus: [], diagnostics: {}};
    const root = createRoot(document.getElementById('fixture'));
    window.returns = 0;
    window.show = phase => {
      flushSync(() => {
        calibration.record({phase, attempt: 2, maxAttempts: 4, reason: 1, probes: 10, replies: 1}, 1);
        root.render(<NetplayConnectionWindow network={network} calibration={calibration}
          english={document.documentElement.dataset.uiLocale === 'en'} onReturn={() => ++window.returns}/>);
      });
    };
    window.addEventListener('pagehide', () => {root.unmount(); calibration.dispose();}, {once: true});
    window.show('retrying');
    window.ready = true;
    `,
    'keyboard-ownership': `
    import {createPlayerKeyboard} from './app/services/player-keyboard.ts';
    import {deliverRuntimeInput} from './src/launcher/touch-runtime-protocol.mts';
    export {createFunctionKeyOwner} from './src/launcher/touch-function-key.mts';
    // The existing harness owns real candidate Runtime configure/launch and
    // context. This supplies only its protocol port to the production keyboard
    // owner; no key state, SDL probe, network outcome or success is synthesized.
    export function installKeyboardOwnershipFixture({state, frame, player, touchRuntimeMessageContext, releaseHeldTouchFire, touchFunctionOwner}) {
      const listeners = new Set();
      const runtime = {
        getInputContext: touchRuntimeMessageContext,
        getSnapshot: () => ({launched: state.launched, ready: state.launched, firstFrame: false}),
        getMidiEventContext() {
          const context = touchRuntimeMessageContext();
          if (!context.ready || !frame.contentWindow || !frame.contentDocument) return null;
          return {epoch: context.epoch, game: context.game, document: frame.contentDocument, target: frame.contentWindow, music: 'none'};
        },
        postInput(command, payload) {
          const context = touchRuntimeMessageContext();
          if (!context.ready || !context.launched || context.spectator) return false;
          return deliverRuntimeInput(context, {...payload, protocol: context.protocol, game: context.game, epoch: context.epoch, command});
        },
        subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
      };
      const owner = createPlayerKeyboard({runtime, window, document, frame,
        playerOpen: () => player.classList.contains('open'),
        launcherOwnsTarget: target => target instanceof Element && !!target.closest('input,select,textarea,button,dialog,[role=dialog]'),
        releaseHeldTouchFire, cancelTouchFunction: () => touchFunctionOwner.cancel(), android: false,
        isPlayerFullscreen: () => document.fullscreenElement === player,
        toggleFullscreen: () => {void (document.fullscreenElement === player ? document.exitFullscreen() : player.requestFullscreen());},
      });
      // The original pagehide action is a cancellation test, not teardown:
      // disposing there would break its subsequent fresh-DOWN assertion.
      return {sync() {for (const listener of listeners) listener();}, dispose: owner.dispose};
    }
    `,
    'multiplayer-quick-chat': `
    import {createRoot} from 'react-dom/client';
    import {createPortal, flushSync} from 'react-dom';
    import {MultiplayerQuickChat as QuickChatView} from './app/components/player/MultiplayerQuickChat.tsx';
    import {createMultiplayerQuickChatModel} from './src/launcher/multiplayer-quick-chat-model.mts';
    import {playQuickChatVoice} from './src/launcher/quick-chat-voice.mts';
    import {LocaleProvider, translate} from './app/i18n.tsx';
    // The original fixture supplies these six Chinese labels independently of
    // the game's phrase language. Reject different inputs rather than replace
    // its copy or introduce a production translation override.
    export class MultiplayerQuickChat {
      constructor(parent, text, send) {
        for (const key of ['chat.players', 'chat.back', 'chat.prompt', 'chat.mute', 'chat.unmute', 'chat.empty']) {
          if (text(key) !== translate('zh-CN', key)) throw new Error('Original quick-chat fixture translation mismatch: ' + key);
        }
        const model = createMultiplayerQuickChatModel({send, voice: playQuickChatVoice, timers: window});
        // A detached React root plus portal retains the original direct-child
        // Player geometry and leaves its original controls/iframe untouched.
        const root = createRoot(document.createElement('div'));
        flushSync(() => root.render(createPortal(<LocaleProvider locale="zh-CN"><QuickChatView model={model}/></LocaleProvider>, parent)));
        this.update = next => flushSync(() => model.update(next));
        this.receive = message => flushSync(() => model.receive(message));
        window.addEventListener('pagehide', () => {root.unmount(); model.dispose();}, {once: true});
      }
    }
    `,
    'multiplayer-guide': `
    export {createMultiplayerGuideController} from './tests/support/original-content-fixture.tsx';
    `,
    'content-fragments': `
    export {createFirstUseNoticeController, createMultiplayerGuideController} from './tests/support/original-content-fixture.tsx';
    `,
  };
  if (!Object.hasOwn(entries, name)) throw new Error(`Unknown original component fixture: ${name}`);
  const result = await build({absWorkingDir: project, stdin: {resolveDir: project, loader: 'tsx', contents: entries[name]}, bundle: true, platform: 'browser', format: 'esm', write: false, jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"production"'}, metafile: true,
    plugins: [authoredSourcesPlugin(project)], logLevel: 'silent'});
  return {
    html: '<!doctype html><html data-ui-locale="zh"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><div id="fixture"></div><script type="module" src="/__original-component-fixture.mjs"></script></html>',
    module: result.outputFiles[0].text,
    inputs: Object.keys(result.metafile.inputs).sort(),
    ...(name === 'netplay-recovery' ? {panelSelector: '#netplayConnectionWindow'} : {}),
  };
}

/** Opt-in Node harness selection; main starts no fixture build. */
export async function originalComponentFixture(name, target = process.env.EAGLER_COMPONENT_TEST_TARGET ?? 'main') {
  if (target !== 'main' && target !== 'react') throw new Error('EAGLER_COMPONENT_TEST_TARGET must be main or react');
  return target === 'main' ? null : buildOriginalComponentFixture(name);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(await buildOriginalComponentFixture(process.argv[2])));
}
