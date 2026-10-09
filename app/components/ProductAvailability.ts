import {isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
import {useAppShell} from './AppShellProvider';
import {useEffect} from 'react';
import {useHostPublication, useResourceManager} from './ResourceManagerProvider';

/** main uses the current Host's testBuild flag, not a module-load constant. */
export function useProductAvailability(product: string | null) {
  const publication = useAppShell().snapshot?.gate, host = useHostPublication();
  const {controller, snapshot} = useResourceManager();
  useEffect(() => {
    if (product && isProductId(product) && !publication && !host && controller && !snapshot?.operation) void controller.inspect(product).catch(() => {});
  }, [product, publication, host, controller]);
  return !!product && isProductId(product) && productEnabledForBuild(product, publication?.testBuild ?? host?.testBuild ?? false) &&
    (!publication || publication.products.includes(product));
}
