import {useLayoutEffect, useRef, type RefObject} from 'react';
import {useLocale} from '../../i18n';
import {directoryCategories, directoryCategoryKey, type DirectoryFilter} from './directory-categories';

/** One selection capsule follows the visual category; filtering stays independent. */
export function DirectoryCategoryOptions({options, filter, highlight = filter, onCategory, interactive, open = true, narrow = false}: {
  options: RefObject<HTMLDivElement | null>; filter: DirectoryFilter; highlight?: DirectoryFilter;
  onCategory(category: DirectoryFilter): void; interactive: boolean; open?: boolean; narrow?: boolean;
}) {
  const {t,locale} = useLocale(), selection = useRef<HTMLSpanElement>(null), alignCurrent = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const choices = options.current, indicator = selection.current;
    const active = choices?.querySelector<HTMLButtonElement>('[data-active="true"]');
    if (!choices || !indicator || !active) return;
    const measure = () => {
      indicator.style.setProperty('--selection-x', `${active.offsetLeft}px`);
      indicator.style.setProperty('--selection-width', `${active.offsetWidth}px`);
      if (indicator.dataset.ready !== 'true') {indicator.getBoundingClientRect(); indicator.dataset.ready = 'true';}
      if (narrow && choices.scrollWidth > choices.clientWidth) {
        const left = active.offsetLeft, right = left + active.offsetWidth;
        if (left < choices.scrollLeft + 8) choices.scrollLeft = Math.max(0,left - 8);
        else if (right > choices.scrollLeft + choices.clientWidth - 8) choices.scrollLeft = right - choices.clientWidth + 8;
      }
    };
    alignCurrent.current = measure;measure(); if (!interactive) return () => {alignCurrent.current = null;};
    const resize = new ResizeObserver(measure); resize.observe(active); resize.observe(choices);
    return () => {resize.disconnect();alignCurrent.current = null;};
  }, [options,highlight,locale,interactive,narrow]);
  return <div className="directory-category-options" ref={options} inert={!open || !interactive} role="group" aria-label={t('directory.categories')}>
    <span className="directory-category-selection" ref={selection} aria-hidden="true"/>
    {(['all',...directoryCategories] as const).map(value => <button type="button" key={value} data-category={value} data-active={highlight === value}
      aria-pressed={filter === value} aria-current={highlight === value ? 'true' : undefined} disabled={!interactive} onClick={() => {if(interactive){onCategory(value);if(value === highlight)alignCurrent.current?.();}}}>
      {t(narrow && value === 'all' ? 'directory.category.allNarrow' : directoryCategoryKey(value))}
    </button>)}
  </div>;
}
