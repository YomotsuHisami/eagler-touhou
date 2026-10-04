export interface DraftLocation {pathname: string; search: string; hash: string}
export interface NavigationDraft {
  id: string;
  label: string;
  shouldBlock(current: DraftLocation, next: DraftLocation): boolean;
  save(): void | Promise<void>;
  discard(): void;
}
/** Draft participants never navigate: the root Router blocker owns every intent. */
export function createNavigationDraftRegistry() {
  const entries = new Map<string, NavigationDraft>();
  return {
    register(draft: NavigationDraft) {
      if (entries.has(draft.id)) throw new Error(`Duplicate navigation draft: ${draft.id}`);
      entries.set(draft.id, draft);
      return () => {if (entries.get(draft.id) === draft) entries.delete(draft.id);};
    },
    blocking(current: DraftLocation, next: DraftLocation) {
      return [...entries.values()].filter(draft => draft.shouldBlock(current, next));
    },
    owns(draft: NavigationDraft) {return entries.get(draft.id) === draft;},
  };
}
export type NavigationDraftRegistry = ReturnType<typeof createNavigationDraftRegistry>;
/** Both native Runtime saves and UI drafts share one document-leave warning. */
export function requiresUnloadConfirmation(runtime: {ready: boolean; saveError: string | null} | null | undefined, dirtyDrafts: number): boolean {
  return dirtyDrafts > 0 || !!runtime?.ready || !!runtime?.saveError;
}
