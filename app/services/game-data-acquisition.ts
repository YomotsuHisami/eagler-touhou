/** DATA/Package recovery is distinct from executable, engine and relay failure. */
export class GameDataAcquisitionError extends Error {
  readonly gameDataAcquisition = true;
  constructor(message: string, options?: ErrorOptions, readonly code = 'game-data-acquisition') {super(message, options);}
}
export function isGameDataAcquisitionFailure(error: unknown): boolean {
  if (error instanceof GameDataAcquisitionError) return true;
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  if ('gameDataAcquisition' in error && error.gameDataAcquisition === true) return true;
  if (error.code === 'game-data-acquisition') return true;
  return 'fileId' in error && error.fileId === 'game-data' && ['missing-object', 'integrity-failed', 'storage-unavailable'].includes(String(error.code));
}
