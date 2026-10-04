import {useLocale} from '../components/LocaleProvider';
import {Link, useLocation, useParams} from 'react-router';
import {MultiplayerRoom} from '../components/MultiplayerRoom';
import {useResourceInspection} from '../components/ResourceManagerProvider';
import {GameSettings} from '../components/GameSettings';
import {GameLaunch} from '../components/GameLaunch';
import {isMultiplayerProductId, isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
export default function GameSettingsRoute() {
  const {productId = ''} = useParams();
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return null;
  return <ResolvedSettings productId={productId}/>;
}
function ResolvedSettings({productId}: {productId: import('../../src/contracts/product-catalog.mts').ProductId}) {
  const {t} = useLocale();
  useResourceInspection(productId);
  const location = useLocation();
  const multiplayer = isMultiplayerProductId(productId);
  const room = multiplayer && new URLSearchParams(location.search).has('mpRoom');
  if (room) return <MultiplayerRoom/>;
  return <><GameSettings productId={productId}/>{multiplayer
    ? !room && <Link to={`/lobby?game=${productId}`} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 py-2">{t('react.routes.openLobby')}</Link>
    : <GameLaunch productId={productId}/>}</>;
}
