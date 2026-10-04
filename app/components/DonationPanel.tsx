import {useEffect, useLayoutEffect, useState} from 'react';
import {AnimatedDialog, AnimatedDialogClose} from './AnimatedDialog';
import {useLocale} from './LocaleProvider';
import {useQueryPanelNavigation} from './QueryPanelNavigation';
import donationImage from '../../public/assets/donation.webp';

/** One image/window shared by the header and footer, including failure state. */
export function useDonationPanel() {
  const navigation = useQueryPanelNavigation('donation');
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
  return {...navigation, available, imageFailed: () => setAvailable(false)};
}

export function DonationPanel({panel}: {panel: ReturnType<typeof useDonationPanel>}) {
  const {t} = useLocale();
  return <AnimatedDialog open={panel.open && panel.available} onOpenChange={open => {if (!open) panel.closePanel();}}
    title={t('react.shell.donateHosting')} description={t('react.donation.scan')}>
    <img src={donationImage} alt={t('react.donation.imageAlt')} decoding="async" onError={panel.imageFailed}
      className="mx-auto block h-auto w-full max-w-[440px] rounded-[10px]"/>
    <AnimatedDialogClose aria-label={t('react.donation.close')} className="mt-5 rounded-xl border border-white/20 px-4 py-2">{t('action.close')}</AnimatedDialogClose>
  </AnimatedDialog>;
}
