import {useLocation, useParams} from 'react-router';
import {MultiplayerRoom} from '../components/MultiplayerRoom';
import {useResourceInspection} from '../components/ResourceManagerProvider';
import {GameSettings} from '../components/GameSettings';
import {MultiplayerSettingsActions} from '../components/MultiplayerSettingsActions';
import {SettingsFileTools} from '../components/SettingsFileTools';
import {GameLaunch} from '../components/GameLaunch';
import {isMultiplayerProductId, isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
export default function GameSettingsRoute() {
  const {productId = ''} = useParams();
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return null;
  return <ResolvedSettings productId={productId}/>;
}
function ResolvedSettings({productId}: {productId: import('../../src/contracts/product-catalog.mts').ProductId}) {
  useResourceInspection(productId);
  const location = useLocation();
  const multiplayer = isMultiplayerProductId(productId);
  const room = multiplayer && new URLSearchParams(location.search).has('mpRoom');
  if (room) return <MultiplayerRoom/>;
  return <><GameSettings productId={productId} fileTools={<SettingsFileTools productId={productId}/>} multiplayerActions={isMultiplayerProductId(productId) ? <MultiplayerSettingsActions productId={productId}/> : undefined}/>
    {!multiplayer && <GameLaunch productId={productId}/>}</>;
}
