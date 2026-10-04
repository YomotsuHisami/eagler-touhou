import {useParams} from 'react-router';
import {ReplayManager} from '../components/ReplayManager';
import {isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
export default function GameReplaysRoute() {
  const {productId = ''} = useParams();
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return null;
  return <ReplayManager productId={productId}/>;
}
