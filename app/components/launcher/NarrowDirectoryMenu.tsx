import {useRef} from 'react';
import {useLocale} from '../../i18n';
import type {DirectoryFilter} from './directory-categories';
import {DirectoryCategoryOptions} from './DirectoryCategoryOptions';

export function NarrowDirectoryMenu({filter, highlight, onCategory, interactive}: {
  filter: DirectoryFilter; highlight: DirectoryFilter; onCategory(category: DirectoryFilter): void; interactive: boolean;
}) {
  const {t} = useLocale(), options = useRef<HTMLDivElement>(null);
  return <div className="narrow-directory-menu" aria-label={t('directory.categories')} data-filter={filter} data-highlight={highlight}>
    <DirectoryCategoryOptions options={options} filter={filter} highlight={highlight} onCategory={onCategory} interactive={interactive} narrow/>
    <span className="directory-category-frame" aria-hidden="true"/>
  </div>;
}
