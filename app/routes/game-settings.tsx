import {useParams} from 'react-router';
import {useResourceInspection} from '../components/ResourceManagerProvider';
import {GameSettings} from '../components/GameSettings';
import {GameLaunch} from '../components/GameLaunch';
import {isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
export default function GameSettingsRoute() {
  const {productId = ''} = useParams();
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return null;
  return <ResolvedSettings productId={productId}/>;
}
function ResolvedSettings({productId}: {productId: import('../../src/contracts/product-catalog.mts').ProductId}) {
  useResourceInspection(productId);
  return <><GameSettings productId={productId}/><GameLaunch productId={productId}/></>;
}
