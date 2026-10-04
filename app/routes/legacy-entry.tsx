import {useLocale} from '../components/LocaleProvider';
import {Link} from 'react-router';

/** Display-only alias route. The single root LegacyEntryAdapter owns replacement. */
export default function LegacyEntryRoute() {
  const {t} = useLocale();
  return <section className="mx-auto max-w-3xl rounded-3xl border border-line bg-panel p-6" aria-labelledby="legacy-entry-title">
    <h1 id="legacy-entry-title" className="text-2xl font-bold">{t('react.legacy.opening')}</h1>
    <p role="status" className="mt-3 text-sm text-muted">{t('react.legacy.restoring')}</p>
    <Link to="/" replace className="mt-5 inline-block min-h-11 rounded-xl border border-line px-4 py-2">{t('library.back')}</Link>
  </section>;
}
