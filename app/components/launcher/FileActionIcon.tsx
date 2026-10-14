import type {CSSProperties} from 'react';

/** The same licensed Heroicons outline assets serve every file row. */
export function FileActionIcon({kind, assetUrl = path => path}: {kind:'export'|'delete';assetUrl?:(path:string)=>string}) {
  const source=assetUrl(`assets/heroicons/${kind === 'export' ? 'arrow-down-tray' : 'trash'}.svg`);
  return <span className="file-action-icon" aria-hidden="true" style={{maskImage:`url(${JSON.stringify(source)})`,WebkitMaskImage:`url(${JSON.stringify(source)})`} as CSSProperties}/>;
}
