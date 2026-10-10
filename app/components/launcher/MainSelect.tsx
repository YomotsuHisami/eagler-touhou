import {createContext, forwardRef, Fragment, useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type SelectHTMLAttributes} from 'react';
import {createPortal, flushSync} from 'react-dom';
import {createCustomSelectState, type CustomSelectState} from '../../../src/launcher/custom-select-state.mts';
import {useLocale, type Translate} from '../../i18n';
import {createMainSelectController} from './main-select-controller';

type Controller = ReturnType<typeof createMainSelectController>;
let shared: {controller: Controller; owners: number} | null = null;
function acquire(t: Translate) {
  if (!shared) shared = {controller: createMainSelectController({translate: t, getHost(select) {
    const dialog = select?.closest<HTMLDialogElement>('dialog[open]');
    if (dialog) return dialog;
    const fullscreen = document.fullscreenElement || (document as Document & {webkitFullscreenElement?: Element | null}).webkitFullscreenElement;
    const player = document.getElementById('player');
    return player && fullscreen === player ? player : document.body;
  }}), owners: 0};
  const entry = shared; entry.owners++; entry.controller.setTranslate(t);
  return {controller: entry.controller, release() {
    entry.owners--;
    if (!entry.owners) {entry.controller.dispose(); if (shared === entry) shared = null;}
  }};
}
export type MainSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {'data-trigger-i18n'?: string};
const TriggerPrefix = createContext<ReactNode>(null);
/** No layout wrapper: the original language SVG stays a direct trigger child. */
export function MainSelectPrefix({children, prefix}: {children: ReactNode; prefix: ReactNode}) {
  return <TriggerPrefix value={prefix}>{children}</TriggerPrefix>;
}
export function closeMainSelectMenus() {shared?.controller.closeOtherCustomSelects();}

/** The native select is still the public value/change/ref owner. It is passed
 * as a stable child to the subscribed presentation, so committing a closed menu
 * cannot restore a controlled value before the original change event fires. */
export const MainSelect = forwardRef<HTMLSelectElement, MainSelectProps>(function MainSelect(props, forwardedRef) {
  const {t} = useLocale(), prefix = useContext(TriggerPrefix);
  const node = useRef<HTMLSelectElement | null>(null), root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null), value = useRef<HTMLSpanElement>(null), menu = useRef<HTMLDivElement | null>(null);
  const [state] = useState(createCustomSelectState), [carrier] = useState(() => document.createDocumentFragment());
  const owner = useRef<ReturnType<typeof acquire> | null>(null);
  const nativeRef = useCallback((element: HTMLSelectElement | null) => {
    node.current = element;
    if (typeof forwardedRef === 'function') forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }, [forwardedRef]);
  const menuRef = useCallback((element: HTMLDivElement | null) => {
    menu.current = element;
    if (!element) return;
    // React's portal parent is stable while the same menu moves among native
    // top-layer hosts. Return it before React reconciles/removes the portal.
    return () => {if (element.parentNode !== carrier) carrier.append(element); menu.current = null;};
  }, [carrier]);
  useLayoutEffect(() => {
    const select = node.current;
    if (!select || !root.current || !trigger.current || !value.current || !menu.current) return;
    const current = acquire(t); owner.current = current;
    current.controller.installCustomSelect(select, {root: root.current, trigger: trigger.current, value: value.current, menu: menu.current, state, commit: flushSync});
    let active = true;
    const afterChange = () => queueMicrotask(() => {
      if (active && owner.current === current) current.controller.syncCustomSelect(select);
    });
    select.addEventListener('change', afterChange);
    return () => {
      active = false; select.removeEventListener('change', afterChange);
      current.controller.uninstallCustomSelect(select); current.release();
      if (owner.current === current) owner.current = null;
    };
  }, [props.id, state]);
  useLayoutEffect(() => {
    if (node.current && owner.current) {
      owner.current.controller.setTranslate(t);
      owner.current.controller.syncCustomSelect(node.current);
    }
  });
  const position = useCallback(() => {
    if (node.current && owner.current) owner.current.controller.positionCustomSelectMenu(node.current);
  }, []);
  const native = <select {...props} className={[props.className, 'custom-select-native'].filter(Boolean).join(' ')} tabIndex={-1} aria-hidden="true" ref={nativeRef}/>;
  return <SelectPresentation state={state} native={native} prefix={prefix} carrier={carrier} root={root} trigger={trigger} value={value} menuRef={menuRef} position={position}/>;
});

function SelectPresentation({state, native, prefix, carrier, root, trigger, value, menuRef, position}: {
  state: CustomSelectState; native: ReactNode; prefix: ReactNode; carrier: DocumentFragment;
  root: React.RefObject<HTMLDivElement | null>; trigger: React.RefObject<HTMLButtonElement | null>; value: React.RefObject<HTMLSpanElement | null>;
  menuRef: React.RefCallback<HTMLDivElement>; position(): void;
}) {
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot), description = snapshot.description;
  // Native dimensions are read after React commits updated option content.
  useLayoutEffect(position, [snapshot, position]);
  return <div ref={root} className={`mizuki-select${snapshot.open ? ' open' : ''}`}>
    <button ref={trigger} type="button" className="mizuki-select-trigger" aria-haspopup="listbox" aria-expanded={snapshot.open} aria-label={description?.ariaLabel} disabled={description?.disabled} aria-disabled={description?.disabled ?? false}>
      {prefix}<span ref={value} className="mizuki-select-value">{description?.label ?? ''}</span><i className="mizuki-select-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5"/></svg></i>
    </button>
    {native}
    {createPortal(<div ref={menuRef} className="mizuki-select-menu" role="listbox" aria-label={description?.ariaLabel} hidden={!snapshot.open}>
      <Fragment key={description?.signature ?? ''}>{description?.options.map(option => <button key={option.index} type="button" className={`mizuki-select-item${option.value === description.value ? ' selected' : ''}`} data-value={option.value} data-index={option.index} role="option" disabled={option.disabled} aria-selected={option.value === description.value}>
        <span>{option.text}</span><i aria-hidden="true">✓</i>
      </button>)}</Fragment>
    </div>, carrier)}
  </div>;
}
