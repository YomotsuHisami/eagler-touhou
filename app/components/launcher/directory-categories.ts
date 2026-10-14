import type {LibraryProduct} from './products';

export const directoryCategories = ['mainline', 'classic', 'decimal', 'fan'] as const;
export type DirectoryCategory = typeof directoryCategories[number];
export type DirectoryFilter = 'all' | DirectoryCategory;
export const directoryCategoryKey = (category: DirectoryFilter) => `directory.category.${category}` as const;

/** Explicit catalog metadata wins; numbered official works need no copied ID list. */
export function directoryCategory(product: Pick<LibraryProduct, 'number' | 'directoryCategory'>): DirectoryCategory {
  if (product.directoryCategory) return product.directoryCategory;
  const number = product.number.trim();
  if (/^\d+$/.test(number) && Number(number) >= 1 && Number(number) <= 5) return 'classic';
  return /^\d+$/.test(number) ? 'mainline' : /^\d+\.\d+$/.test(number) ? 'decimal' : 'fan';
}

export function directoryGroups(products: readonly LibraryProduct[], filter: DirectoryFilter) {
  return directoryCategories.filter(category => filter === 'all' || filter === category)
    .map(category => ({category, products: products.filter(product => directoryCategory(product) === category)}));
}

/** Filtered groups retain their images, but hidden entries cannot be selected. */
export function visibleDirectoryEntries(rail: HTMLElement): HTMLElement[] {
  return [...rail.querySelectorAll<HTMLElement>('.game:not([hidden]),.directory-coming-soon')].filter(entry=>!entry.closest('[hidden]'));
}
