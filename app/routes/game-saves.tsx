import {useParams} from 'react-router';
import {SaveManager} from '../components/SaveManager';
import {isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
export default function GameSavesRoute() {
  const {productId = ''} = useParams();
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return null;
  return <SaveManager productId={productId}/>;
}
