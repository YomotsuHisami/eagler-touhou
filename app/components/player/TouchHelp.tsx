import {useLayoutEffect, useRef} from 'react';
import type {TouchFocusMode} from '../../../src/launcher/game-preferences.mts';
import {useLocale} from '../../i18n';
import {useTouchGuidePlayback} from './use-touch-guide-playback';

export interface TouchHelpProps {
  open: boolean;
  onCloseRequest(): void;
  touchEnabled: boolean;
  focusMode: TouchFocusMode;
  showIosFullscreenHelp: boolean;
}
/** Original index.html938–1065 and app.mts2216–2225/3674–3782/4816.
 * This hidden Player overlay never adds a native dialog or history entry.
 * Seen gating and game refocus stay with the actual Player session owner. */
export function TouchHelp({open, onCloseRequest, touchEnabled, focusMode, showIosFullscreenHelp}: TouchHelpProps) {
  const {t} = useLocale(), root = useRef<HTMLDivElement>(null);
  const playback = useTouchGuidePlayback(root, open);
  const close = () => {playback.collapse(); onCloseRequest();};
  useLayoutEffect(() => {
    const player = root.current?.closest('#player');
    player?.classList.toggle('help-visible', open);
    return () => {player?.classList.remove('help-visible');};
  }, [open]);
  return <div id="touchHelp" role="dialog" aria-modal="true" aria-labelledby="touchHelpTitle" className={`touch-help${touchEnabled ? ' touch-help-touch-input' : ''}`} hidden={!open} ref={root} onClick={event => {if (event.target === event.currentTarget) close();}}>
      <div className="touch-help-window">
        <header className="touch-help-bar">
          <div className="touch-help-heading"><strong id="touchHelpTitle" data-i18n="help.title">{t("help.title")}</strong><small data-i18n="help.subtitle">{t("help.subtitle")}</small></div>
          <button id="touchHelpClose" type="button" data-i18n-aria-label="help.close" data-i18n-title="action.close" aria-label={t("help.close")} title={t("action.close")} onClick={close}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"></path></svg>
          </button>
        </header>
        <main className="touch-guide">
          <section className="guide-panels">
            <article className="guide-scene guide-panel orientation-guide help-mobile-only" id="orientationGuideSource" data-guide-panel="orientation">
              <button className="guide-tab-card" id="guideTabOrientation" type="button" aria-controls="guideOrientation" data-guide-tab="orientation" aria-expanded={playback.active === 'orientation'} onClick={() => playback.toggle('orientation')}><span><strong id="guideOrientationTitle" data-i18n="help.manualLandscape">{t(showIosFullscreenHelp ? 'help.iphoneFullscreen' : 'help.manualLandscape')}</strong><small id="guideOrientationSummary" data-i18n="help.orientationSummary">{t(showIosFullscreenHelp ? 'help.iphoneFullscreenSummary' : 'help.orientationSummary')}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"></path></svg></i></button>
              <div className="guide-demo-body" id="guideOrientation" hidden={playback.active !== 'orientation'}>
                <div id="guideOrientationAndroid" hidden={showIosFullscreenHelp}>
                  <div className="orientation-guide-copy">
                    <ol className="orientation-steps">
                      <li data-i18n="help.turnPhone">{t("help.turnPhone")}</li>
                      <li data-i18n="help.systemRotate">{t("help.systemRotate")}</li>
                    </ol>
                  </div>
                  <figure className="android-rotation-example"><div className="rotation-phone" role="img" data-i18n-aria-label="help.rotateImageAlt" aria-label={t("help.rotateImageAlt")}><span className="rotation-screen-copy" data-i18n="help.rotatePhone">{t("help.rotatePhone")}</span><span className="rotation-system-button"><svg className="touch-utility-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="M496-182 182-496q-23-23-23-54t23-54l174-174q23-23 54-23t54 23l314 314q23 23 23 54t-23 54L604-182q-23 23-54 23t-54-23Zm54-58 170-170-310-310-170 170 310 310Zm-70-240Zm79-393 77 77q11 11 11 28t-11 28q-11 11-28 11t-28-11L410-910q-12-12-6.5-28t22.5-19q14-2 27-2.5t27-.5q99 0 186.5 37.5t153 103q65.5 65.5 103 153T960-480q0 17-11.5 28.5T920-440q-17 0-28.5-11.5T880-480q0-71-24-136t-66.5-117Q747-785 688-821.5T559-873ZM401-87l-77-77q-11-11-11-28t11-28q11-11 28-11t28 11L550-50q12 12 6.5 28.5T534-3q-14 2-27 2.5T480 0q-99 0-186.5-37.5t-153-103Q75-206 37.5-293.5T0-480q0-17 11.5-28.5T40-520q17 0 28.5 11.5T80-480q0 71 24 136t66.5 117Q213-175 272-138.5T401-87Z"></path></svg></span><span className="rotation-gesture-bar"></span></div><figcaption><svg className="touch-utility-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path d="M496-182 182-496q-23-23-23-54t23-54l174-174q23-23 54-23t54 23l314 314q23 23 23 54t-23 54L604-182q-23 23-54 23t-54-23Zm54-58 170-170-310-310-170 170 310 310Zm-70-240Zm79-393 77 77q11 11 11 28t-11 28q-11 11-28 11t-28-11L410-910q-12-12-6.5-28t22.5-19q14-2 27-2.5t27-.5q99 0 186.5 37.5t153 103q65.5 65.5 103 153T960-480q0 17-11.5 28.5T920-440q-17 0-28.5-11.5T880-480q0-71-24-136t-66.5-117Q747-785 688-821.5T559-873ZM401-87l-77-77q-11-11-11-28t11-28q11-11 28-11t28 11L550-50q12 12 6.5 28.5T534-3q-14 2-27 2.5T480 0q-99 0-186.5-37.5t-153-103Q75-206 37.5-293.5T0-480q0-17 11.5-28.5T40-520q17 0 28.5 11.5T80-480q0 71 24 136t66.5 117Q213-175 272-138.5T401-87Z"></path></svg><span><span data-i18n="help.rotateCorner">{t("help.rotateCorner")}</span><small data-i18n="help.rotateVaries">{t("help.rotateVaries")}</small></span></figcaption></figure><p className="rotation-auto-tip"><strong data-i18n="help.autoRotate">{t("help.autoRotate")}</strong><span data-i18n="help.autoRotateStep">{t("help.autoRotateStep")}</span></p>
                </div>
                <div id="guideOrientationIos" hidden={!showIosFullscreenHelp}>
                  <div className="orientation-guide-copy">
                    <ol className="orientation-steps">
                      <li><strong data-i18n="help.iosSafariShare">{t("help.iosSafariShare")}</strong><br/><span data-i18n="help.iosSafariShareStep">{t("help.iosSafariShareStep")}</span></li>
                      <li><strong data-i18n="help.iosAddHome">{t("help.iosAddHome")}</strong><br/><span data-i18n="help.iosAddHomeStep">{t("help.iosAddHomeStep")}</span></li>
                      <li><strong data-i18n="help.iosWebApp">{t("help.iosWebApp")}</strong><br/><span data-i18n="help.iosWebAppStep">{t("help.iosWebAppStep")}</span></li>
                    </ol>
                  </div>
                </div>
              </div>
            </article>
            <article className="guide-scene guide-panel help-desktop-only" data-guide-panel="game-controls">
              <button className="guide-tab-card" id="guideTabGameControls" type="button" aria-controls="guideGameControls" data-guide-tab="game-controls" aria-expanded={playback.active === 'game-controls'} onClick={() => playback.toggle('game-controls')}><span><strong data-i18n="help.gameControls">{t("help.gameControls")}</strong><small data-i18n="help.gameControlsSummary">{t("help.gameControlsSummary")}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"></path></svg></i></button>
              <div className="guide-demo-body" id="guideGameControls" hidden={playback.active !== 'game-controls'}>
                <div className="guide-info">
                  <p className="guide-info-lead" data-i18n="help.gameControlsIntro">{t("help.gameControlsIntro")}</p>
                  <div className="guide-key-grid">
                    <div className="guide-key-row"><kbd data-i18n="help.arrowKeys">{t("help.arrowKeys")}</kbd><span data-i18n="help.moveSelect">{t("help.moveSelect")}</span></div>
                    <div className="guide-key-row"><kbd>Z</kbd><span data-i18n="help.fireConfirm">{t("help.fireConfirm")}</span></div>
                    <div className="guide-key-row"><kbd>X</kbd><span data-i18n="help.bombCancel">{t("help.bombCancel")}</span></div>
                    <div className="guide-key-row"><kbd>Shift</kbd><span data-i18n="help.focusMove">{t("help.focusMove")}</span></div>
                    <div className="guide-key-row"><kbd>Esc</kbd><span data-i18n="help.pauseBack">{t("help.pauseBack")}</span></div>
                    <div className="guide-key-row"><kbd>Ctrl</kbd><span data-i18n="help.skipDialogue">{t("help.skipDialogue")}</span></div>
                  </div>
                  <p className="guide-info-note" data-i18n="help.gameControlsNote">{t("help.gameControlsNote")}</p>
                </div>
              </div>
            </article>
            <article className="guide-scene guide-panel menu-demo help-mobile-only" data-guide-panel="menu">
              <button className="guide-tab-card" id="guideTabMenu" type="button" aria-controls="guideMenu" data-guide-tab="menu" aria-expanded={playback.active === 'menu'} onClick={() => playback.toggle('menu')}><span><strong data-i18n="help.menu">{t("help.menu")}</strong><small data-i18n="help.menuSummary">{t("help.menuSummary")}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"></path></svg></i></button>
              <div className="guide-demo-body" id="guideMenu" hidden={playback.active !== 'menu'}>
                <div className="menu-stage">
                  <div className="menu-question">CONTINUE?</div>
                  <div className="menu-choices"><span className="choice-yes">YES</span><span className="choice-no">NO</span></div>
                  <div className="menu-result result-yes"><small>INPUT</small><b>YES</b></div>
                  <div className="menu-result result-no"><small>INPUT</small><b>NO</b></div>
                  <i className="demo-finger menu-finger-one"></i><i className="demo-finger menu-finger-two"></i>
                  <span className="menu-phase phase-confirm" data-i18n="help.tapConfirm">{t("help.tapConfirm")}</span>
                  <span className="menu-phase phase-select" data-i18n="help.slideConfirm">{t("help.slideConfirm")}</span>
                  <span className="menu-phase phase-back" data-i18n="help.twoFingerBack">{t("help.twoFingerBack")}</span>
                </div>
                <button className="guide-replay" type="button" data-i18n="action.replay" onClick={() => playback.play('menu')}>{t("action.replay")}</button>
              </div>
            </article>
            <article className="guide-scene guide-panel focus-demo help-mobile-only" data-guide-panel="focus" data-focus-mode={focusMode}>
              <button className="guide-tab-card" id="guideTabFocus" type="button" aria-controls="guideFocus" data-guide-tab="focus" aria-expanded={playback.active === 'focus'} onClick={() => playback.toggle('focus')}><span><strong data-i18n="help.inGame">{t("help.inGame")}</strong><small id="guideFocusSummary" data-i18n="help.focusSummary">{t(focusMode === 'two-finger' ? 'help.focusTwoFingerSummary' : focusMode === 'toggle-button' ? 'help.focusToggleSummary' : 'help.focusHoldSummary')}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"></path></svg></i></button>
              <div className="guide-demo-body" id="guideFocus" hidden={playback.active !== 'focus'}>
                <div className="focus-stage">
                  <span className="shot-stream" aria-hidden="true"></span>
                  <i className="demo-player"></i><i className="demo-hitbox"></i>
                  <i className="demo-finger finger-move"></i>
                  <div className="focus-mode-control" id="guideFocusControl" aria-hidden="true"><strong data-i18n="touch.focus">{t("touch.focus")}</strong><small id="guideFocusControlHint" data-i18n="help.hold">{focusMode === 'two-finger' ? '' : t(focusMode === 'toggle-button' ? 'help.toggle' : 'help.hold')}</small></div>
                  <i className="demo-finger finger-focus"></i>
                  <span className="move-trace"></span>
                  <b className="focus-label" id="guideFocusLabel">{t(focusMode === 'two-finger' ? 'help.focusTwoFingerLabel' : focusMode === 'toggle-button' ? 'help.focusToggleLabel' : 'help.holdFocus')}</b>
                </div>
                <button className="guide-replay" type="button" data-i18n="action.replay" onClick={() => playback.play('focus')}>{t("action.replay")}</button>
              </div>
            </article>
            <article className="guide-scene guide-panel dialogue-demo help-mobile-only" data-guide-panel="dialogue">
              <button className="guide-tab-card" id="guideTabDialogue" type="button" aria-controls="guideDialogue" data-guide-tab="dialogue" aria-expanded={playback.active === 'dialogue'} onClick={() => playback.toggle('dialogue')}><span><strong data-i18n="help.dialogue">{t("help.dialogue")}</strong><small data-i18n="help.dialogueSummary">{t("help.dialogueSummary")}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"></path></svg></i></button>
              <div className="guide-demo-body" id="guideDialogue" hidden={playback.active !== 'dialogue'}>
                <div className="dialogue-stage">
                  <div className="dialogue-portrait">?</div>
                  <div className="dialogue-box"><div className="dialogue-ticker"><span data-i18n="help.dialogue1">{t("help.dialogue1")}</span><span data-i18n="help.dialogue2">{t("help.dialogue2")}</span><span data-i18n="help.dialogue3">{t("help.dialogue3")}</span><span data-i18n="help.dialogue4">{t("help.dialogue4")}</span><span data-i18n="help.dialogue1">{t("help.dialogue1")}</span></div></div>
                  <i className="demo-finger dialogue-finger"></i><i className="hold-ring"></i>
                </div>
                <button className="guide-replay" type="button" data-i18n="action.replay" onClick={() => playback.play('dialogue')}>{t("action.replay")}</button>
              </div>
            </article>
            <article className="guide-scene guide-panel" data-guide-panel="thprac">
              <button className="guide-tab-card" id="guideTabThprac" type="button" aria-controls="guideThprac" data-guide-tab="thprac" aria-expanded={playback.active === 'thprac'} onClick={() => playback.toggle('thprac')}><span><strong>thprac</strong><small data-i18n="help.thpracSummary">{t("help.thpracSummary")}</small></span><i className="guide-tab-arrow mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"></path></svg></i></button>
              <div className="guide-demo-body" id="guideThprac" hidden={playback.active !== 'thprac'}>
                <div className="guide-info">
                  <p className="guide-info-lead" data-i18n="help.thpracIntro">{t("help.thpracIntro")}</p>
                  <div className="guide-key-grid guide-key-grid-thprac help-desktop-only">
                    <div className="guide-key-row"><kbd>Backspace</kbd><span data-i18n="touch.cheatMenu">{t("touch.cheatMenu")}</span></div>
                    <div className="guide-key-row"><kbd>Tab</kbd><span data-i18n="help.tracker">{t("help.tracker")}</span></div>
                    <div className="guide-key-row"><kbd>F12</kbd><span data-i18n="touch.advancedMenu">{t("touch.advancedMenu")}</span></div>
                    <div className="guide-key-row"><kbd>F1</kbd><span data-i18n="touch.invincible">{t("touch.invincible")}</span></div>
                    <div className="guide-key-row"><kbd>F2</kbd><span data-i18n="touch.infiniteLives">{t("touch.infiniteLives")}</span></div>
                    <div className="guide-key-row"><kbd>F3</kbd><span data-i18n="touch.infiniteBombs">{t("touch.infiniteBombs")}</span></div>
                    <div className="guide-key-row"><kbd>F4</kbd><span data-i18n="touch.infinitePower">{t("touch.infinitePower")}</span></div>
                    <div className="guide-key-row"><kbd>F5</kbd><span data-i18n="touch.timeLock">{t("touch.timeLock")}</span></div>
                    <div className="guide-key-row"><kbd>F6</kbd><span data-i18n="touch.autoBomb">{t("touch.autoBomb")}</span></div>
                    <div className="guide-key-row"><kbd>F7</kbd><span data-i18n="touch.enemyBgm">{t("touch.enemyBgm")}</span></div>
                  </div>
                  <div className="guide-key-grid help-mobile-only">
                    <div className="guide-key-row"><kbd data-i18n="touch.cheatMenu">{t("touch.cheatMenu")}</kbd><span data-i18n="help.cheatMenu">{t("help.cheatMenu")}</span></div>
                    <div className="guide-key-row"><kbd>Tab</kbd><span data-i18n="help.tracker">{t("help.tracker")}</span></div>
                    <div className="guide-key-row"><kbd>F12</kbd><span data-i18n="touch.advancedMenu">{t("touch.advancedMenu")}</span></div>
                    <div className="guide-key-row"><kbd>F1–F7</kbd><span data-i18n="help.thpracFeatures">{t("help.thpracFeatures")}</span></div>
                  </div>
                  <p className="guide-info-note help-desktop-only" data-i18n="help.thpracReplayDesktop">{t("help.thpracReplayDesktop")}</p>
                  <p className="guide-info-note help-mobile-only" data-i18n="help.thpracReplayMobile">{t("help.thpracReplayMobile")}</p>
                </div>
              </div>
            </article>
          </section>
        </main>
      </div>
    </div>;
}
