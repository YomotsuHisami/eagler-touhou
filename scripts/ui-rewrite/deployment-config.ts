import {normalizeReactMountPath, validateReactAppShellDeployment, type ReactAppShellDeployment} from '../../app/services/app-shell-deployment.ts';

/** Build configuration only. Setting a mount alone never enables offline mode. */
export function reactDeploymentConfig(environment: NodeJS.ProcessEnv = process.env) {
  const mountPath = normalizeReactMountPath(environment.EAGLER_REACT_MOUNT_PATH || '/');
  const outputDirectory = environment.EAGLER_REACT_BUILD_DIRECTORY || '.cache/build/ui-rewrite';
  let appShell: ReactAppShellDeployment | null = null;
  if (environment.EAGLER_REACT_APP_SHELL_ORIGIN || environment.EAGLER_REACT_APP_SHELL) {
    if (environment.EAGLER_REACT_APP_SHELL !== 'isolated' || !environment.EAGLER_REACT_APP_SHELL_ORIGIN) throw new Error('React App Shell requires EAGLER_REACT_APP_SHELL=isolated and EAGLER_REACT_APP_SHELL_ORIGIN');
    appShell = validateReactAppShellDeployment({schema: 'eagler-touhou/react-app-shell/1', origin: environment.EAGLER_REACT_APP_SHELL_ORIGIN, mountPath});
  }
  return Object.freeze({mountPath, outputDirectory, appShell});
}
