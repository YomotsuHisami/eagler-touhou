/** Generate preview fallback patterns from the single React Router route owner. */
export function navigationPatterns(entries, prefix = '') {
  return [...new Set(entries.flatMap(entry => {
    const path = [prefix, entry.path].filter(Boolean).join('/').replaceAll(/\/{2,}/g, '/');
    return [...(entry.index || entry.path ? [`/${path}`] : []), ...navigationPatterns(entry.children ?? [], path)];
  }))].sort();
}
