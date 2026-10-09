import {useProductAvailability} from '../components/ProductAvailability';
import {Link, Outlet, useParams} from 'react-router';
import {useLocale} from '../components/LocaleProvider';
import {isProductId} from '../../src/contracts/product-catalog.mts';

/** The persistent parent owns the cover/sheet. This one nested outlet owns the
 * management view; changing it never creates a second service or Runtime. */
export default function Game() {
  const {productId = ''} = useParams(), {t} = useLocale();
  const available = useProductAvailability(productId);
  if (!isProductId(productId) || !available) return <section><h1>{t('react.routes.gameUnavailable')}</h1><Link to="/">{t('library.back')}</Link></section>;
  return <Outlet/>;
}
