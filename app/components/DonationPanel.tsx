import {createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode} from 'react';
import {AnimatedDialog, AnimatedDialogClose} from './AnimatedDialog';
import {useManagementModalParent} from './ManagementSurface';
import {useLocale} from './LocaleProvider';
import {useQueryPanelNavigation} from './QueryPanelNavigation';
import donationImage from '../../public/assets/donation.webp';

/** One image/window shared by the header and footer, including failure state. */
export function useDonationPanel() {
  const navigation = useQueryPanelNavigation('donation');
  const [present, setPresent] = useState(false);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    // The legacy closed dialog eagerly loaded this asset. Preload once so a
    // missing image hides both triggers even before the window is first opened.
    const image = new Image();
    image.onerror = () => setAvailable(false);
    image.src = donationImage;
    return () => {image.onerror = null;};
  }, []);
  useLayoutEffect(() => {if (!available) navigation.closePanel();}, [available, navigation.locationKey, navigation.closePanel]);
  return {...navigation, present, setPresent, available, imageFailed: () => setAvailable(false)};
}

export function DonationPanel({panel}: {panel: ReturnType<typeof useDonationPanel>}) {
  const {t} = useLocale(), parent = useManagementModalParent();
  if (!parent.ready) return null;
  return <AnimatedDialog onPresenceChange={panel.setPresent} returnFocus={parent.returnFocus} open={panel.open && panel.available} onOpenChange={open => {if (!open) panel.closePanel();}}
    title={t('react.shell.donateHosting')} description={t('react.donation.scan')}>
    <img src={donationImage} alt={t('react.donation.imageAlt')} decoding="async" onError={panel.imageFailed}
      className="mx-auto block h-auto w-full max-w-[440px] rounded-[10px]"/>
    <AnimatedDialogClose aria-label={t('react.donation.close')} className="mt-5 rounded-xl border border-white/20 px-4 py-2">{t('action.close')}</AnimatedDialogClose>
  </AnimatedDialog>;
}

const DonationNavigation = createContext<ReturnType<typeof useDonationPanel> | null>(null);
/** Share the existing shell owner with its lower surface; never make another
 * query/history receipt just to intercept a nested Escape. */
export function DonationPanelNavigationProvider({panel, children}: {panel: ReturnType<typeof useDonationPanel>; children: ReactNode}) {
  return <DonationNavigation.Provider value={panel}>{children}</DonationNavigation.Provider>;
}
export function useDonationPanelNavigation() {return useContext(DonationNavigation);}
