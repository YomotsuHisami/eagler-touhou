export interface LauncherActivitySnapshot {
  launched: boolean;
  runtimeReady: boolean;
  runtimeSessionActive: boolean;
  touchLayoutEditing: boolean;
  blockingOperation: boolean;
  gameDataAttempt: boolean;
  launchInFlight: boolean;
  decisionOpen: boolean;
  replayOpen: boolean;
}

export function shouldDeferAppShellReload(activity: LauncherActivitySnapshot): boolean {
  return activity.launched || activity.runtimeReady || activity.runtimeSessionActive || activity.touchLayoutEditing ||
    activity.blockingOperation || activity.gameDataAttempt || activity.launchInFlight ||
    activity.decisionOpen || activity.replayOpen;
}

export type RuntimeCloseDecision = "retry" | "leave" | "stay";

export async function confirmRuntimeClose({
  runtimeReady,
  sync,
  decide,
}: {
  runtimeReady: () => boolean;
  sync: () => Promise<unknown>;
  decide: (error: unknown) => Promise<RuntimeCloseDecision>;
}): Promise<boolean> {
  if (!runtimeReady()) return true;
  while (runtimeReady()) {
    try {
      await sync();
      return true;
    } catch (error) {
      if (!runtimeReady()) return true;
      const decision = await decide(error);
      if (decision === "retry") continue;
      return decision === "leave";
    }
  }
  return true;
}

export type GameDataContinuation =
  | { kind: "install-only" }
  | { kind: "launch"; product: string; roomCode: string | null; replayViewer: boolean };

export function createGameDataContinuation({
  kind,
  product,
  roomCode = null,
  replayViewer = false,
}: {
  kind: "install-only" | "launch";
  product: string;
  roomCode?: string | null;
  replayViewer?: boolean;
}): GameDataContinuation {
  return kind === "install-only"
    ? Object.freeze({ kind: "install-only" })
    : Object.freeze({ kind: "launch", product, roomCode, replayViewer: !!replayViewer });
}

export function gameDataContinuationMatches(
  continuation: GameDataContinuation | null | undefined,
  current: { product: string; roomCode?: string | null; replayViewer?: boolean },
): continuation is Extract<GameDataContinuation, { kind: "launch" }> {
  return !!continuation && continuation.kind === "launch" && continuation.product === current.product &&
    continuation.roomCode === (current.roomCode || null) && continuation.replayViewer === !!current.replayViewer;
}
