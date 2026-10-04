/** A temporary HTTP failure, not an inspector-level blocked URL. Keep this
 * route installed through Reload so the browser's interception/cache policy
 * does not change between the failing and recovered documents. */
export function createSyntheticBootModuleFailure() {
  let unavailable = true;
  return Object.freeze({
    recover() {unavailable = false;},
    async handle(route: {
      fulfill(options: {status: number; contentType: string; headers: Record<string, string>; body: string}): Promise<void>;
      continue(): Promise<void>;
    }) {
      if (unavailable) await route.fulfill({status:503, contentType:'text/javascript',
        headers:{'cache-control':'no-store'}, body:'/* Synthetic temporary startup-module HTTP failure. */'});
      else await route.continue();
    },
  });
}
