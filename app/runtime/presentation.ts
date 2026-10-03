import type {RuntimeSnapshot} from '../services/runtime.client';
/** Preflight keeps its viewport but never takes the player's UI/focus. */
export function runtimePresentationActive(snapshot:Pick<RuntimeSnapshot,'launched'|'phase'>|null):boolean {
 return !!snapshot&&(snapshot.launched||snapshot.phase==='launching'||snapshot.phase==='saving');
}
