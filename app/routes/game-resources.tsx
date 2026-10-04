import {useParams} from 'react-router';
import {ResourceManager} from '../components/ResourceManager';
import {isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
export default function GameResourcesRoute() {
  const {productId = ''} = useParams();
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return null;
  return <ResourceManager productId={productId}/>;
}
