import {useRef} from 'react';
import {useLocale} from '../../i18n';
import {useBackdropWheel} from './use-options-interactions';

/** One backdrop owns dismissal and non-passive wheel suppression in either carrier. */
export function OptionsBackdrop({onBack}: {onBack(): void}) {
  const {t} = useLocale();
  const backdrop = useRef<HTMLButtonElement>(null);
  useBackdropWheel(backdrop);
  return <button ref={backdrop} className="library-backdrop" id="libraryBackdrop" type="button" tabIndex={-1} aria-hidden="true" aria-label={t('library.back')} onClick={onBack}/>;
}
