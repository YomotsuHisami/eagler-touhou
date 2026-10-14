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


/** The redesigned directory is a workspace mode; standalone lobby URLs remain aliases. */
export function isDirectoryAddress(location: {pathname: string; search: string}) {
  return /\/(?:lobby|lobby\.html)\/?$/.test(location.pathname) || new URLSearchParams(location.search).get('view') === 'lobby';
}
export function directoryGameHref(address: string, product: string) {
  const [head, hash] = address.split('#'), [path, query] = head.split('?');
  const params = new URLSearchParams(query); params.set('game', product);
  return `${path}?${params}${hash ? `#${hash}` : ''}`;
}
