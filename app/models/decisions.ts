/** Main app.mts askDecision contract. Decisions own no browser history entry. */
export type DecisionChoice = 'confirm' | 'cancel' | 'secondary';
export interface DecisionOptions {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  secondaryText?: string;
  tone?: 'normal' | 'danger';
  variant?: string;
  hideCancel?: boolean;
  confirmOnEnter?: boolean;
}
export interface DecisionRequest extends Readonly<DecisionOptions> {readonly requestId: number;}
export interface DecisionStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DecisionRequest | null;
  askDecision(options?: DecisionOptions): Promise<DecisionChoice>;
  askConfirmation(options?: DecisionOptions): Promise<boolean>;
  resolve(choice: DecisionChoice): void;
  /** Reserves the one native decision surface for Router's dirty-close prompt. */
  setNavigationDecisionOpen(open: boolean): void;
  dispose(): void;
}
export function createDecisionStore(): DecisionStore {
  let pending: DecisionRequest | null = null;
  let requestSequence = 0;
  let resolver: ((choice: DecisionChoice) => void) | null = null;
  let navigationDecisionOpen = false;
  const listeners = new Set<() => void>();
  const emit = () => {for (const listener of listeners) listener();};
  function askDecision(options: DecisionOptions = {}): Promise<DecisionChoice> {
    // Main does not replace the existing request or queue a second prompt.
    if (resolver || navigationDecisionOpen) return Promise.resolve('cancel');
    return new Promise(resolve => {
      resolver = resolve;
      pending = Object.freeze({...options, requestId: ++requestSequence});
      emit();
    });
  }
  function settle(choice: DecisionChoice) {
    const resolve = resolver;
    if (!resolve) return;
    resolver = null;
    pending = null;
    emit();
    resolve(choice);
  }
  return {
    subscribe(listener) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => pending,
    askDecision,
    askConfirmation: options => askDecision(options).then(choice => choice === 'confirm'),
    resolve: settle,
    setNavigationDecisionOpen(open) {navigationDecisionOpen = open;},
    dispose() {settle('cancel'); navigationDecisionOpen = false; listeners.clear();},
  };
}
