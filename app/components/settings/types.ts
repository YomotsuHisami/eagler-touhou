import type {ProductId} from '../../../src/contracts/product-catalog.mts';
import type {TouchLayoutOrientation, TouchLayoutProfile} from '../../models/touch-layout';
export type SettingsFileAction = 'export-save' | 'import-save' | 'export-replay' | 'manage-replay' | 'import-hint' | 'delete-hint';
export interface SettingsDecision {message: string; confirmText: string; tone?: 'danger'}
export interface ExternalMidiSnapshot {
  enabled: boolean;
  granted: boolean;
  busy: boolean;
  supported: boolean;
  outputs: readonly {id: string; name: string}[];
  selectedId: string;
  hint: string;
}
export interface ExternalMidiPort {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ExternalMidiSnapshot;
  setEnabled(enabled: boolean): Promise<void>;
  /** Select and persist the opaque output ID through the shared model. */
  selectOutput(id: string): Promise<void>;
}
/** Real host capabilities, supplied once by the document root. There are no
 * success/no-op defaults: missing integration must be explicit at the host. */
export interface SettingsActions {
  confirm(decision: SettingsDecision): Promise<boolean>;
  file(action: SettingsFileAction, productId: ProductId): Promise<void>;
  showAppleNotice(): void;
  feedback(message: string, status?: string): void;
  reportError(error: unknown): void;
  externalMidi: ExternalMidiPort;
}
export interface TouchEditorNativePorts {
  enterFullscreen(element: HTMLElement): Promise<boolean>;
  /** Release only fullscreen acquired for this editor, never a foreign owner. */
  exitFullscreen(): Promise<void>;
  canSwitchOrientation(): boolean;
  switchOrientation(orientation: TouchLayoutOrientation): Promise<void>;
  /** Optional native layout host measurement (e.g. embedded viewport). The
   * ordinary browser path measures the actual original control elements. */
  measureDefaults?(surface: HTMLElement): TouchLayoutProfile;
}
