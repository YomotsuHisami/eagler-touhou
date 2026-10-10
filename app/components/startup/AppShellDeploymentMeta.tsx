import {REACT_APP_SHELL_META, type ReactAppShellDeployment} from '../../services/app-shell-deployment';
declare const __REACT_APP_SHELL_DEPLOYMENT__: ReactAppShellDeployment | null;
/** Vite supplies identical immutable configuration to SSR and client builds. */
export function AppShellDeploymentMeta() {
  const deployment = typeof __REACT_APP_SHELL_DEPLOYMENT__ === 'undefined' ? null : __REACT_APP_SHELL_DEPLOYMENT__;
  return deployment ? <meta name={REACT_APP_SHELL_META} content={JSON.stringify(deployment)}/> : null;
}
