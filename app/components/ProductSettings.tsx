import type {ProductId} from '../../src/contracts/product-catalog.mts';
import {isMultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {GameSettings} from './GameSettings';
import {SettingsFileTools} from './SettingsFileTools';
import {MultiplayerSettingsActions} from './MultiplayerSettingsActions';
import {GameLaunch} from './GameLaunch';
import {useResourceInspection} from './ResourceManagerProvider';

/** One persistent lower settings surface beneath file/resource windows. */
export function ProductSettings({productId}: {productId: ProductId}) {
  useResourceInspection(productId);
  const multiplayer = isMultiplayerProductId(productId);
  return <><GameSettings productId={productId} fileTools={<SettingsFileTools productId={productId}/>}
    multiplayerActions={multiplayer ? <MultiplayerSettingsActions productId={productId}/> : undefined}/>
    {!multiplayer && <GameLaunch productId={productId}/>}</>;
}
