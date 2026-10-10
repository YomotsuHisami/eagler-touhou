/** Explicit artifact configuration, never inferred from a query or a parent SW. */
import {REACT_APP_SHELL_META, normalizeReactMountPath, validateReactAppShellDeployment as validateDeployment} from '../../lib/react-app-shell-deployment.mjs';
export {REACT_APP_SHELL_META, normalizeReactMountPath};
export interface ReactAppShellDeployment {schema: 'eagler-touhou/react-app-shell/1'; origin: string; mountPath: string}

export function validateReactAppShellDeployment(value: unknown): ReactAppShellDeployment {
  return validateDeployment(value);
}

export function readReactAppShellDeployment(document: Pick<Document, 'querySelectorAll'>, location: Pick<Location, 'href'>) {
  try {
    const metadata = document.querySelectorAll(`meta[name="${REACT_APP_SHELL_META}"]`);
    if (metadata.length !== 1) return undefined;
    const configuration = validateReactAppShellDeployment(JSON.parse(metadata[0].getAttribute('content') ?? 'null'));
    const page = new URL(location.href), scope = new URL(configuration.mountPath, configuration.origin);
    if (page.origin !== scope.origin || new URL('./', page).href !== scope.href) return undefined;
    return Object.freeze({workerUrl: new URL('app-shell-sw.js', scope).href, scope: scope.href});
  } catch { return undefined; }
}
