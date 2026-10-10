import {useLayoutEffect, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
/** Main's transient-overlay host rule, with a stable React portal target so
 * native dialog state/focus survives fullscreen changes without remounting. */
export function FullscreenTransient({children}: {children: ReactNode}) {
  const [host] = useState(() => {const element = document.createElement('div'); element.style.display = 'contents'; element.dataset.launcherTransientHost = ''; element.dataset.launcherDocument = ''; return element;});
  useLayoutEffect(() => {
    const sync = () => {
      const fullscreen = document.fullscreenElement || (document as Document & {webkitFullscreenElement?: Element}).webkitFullscreenElement;
      const player = document.getElementById('player');
      const parent = player && fullscreen === player ? player : document.body;
      if (host.parentNode !== parent) parent.append(host);
    };
    sync(); document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync);
    return () => {document.removeEventListener('fullscreenchange', sync); document.removeEventListener('webkitfullscreenchange', sync); host.remove();};
  }, [host]);
  return createPortal(children, host);
}
