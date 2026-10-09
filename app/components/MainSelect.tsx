import {useLayoutEffect, useRef, type ReactNode, type SelectHTMLAttributes} from 'react';
import {createCustomSelectController} from '../../src/launcher/custom-select.mts';
import {useLocale} from './LocaleProvider';

type Owner = {controller: ReturnType<typeof createCustomSelectController>; count: number; t: ReturnType<typeof useLocale>['t']};
const documents = new WeakMap<Document, Owner>();

/** React owns options and preference writes; main owns its unchanged menu,
 * keyboard navigation, placement, selection marks and focus restoration. */
export function MainSelect({triggerPrefix, ...props}: SelectHTMLAttributes<HTMLSelectElement> & {triggerPrefix?: ReactNode}) {
  const select = useRef<HTMLSelectElement>(null), owner = useRef<ReturnType<typeof createCustomSelectController> | null>(null);
  const {locale, t} = useLocale();
  useLayoutEffect(() => {
    const element = select.current;if (!element) return;
    let shared = documents.get(element.ownerDocument);
    if (!shared) {
      const record = {count: 0, t} as Owner;
      record.controller = createCustomSelectController({t: key => record.t(key), getHost: node =>
        node?.closest<HTMLElement>('[role="dialog"]') ?? node?.closest<HTMLElement>('[data-player-surface]') ?? document.body});
      shared = record;documents.set(element.ownerDocument, shared);
    }
    shared.count++;
    const {controller} = shared;
    owner.current = controller;controller.installCustomSelect(element);
    const changed = () => queueMicrotask(() => {if (owner.current === controller) controller.syncCustomSelect(element);});
    element.addEventListener('change', changed);
    return () => {
      element.removeEventListener('change', changed);controller.removeCustomSelect(element);
      if (--shared.count === 0) {controller.dispose();documents.delete(element.ownerDocument);}
      if (owner.current === controller) owner.current = null;
    };
  }, []);
  useLayoutEffect(() => {if (select.current) {
    const shared = documents.get(select.current.ownerDocument);if (shared) shared.t = t;
    owner.current?.syncCustomSelect(select.current);
  }}, [props, locale, t]);
  return <span style={{display: 'contents'}} data-main-select>{triggerPrefix && <span hidden data-select-prefix>{triggerPrefix}</span>}<select {...props} ref={select} className={`option-select ${props.className ?? ''}`}/></span>;
}
