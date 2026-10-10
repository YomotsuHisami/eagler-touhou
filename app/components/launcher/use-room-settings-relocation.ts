import {useLayoutEffect, type RefObject} from 'react';
/** Main app2184–2210: one header and one settings fold, moved not cloned.
 * Restore React's expected parent before dependency change/unmount deletion. */
export function useRoomSettingsRelocation(panel: RefObject<HTMLElement | null>, active: boolean, productId: string) {
  useLayoutEffect(() => {
    if (!active) return;
    const source = panel.current, header = source?.querySelector<HTMLElement>(':scope > .tools-head'), fold = source?.querySelector<HTMLElement>('#mpSettingsFold');
    const drawer = document.getElementById('mpSettingsRoomDrawer'), content = document.getElementById('mpSettingsRoomDrawerContent');
    if (!header || !fold || !drawer || !content) throw new Error('Room settings require the original shared header/fold and mounted drawer carrier');
    const headerParent = header.parentElement!, headerNext = header.nextSibling, foldParent = fold.parentElement!, foldNext = fold.nextSibling;
    drawer.prepend(header); content.append(fold); fold.classList.add('mp-room-drawer-mounted');
    return () => {
      headerParent.insertBefore(header, headerNext?.parentNode === headerParent ? headerNext : null);
      foldParent.insertBefore(fold, foldNext?.parentNode === foldParent ? foldNext : null);
      fold.classList.remove('mp-room-drawer-mounted');
    };
  }, [panel, active, productId]);
}
