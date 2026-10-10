/** Document addresses are browser URLs; Router destinations exclude basename. */
export function launcherBaseUrl(address: string, routerPathname?: string): string {
  const url = new URL(address);
  if (routerPathname && url.pathname.endsWith(routerPathname)) {
    url.pathname = url.pathname.slice(0, -routerPathname.length).replace(/\/?$/, '/');
    return new URL('./', url).href;
  }
  url.pathname = url.pathname.replace(/\/(?:index\.html|en\.html|lobby(?:\.html)?)\/?$/, '/');
  return new URL('./', url).href;
}

export function routerDestination(address: string, baseUrl: string): string {
  const base = new URL(baseUrl), url = new URL(address, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('Navigation must stay within the Launcher mount');
  return '/' + url.pathname.slice(base.pathname.length) + url.search + url.hash;
}
