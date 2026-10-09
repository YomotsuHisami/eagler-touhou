import {useProductAvailability} from '../components/ProductAvailability';
import {useParams} from 'react-router';
import {SaveManager} from '../components/SaveManager';
import {isProductId} from '../../src/contracts/product-catalog.mts';
export default function GameSavesRoute() {
  const {productId = ''} = useParams();
  const available = useProductAvailability(productId);
  if (!isProductId(productId) || !available) return null;
  return <SaveManager productId={productId}/>;
}
