import type {ProbeLane, ProbeMetric, createRoomNetwork} from '../../../src/launcher/room-network.mts';
import type {MultiplayerRoomService} from '../../services/multiplayer-room';
import type {TouchMovementMode} from '../../../src/launcher/game-preferences.mts';
export type RoomPanelKind = 'personal' | 'network' | 'spectators' | 'game';
export interface RoomNetworkPresentation {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
  metric(peer: string, lane: ProbeLane): ProbeMetric;
  capabilities(): ReturnType<ReturnType<typeof createRoomNetwork>['capabilities']>;
  retry(peer?: string): void;
}
export interface RoomViewContext {
  launched: boolean;
  th09NetworkOverlayOpen: boolean;
  launchStage: 'path' | 'preparing' | null;
  touchEnabled: boolean;
  touchMovementMode: TouchMovementMode;
}
export interface RoomViewProps {
  service: MultiplayerRoomService;
  network: RoomNetworkPresentation;
  context: RoomViewContext;
  assetUrl(path: string): string;
  onLeave(): void | Promise<void>;
  onCopyRoomCode(code: string): void | Promise<void>;
  onGuide(): void;
  onOpenSettings(): void;
  settingsOpen: boolean;
  visible?: boolean;
  settingsClosing?: boolean;
  panel: {kind: RoomPanelKind; peerId?: string} | null;
  onOpenPanel(kind: RoomPanelKind, peerId?: string): void;
  onClosePanel(): void;
}
