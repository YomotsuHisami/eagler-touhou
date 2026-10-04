import {useLocale} from '../components/LocaleProvider';
import {Link, useLocation, useNavigate, useParams} from 'react-router';
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
  const location = useLocation(), navigate = useNavigate();
  const multiplayer = isMultiplayerProductId(productId);
  const room = multiplayer && new URLSearchParams(location.search).has('mpRoom');
  const roomOptions = new URLSearchParams(location.search).get('roomOptions') === '1';
  const closeOptions = () => {
    const query = new URLSearchParams(location.search); query.delete('roomOptions');
    const parent = `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`;
    if (location.state?.roomOptionsParent === parent) void navigate(-1);
    else void navigate(parent,{replace:true});
  };
  if (room && !roomOptions) return <MultiplayerRoom/>;
  return <>{roomOptions && room && <button type="button" className="min-h-11 text-accent" onClick={closeOptions}>{t('react.routes.backRoom')}</button>}<GameSettings productId={productId}/>{multiplayer
    ? !room && <Link to={`/lobby?game=${productId}`} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 py-2">{t('react.routes.openLobby')}</Link>
    : <GameLaunch productId={productId}/>}</>;
}
