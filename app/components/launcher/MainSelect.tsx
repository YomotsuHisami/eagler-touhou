import {forwardRef, useLayoutEffect, useRef, type SelectHTMLAttributes} from 'react';
import {useLocale, type Translate} from '../../i18n';
import {createMainSelectController} from './main-select-controller';

type Controller = ReturnType<typeof createMainSelectController>;
let shared: {controller: Controller; owners: number} | null = null;
function acquire(t: Translate) {
  if (!shared) shared = {controller: createMainSelectController({translate: t}), owners: 0};
  const entry = shared; entry.owners++; entry.controller.setTranslate(t);
  return {controller: entry.controller, release() {
    entry.owners--;
    if (!entry.owners) {entry.controller.dispose(); if (shared === entry) shared = null;}
  }};
}
export type MainSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {'data-trigger-i18n'?: string};

/** Native props/options remain React-owned. Original generated trigger inherits
 * main's actual ancestor selectors, never styles attached only to hidden input. */
export const MainSelect = forwardRef<HTMLSelectElement, MainSelectProps>(function MainSelect(props, forwardedRef) {
  const {t} = useLocale(), node = useRef<HTMLSelectElement | null>(null);
  const owner = useRef<ReturnType<typeof acquire> | null>(null);
  useLayoutEffect(() => {
    const select = node.current;
    if (!select) return;
    const current = acquire(t); owner.current = current;
    current.controller.installCustomSelect(select);
    let active = true;
    // React restores a controlled native value after the change event. Re-sync
    // after that restoration even when a warning is cancelled without a render.
    const afterChange = () => queueMicrotask(() => {
      if (active && owner.current === current) current.controller.syncCustomSelect(select);
    });
    select.addEventListener('change', afterChange);
    return () => {
      active = false; select.removeEventListener('change', afterChange);
      current.controller.uninstallCustomSelect(select); current.release();
      if (owner.current === current) owner.current = null;
    };
  }, [props.id]);
  useLayoutEffect(() => {
    if (node.current && owner.current) {
      owner.current.controller.setTranslate(t);
      owner.current.controller.syncCustomSelect(node.current);
    }
  });
  return <select {...props} ref={element => {
    node.current = element;
    if (typeof forwardedRef === 'function') forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }}/>;
});
