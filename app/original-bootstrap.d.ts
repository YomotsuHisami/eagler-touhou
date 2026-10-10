declare module 'virtual:original-bootstrap' {
  interface BootstrapSource {script: string; compatibility: string; css: string; preload: string}
  export const originalBootstrap: {library: BootstrapSource; lobby: BootstrapSource};
}
