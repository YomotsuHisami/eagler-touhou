import {useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject} from 'react';
import {PRODUCT_GAMES, type GameId} from '../../src/contracts/product-catalog.mts';
import {touchMovementUsesJoystick, type GameOptions} from '../../src/launcher/game-preferences.mts';
import {loadTouchLayoutFromStorage, touchLayoutStorageKey, type TouchLayout, type TouchLayoutControlName} from '../../src/launcher/touch-layout-model.mts';
import {bindDirectTouch, bindInputContact, usesNativeTouch} from './input-dom';
import {layoutPosition} from './input-geometry';
import {practiceKeys, type RuntimeInput} from './input-controller';
import styles from './runtime.module.css';
import {useUiText} from '../services/ui-preferences';

function readLayout() {try {return loadTouchLayoutFromStorage(localStorage);} catch {return null;}}
function useLayoutProfile(enabled: boolean) {
  const [layout, setLayout] = useState<TouchLayout | null>(null);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  useEffect(() => {if (enabled) setLayout(readLayout());}, [enabled]);
  useEffect(() => {
    setLayout(readLayout());
    const changed = (event: StorageEvent) => {if (event.key === touchLayoutStorageKey || event.key === null) setLayout(readLayout());};
    const resized = () => setOrientation((window.visualViewport?.width || innerWidth) >= (window.visualViewport?.height || innerHeight) ? 'landscape' : 'portrait');
    resized(); window.addEventListener('storage', changed); window.addEventListener('resize', resized, {passive: true});
    window.visualViewport?.addEventListener('resize', resized, {passive: true});
    screen.orientation?.addEventListener('change', resized);
    return () => {window.removeEventListener('storage', changed); window.removeEventListener('resize', resized);
      window.visualViewport?.removeEventListener('resize', resized); screen.orientation?.removeEventListener('change', resized);};
  }, []);
  return layout?.profiles[orientation] ?? null;
}

export function TouchControls({input, frame, game, options, enabled, onViewportOffset}: {
  input: RuntimeInput; frame: RefObject<HTMLIFrameElement | null>; game: GameId;
  options: Readonly<GameOptions>; enabled: boolean; onViewportOffset(value: number): void;
}) {
  const t = useUiText();
  const state = useSyncExternalStore(input.subscribe, input.getSnapshot, input.getSnapshot);
  const layer = useRef<HTMLDivElement>(null);
  const direct = useRef<HTMLDivElement>(null);
  const joystick = useRef<HTMLDivElement>(null);
  const controls = useRef<Partial<Record<TouchLayoutControlName, HTMLElement>>>({});
  const profile = useLayoutProfile(enabled);
  const [practiceMenu, setPracticeMenu] = useState(false);
  const [hostDirectTouch, setHostDirectTouch] = useState(false);
  useEffect(() => {setHostDirectTouch(usesNativeTouch(navigator) || /\bAndroid\b/i.test(navigator.userAgent));}, []);
  const joystickMode = touchMovementUsesJoystick(options.touchMovementMode);
  const heldFire = PRODUCT_GAMES[game].touchFire.mode === 'held-key';
  const practice = options.thpracEnabled && options.thpracTouchControlsEnabled;
  useEffect(() => {onViewportOffset(profile?.viewport.x ?? 0);}, [profile, onViewportOffset]);
  useEffect(() => {
    if (!enabled || !frame.current || !direct.current || joystickMode || !hostDirectTouch) return;
    return bindDirectTouch(direct.current, frame.current, input);
  }, [enabled, frame, input, joystickMode, hostDirectTouch]);
  useEffect(() => {
    if (!enabled) return;
    const cleanups: (() => void)[] = [];
    const connect = (name: TouchLayoutControlName, down: (id: number) => boolean | void, up: (id: number) => void = () => {}) => {
      const element = controls.current[name]; if (!element) return;
      cleanups.push(bindInputContact(element, {down: contact => down(contact.id), up: contact => up(contact.id), accessible: true}));
    };
    connect('fire', input.fireDown, input.fireUp);
    connect('focus', input.focusDown, input.focusUp);
    connect('bomb', () => input.action('bomb'));
    connect('escape', () => input.action('escape'));
    connect('restart', () => input.action('restart'));
    connect('thpracTab', () => input.action('Tab'));
    connect('thpracMenu', () => setPracticeMenu(open => !open));
    const stick = joystick.current;
    if (stick && joystickMode) cleanups.push(bindInputContact(stick, {
      down: contact => input.joystickDown(contact.id, contact, stick.getBoundingClientRect()),
      move: contact => {input.joystickMove(contact.id, contact, stick.getBoundingClientRect());},
      up: contact => input.joystickUp(contact.id),
    }));
    return () => {cleanups.forEach(cleanup => cleanup()); input.cancelTransient();};
  }, [enabled, input, joystickMode, options.touchFocusMode, options.restartButtonEnabled, practice]);
  useEffect(() => {
    const safe = layer.current; if (!safe) return;
    const apply = () => {
      for (const [name, element] of Object.entries(controls.current)) {
        if (!element) continue;
        const placement = profile?.controls[name as TouchLayoutControlName];
        if (!placement) {delete element.dataset.custom; element.style.removeProperty('left'); element.style.removeProperty('top'); element.style.removeProperty('transform'); element.style.removeProperty('z-index'); continue;}
        const position = layoutPosition(placement, {width: element.offsetWidth, height: element.offsetHeight}, {width: safe.clientWidth, height: safe.clientHeight});
        element.dataset.custom = 'true'; element.style.left = `${position.x * 100}%`; element.style.top = `${position.y * 100}%`;
        element.style.transform = `translate(-50%, -50%) scale(${placement.scale})`; element.style.zIndex = String(31 + placement.priority);
      }
    };
    apply();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    observer?.observe(safe); window.addEventListener('resize', apply, {passive: true});
    return () => {observer?.disconnect(); window.removeEventListener('resize', apply);};
  }, [profile, enabled, options.touchFocusMode, options.restartButtonEnabled, practice]);
  const refFor = (name: TouchLayoutControlName) => (element: HTMLButtonElement | null) => {if (element) controls.current[name] = element; else delete controls.current[name];};
  return <div ref={layer} className={styles.touchLayer} hidden={!enabled} aria-label={t('ui.runtime.touchControls')}>
    <div ref={direct} className={styles.directTouch} hidden={joystickMode || !hostDirectTouch} aria-hidden="true" data-touch-direct="true" />
    <div ref={element => {joystick.current = element; if (element) controls.current.joystick = element; else delete controls.current.joystick;}}
      className={`${styles.touchControl} ${styles.joystick}`} hidden={!joystickMode} role="group" aria-label={t('touch.movement.joystick')} data-touch-control="joystick">
      <span className={styles.joystickGuides} aria-hidden="true">＋</span><span className={styles.joystickKnob} style={{'--stick-x': `${state.visualX}px`, '--stick-y': `${state.visualY}px`} as CSSProperties}/>
    </div>
    <button ref={refFor('focus')} type="button" className={`${styles.touchControl} ${styles.focus}`} hidden={options.touchFocusMode === 'two-finger'}
      aria-label={t(options.touchFocusMode === 'hold-button' ? 'touch.holdFocus' : 'touch.tapToggle')} aria-pressed={state.focusEnabled} data-touch-control="focus"><strong>{t('touch.focus')}</strong><small>{t(options.touchFocusMode === 'hold-button' ? 'ui.runtime.hold' : 'ui.runtime.toggle')}</small></button>
    <button ref={refFor('fire')} type="button" className={`${styles.touchControl} ${styles.fire}`} aria-label={t(heldFire ? 'touch.holdFireCharge' : 'ui.runtime.autoFire')}
      aria-pressed={heldFire ? state.heldFire : state.fireEnabled} data-touch-control="fire"><strong>{t(heldFire ? 'ui.runtime.charge' : 'touch.fire')}</strong><small>{t(heldFire ? 'ui.runtime.holdZ' : state.fireEnabled ? 'ui.runtime.autoFire' : 'ui.runtime.off')}</small></button>
    <button ref={refFor('bomb')} type="button" className={`${styles.touchControl} ${styles.bomb}`} data-touch-control="bomb"><strong>Bomb</strong><small>X</small></button>
    <button ref={refFor('escape')} type="button" className={`${styles.touchControl} ${styles.escape}`} aria-label={t('ui.runtime.pause')} data-touch-control="escape"><strong>ESC</strong></button>
    <button ref={refFor('restart')} type="button" className={`${styles.touchControl} ${styles.restart}`} hidden={!options.restartButtonEnabled} aria-label={t('ui.runtime.restart')} data-touch-control="restart"><strong>R</strong></button>
    <button ref={refFor('thpracTab')} type="button" className={`${styles.touchControl} ${styles.practiceTab}`} hidden={!practice} aria-label={`${t('touch.thpracButtons')} Tab`} data-touch-control="thpracTab"><strong>Tab</strong></button>
    <button ref={refFor('thpracMenu')} type="button" className={`${styles.touchControl} ${styles.practiceMenu}`} hidden={!practice} aria-expanded={practiceMenu} data-touch-control="thpracMenu"><strong>{t('ui.runtime.practiceKeys')}</strong></button>
    {practice && practiceMenu && <div className={styles.practiceKeys} role="group" aria-label={t('touch.thpracButtons')}>{Object.keys(practiceKeys).filter(key => key !== 'Tab').map(key =>
      <button type="button" key={key} onPointerDown={event => {event.preventDefault(); input.action(key);}} onClick={event => {if (event.detail === 0) input.action(key);}}>{key}</button>)}</div>}
  </div>;
}
