/** Same structured-error handling as original main app.mts385. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && !Array.isArray(error) && 'message' in error && typeof error.message === 'string') return error.message;
  return error == null ? '' : String(error);
}
