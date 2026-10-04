import {MultiplayerReplayViewer} from '../components/MultiplayerReplayViewer';
import {useParams} from 'react-router';
import {ReplayManager} from '../components/ReplayManager';
import {isProductId, isMultiplayerProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
export default function GameReplaysRoute() {
  const {productId = ''} = useParams();
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return null;
  return <>{isMultiplayerProductId(productId) && <MultiplayerReplayViewer productId={productId}/>}<ReplayManager productId={productId}/></>;
}
