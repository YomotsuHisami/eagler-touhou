export function uiBuildConfig(environment?: Record<string,string|undefined>): {mountPath:string;buildDirectory:string;clientDirectory:string};
export function normalizeUiBuildMountPath(value?: string): string;
