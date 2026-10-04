import {test as base, expect} from '@playwright/test';
import {installSyntheticBrowserCompatibilityProbe} from './synthetic-browser-compatibility-probe';

/** Only full-Framework UI/publication lanes opt into the synthetic early GPU
 * probe. Compatibility acceptance must use the unmodified browser environment. */
export const test = base.extend<{syntheticBrowserCompatibilityProbe: void}>({
  syntheticBrowserCompatibilityProbe: [async ({page}, use, info) => {
    info.annotations.push({type: 'synthetic-capability', description: 'Only the early compatibility probe uses a synthetic WebGL2 context; this UI lane does not establish GPU or game support.'});
    await page.addInitScript(installSyntheticBrowserCompatibilityProbe);
    await use();
  }, {auto: true}],
});
export {expect};
