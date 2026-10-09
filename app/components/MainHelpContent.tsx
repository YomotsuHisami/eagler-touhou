import {useEffect, useRef, useState} from 'react';
import type {GameId} from '../../src/contracts/product-catalog.mts';
import type {TouchFocusMode} from '../../src/launcher/game-preferences.mts';
import {useLocale} from './LocaleProvider';
import {useMotionPreference} from './MotionPreferenceProvider';

/** main public/index.html tutorials and app.mts guide controller. The private
 * island keeps animation timers and generated shots tied to the visible Help. */
export function CanonicalHelpContent({thpracAvailable = false, touchEnabled, focusMode = 'hold-button'}: {
  gameId?: GameId; thpracAvailable?: boolean; touchEnabled?: boolean; focusMode?: TouchFocusMode;
}) {
  const {t} = useLocale(), {reducedMotion} = useMotionPreference();
  const root = useRef<HTMLDivElement>(null), [ios, setIos] = useState(false);
  useEffect(() => {setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1 ||
    new URLSearchParams(location.search).get('iosHelpPreview') === '1');}, []);
  useEffect(() => {
    const element = root.current;if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined, shots: ReturnType<typeof setInterval> | undefined;
    const durations: Record<string, number> = {focus: 7000, menu: 12000, dialogue: 4000};
    const stopShots = () => {clearInterval(shots);shots = undefined;element.querySelector('.shot-stream')?.replaceChildren();};
    const collapse = () => {
      clearTimeout(timer);stopShots();
      element.querySelectorAll('[data-guide-tab]').forEach(tab => tab.setAttribute('aria-expanded', 'false'));
      element.querySelectorAll<HTMLElement>('[data-guide-panel]').forEach(panel => {
        panel.querySelector<HTMLElement>('.guide-demo-body')!.hidden = true;panel.classList.remove('is-playing', 'is-finished');
      });
    };
    const emitShots = () => {
      const panel = element.querySelector<HTMLElement>('.focus-demo')!, stage = panel.querySelector<HTMLElement>('.focus-stage')!;
      if (document.hidden || reducedMotion || !panel.classList.contains('is-playing') || panel.classList.contains('is-finished')) return;
      const player = panel.querySelector<HTMLElement>('.demo-player')!.getBoundingClientRect(), bounds = stage.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const focused = Number.parseFloat(getComputedStyle(panel.querySelector('.finger-focus')!).opacity) > .45;
      const center = player.left - bounds.left + player.width / 2, start = player.top - bounds.top + 3;
      for (const side of [-1, 1]) {
        const shot = document.createElement('i');shot.className = 'demo-shot';
        shot.style.left = `${center + side * (focused ? 3 : 9)}px`;shot.style.top = `${start}px`;
        panel.querySelector('.shot-stream')!.append(shot);
        const animation = shot.animate([
          {transform: 'translate(-50%,-50%) rotate(45deg)', opacity: 0},
          {offset: .08, transform: 'translate(-50%,-50%) rotate(105deg)', opacity: 1},
          {transform: `translate(-50%,-${start + 18}px) rotate(765deg)`, opacity: 1},
        ], {duration: 760, easing: 'linear'});
        animation.onfinish = () => shot.remove();
      }
    };
    const play = (panel: HTMLElement) => {
      collapse();panel.querySelector('[data-guide-tab]')?.setAttribute('aria-expanded', 'true');
      panel.querySelector<HTMLElement>('.guide-demo-body')!.hidden = false;
      const name = panel.dataset.guidePanel!, duration = durations[name];if (!duration) return;
      if (reducedMotion) {panel.classList.add('is-finished');return;}
      void panel.offsetWidth;panel.classList.add('is-playing');
      if (name === 'focus') {emitShots();shots = setInterval(emitShots, 140);}
      timer = setTimeout(() => {panel.classList.add('is-finished');if (name === 'focus') stopShots();timer = undefined;}, duration);
    };
    const click = (event: Event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-guide-tab],.guide-replay') : null;
      const panel = button?.closest<HTMLElement>('[data-guide-panel]');if (!panel) return;
      if (button!.getAttribute('aria-expanded') === 'true') collapse();else play(panel);
    };
    collapse();element.addEventListener('click', click);
    return () => {collapse();element.removeEventListener('click', click);};
  }, [reducedMotion]);
  return <div ref={root} className={`main-help-content ${touchEnabled ? 'touch-help-touch-input' : ''}`}>
<main className="touch-guide">
          <section className="guide-panels">
            <article className="guide-scene guide-panel orientation-guide help-mobile-only" id="orientationGuideSource" data-guide-panel="orientation">
              <button className="guide-tab-card" id="guideTabOrientation" type="button" aria-expanded="false" aria-controls="guideOrientation" data-guide-tab="orientation"><span><strong id="guideOrientationTitle">{t(ios ? 'help.iphoneFullscreen' : 'help.manualLandscape')}</strong><small id="guideOrientationSummary">{t(ios ? 'help.iphoneFullscreenSummary' : 'help.orientationSummary')}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg></i></button>
              <div className="guide-demo-body" id="guideOrientation" hidden>
                <div id="guideOrientationAndroid" hidden={ios}>
                  <div className="orientation-guide-copy">
                    <ol className="orientation-steps">
                      <li>{t('help.turnPhone')}</li>
                      <li>{t('help.systemRotate')}</li>
                    </ol>
                  </div>
                  <figure className="android-rotation-example"><div className="rotation-phone" role="img" aria-label={t('help.rotateImageAlt')}><span className="rotation-screen-copy">{t('help.rotatePhone')}</span><span className="rotation-system-button"><svg className="touch-utility-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="M496-182 182-496q-23-23-23-54t23-54l174-174q23-23 54-23t54 23l314 314q23 23 23 54t-23 54L604-182q-23 23-54 23t-54-23Zm54-58 170-170-310-310-170 170 310 310Zm-70-240Zm79-393 77 77q11 11 11 28t-11 28q-11 11-28 11t-28-11L410-910q-12-12-6.5-28t22.5-19q14-2 27-2.5t27-.5q99 0 186.5 37.5t153 103q65.5 65.5 103 153T960-480q0 17-11.5 28.5T920-440q-17 0-28.5-11.5T880-480q0-71-24-136t-66.5-117Q747-785 688-821.5T559-873ZM401-87l-77-77q-11-11-11-28t11-28q11-11 28-11t28 11L550-50q12 12 6.5 28.5T534-3q-14 2-27 2.5T480 0q-99 0-186.5-37.5t-153-103Q75-206 37.5-293.5T0-480q0-17 11.5-28.5T40-520q17 0 28.5 11.5T80-480q0 71 24 136t66.5 117Q213-175 272-138.5T401-87Z"/></svg></span><span className="rotation-gesture-bar"></span></div><figcaption><svg className="touch-utility-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="M496-182 182-496q-23-23-23-54t23-54l174-174q23-23 54-23t54 23l314 314q23 23 23 54t-23 54L604-182q-23 23-54 23t-54-23Zm54-58 170-170-310-310-170 170 310 310Zm-70-240Zm79-393 77 77q11 11 11 28t-11 28q-11 11-28 11t-28-11L410-910q-12-12-6.5-28t22.5-19q14-2 27-2.5t27-.5q99 0 186.5 37.5t153 103q65.5 65.5 103 153T960-480q0 17-11.5 28.5T920-440q-17 0-28.5-11.5T880-480q0-71-24-136t-66.5-117Q747-785 688-821.5T559-873ZM401-87l-77-77q-11-11-11-28t11-28q11-11 28-11t28 11L550-50q12 12 6.5 28.5T534-3q-14 2-27 2.5T480 0q-99 0-186.5-37.5t-153-103Q75-206 37.5-293.5T0-480q0-17 11.5-28.5T40-520q17 0 28.5 11.5T80-480q0 71 24 136t66.5 117Q213-175 272-138.5T401-87Z"/></svg><span><span>{t('help.rotateCorner')}</span><small>{t('help.rotateVaries')}</small></span></figcaption></figure><p className="rotation-auto-tip"><strong>{t('help.autoRotate')}</strong><span>{t('help.autoRotateStep')}</span></p>
                </div>
                <div id="guideOrientationIos" hidden={!ios}>
                  <div className="orientation-guide-copy">
                    <ol className="orientation-steps">
                      <li><strong>{t('help.iosSafariShare')}</strong><br/><span>{t('help.iosSafariShareStep')}</span></li>
                      <li><strong>{t('help.iosAddHome')}</strong><br/><span>{t('help.iosAddHomeStep')}</span></li>
                      <li><strong>{t('help.iosWebApp')}</strong><br/><span>{t('help.iosWebAppStep')}</span></li>
                    </ol>
                  </div>
                </div>
              </div>
            </article>
            <article className="guide-scene guide-panel help-desktop-only" data-guide-panel="game-controls">
              <button className="guide-tab-card" id="guideTabGameControls" type="button" aria-expanded="false" aria-controls="guideGameControls" data-guide-tab="game-controls"><span><strong>{t('help.gameControls')}</strong><small>{t('help.gameControlsSummary')}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg></i></button>
              <div className="guide-demo-body" id="guideGameControls" hidden>
                <div className="guide-info">
                  <p className="guide-info-lead">{t('help.gameControlsIntro')}</p>
                  <div className="guide-key-grid">
                    <div className="guide-key-row"><kbd>{t('help.arrowKeys')}</kbd><span>{t('help.moveSelect')}</span></div>
                    <div className="guide-key-row"><kbd>Z</kbd><span>{t('help.fireConfirm')}</span></div>
                    <div className="guide-key-row"><kbd>X</kbd><span>{t('help.bombCancel')}</span></div>
                    <div className="guide-key-row"><kbd>Shift</kbd><span>{t('help.focusMove')}</span></div>
                    <div className="guide-key-row"><kbd>Esc</kbd><span>{t('help.pauseBack')}</span></div>
                    <div className="guide-key-row"><kbd>Ctrl</kbd><span>{t('help.skipDialogue')}</span></div>
                  </div>
                  <p className="guide-info-note">{t('help.gameControlsNote')}</p>
                </div>
              </div>
            </article>
            <article className="guide-scene guide-panel menu-demo help-mobile-only" data-guide-panel="menu">
              <button className="guide-tab-card" id="guideTabMenu" type="button" aria-expanded="false" aria-controls="guideMenu" data-guide-tab="menu"><span><strong>{t('help.menu')}</strong><small>{t('help.menuSummary')}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg></i></button>
              <div className="guide-demo-body" id="guideMenu" hidden>
                <div className="menu-stage">
                  <div className="menu-question">CONTINUE?</div>
                  <div className="menu-choices"><span className="choice-yes">YES</span><span className="choice-no">NO</span></div>
                  <div className="menu-result result-yes"><small>INPUT</small><b>YES</b></div>
                  <div className="menu-result result-no"><small>INPUT</small><b>NO</b></div>
                  <i className="demo-finger menu-finger-one"></i><i className="demo-finger menu-finger-two"></i>
                  <span className="menu-phase phase-confirm">{t('help.tapConfirm')}</span>
                  <span className="menu-phase phase-select">{t('help.slideConfirm')}</span>
                  <span className="menu-phase phase-back">{t('help.twoFingerBack')}</span>
                </div>
                <button className="guide-replay" type="button">{t('action.replay')}</button>
              </div>
            </article>
            <article className="guide-scene guide-panel focus-demo help-mobile-only" data-guide-panel="focus" data-focus-mode={focusMode}>
              <button className="guide-tab-card" id="guideTabFocus" type="button" aria-expanded="false" aria-controls="guideFocus" data-guide-tab="focus"><span><strong>{t('help.inGame')}</strong><small id="guideFocusSummary">{t(focusMode === 'two-finger' ? 'help.focusTwoFingerSummary' : focusMode === 'toggle-button' ? 'help.focusToggleSummary' : 'help.focusHoldSummary')}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg></i></button>
              <div className="guide-demo-body" id="guideFocus" hidden>
                <div className="focus-stage">
                  <span className="shot-stream" aria-hidden="true"></span>
                  <i className="demo-player"></i><i className="demo-hitbox"></i>
                  <i className="demo-finger finger-move"></i>
                  <div className="focus-mode-control" id="guideFocusControl" aria-hidden="true"><strong>{t('touch.focus')}</strong><small id="guideFocusControlHint">{focusMode === 'two-finger' ? '' : t(focusMode === 'toggle-button' ? 'help.toggle' : 'help.hold')}</small></div>
                  <i className="demo-finger finger-focus"></i>
                  <span className="move-trace"></span>
                  <b className="focus-label" id="guideFocusLabel">{t(focusMode === 'two-finger' ? 'help.focusTwoFingerLabel' : focusMode === 'toggle-button' ? 'help.focusToggleLabel' : 'help.holdFocus')}</b>
                </div>
                <button className="guide-replay" type="button">{t('action.replay')}</button>
              </div>
            </article>
            <article className="guide-scene guide-panel dialogue-demo help-mobile-only" data-guide-panel="dialogue">
              <button className="guide-tab-card" id="guideTabDialogue" type="button" aria-expanded="false" aria-controls="guideDialogue" data-guide-tab="dialogue"><span><strong>{t('help.dialogue')}</strong><small>{t('help.dialogueSummary')}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg></i></button>
              <div className="guide-demo-body" id="guideDialogue" hidden>
                <div className="dialogue-stage">
                  <div className="dialogue-portrait">?</div>
                  <div className="dialogue-box"><div className="dialogue-ticker"><span>{t('help.dialogue1')}</span><span>{t('help.dialogue2')}</span><span>{t('help.dialogue3')}</span><span>{t('help.dialogue4')}</span><span>{t('help.dialogue1')}</span></div></div>
                  <i className="demo-finger dialogue-finger"></i><i className="hold-ring"></i>
                </div>
                <button className="guide-replay" type="button">{t('action.replay')}</button>
              </div>
            </article>
            <article className="guide-scene guide-panel" data-guide-panel="thprac" hidden={!thpracAvailable}>
              <button className="guide-tab-card" id="guideTabThprac" type="button" aria-expanded="false" aria-controls="guideThprac" data-guide-tab="thprac"><span><strong>thprac</strong><small>{t('help.thpracSummary')}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg></i></button>
              <div className="guide-demo-body" id="guideThprac" hidden>
                <div className="guide-info">
                  <p className="guide-info-lead">{t('help.thpracIntro')}</p>
                  <div className="guide-key-grid guide-key-grid-thprac help-desktop-only">
                    <div className="guide-key-row"><kbd>Backspace</kbd><span>{t('touch.cheatMenu')}</span></div>
                    <div className="guide-key-row"><kbd>Tab</kbd><span>{t('help.tracker')}</span></div>
                    <div className="guide-key-row"><kbd>F12</kbd><span>{t('touch.advancedMenu')}</span></div>
                    <div className="guide-key-row"><kbd>F1</kbd><span>{t('touch.invincible')}</span></div>
                    <div className="guide-key-row"><kbd>F2</kbd><span>{t('touch.infiniteLives')}</span></div>
                    <div className="guide-key-row"><kbd>F3</kbd><span>{t('touch.infiniteBombs')}</span></div>
                    <div className="guide-key-row"><kbd>F4</kbd><span>{t('touch.infinitePower')}</span></div>
                    <div className="guide-key-row"><kbd>F5</kbd><span>{t('touch.timeLock')}</span></div>
                    <div className="guide-key-row"><kbd>F6</kbd><span>{t('touch.autoBomb')}</span></div>
                    <div className="guide-key-row"><kbd>F7</kbd><span>{t('touch.enemyBgm')}</span></div>
                  </div>
                  <div className="guide-key-grid help-mobile-only">
                    <div className="guide-key-row"><kbd>{t('touch.cheatMenu')}</kbd><span>{t('help.cheatMenu')}</span></div>
                    <div className="guide-key-row"><kbd>Tab</kbd><span>{t('help.tracker')}</span></div>
                    <div className="guide-key-row"><kbd>F12</kbd><span>{t('touch.advancedMenu')}</span></div>
                    <div className="guide-key-row"><kbd>F1–F7</kbd><span>{t('help.thpracFeatures')}</span></div>
                  </div>
                  <p className="guide-info-note help-desktop-only">{t('help.thpracReplayDesktop')}</p>
                  <p className="guide-info-note help-mobile-only">{t('help.thpracReplayMobile')}</p>
                </div>
              </div>
            </article>
          </section>
        </main>
  </div>;
}
