import {useProductAvailability} from '../components/ProductAvailability';
import {useLocation, useParams} from 'react-router';
import {MultiplayerRoom} from '../components/MultiplayerRoom';
import {ProductSettings} from '../components/ProductSettings';
import {isMultiplayerProductId, isProductId} from '../../src/contracts/product-catalog.mts';
export default function GameSettingsRoute() {
  const {productId = ''} = useParams();
  const available = useProductAvailability(productId);
  if (!isProductId(productId) || !available) return null;
  return <ResolvedSettings productId={productId}/>;
}
function ResolvedSettings({productId}: {productId: import('../../src/contracts/product-catalog.mts').ProductId}) {
  const location = useLocation();
  const multiplayer = isMultiplayerProductId(productId);
  const room = multiplayer && new URLSearchParams(location.search).has('mpRoom');
  if (room) return <MultiplayerRoom/>;
  return <ProductSettings productId={productId}/>;
}
