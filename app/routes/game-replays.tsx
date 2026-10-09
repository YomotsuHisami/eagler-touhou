import {useProductAvailability} from '../components/ProductAvailability';
import {useParams} from 'react-router';
import {ReplayManager} from '../components/ReplayManager';
import {isProductId} from '../../src/contracts/product-catalog.mts';
export default function GameReplaysRoute() {
  const {productId = ''} = useParams();
  const available = useProductAvailability(productId);
  if (!isProductId(productId) || !available) return null;
  return <ReplayManager productId={productId}/>;
}
