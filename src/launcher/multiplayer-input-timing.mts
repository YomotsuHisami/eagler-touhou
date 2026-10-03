export interface MultiplayerTimingRecommendation {
  inputDelay: number;
  targetRollbackFrames: number;
  networkFrames: number;
  mobileSeats: number;
}

// RTT is deliberately used as a conservative whole-frame arrival budget:
// browser scheduling and peer pacing can consume more than RTT / 2. The
// rollback limit is an existing title policy; this helper only recommends how
// much input delay to add in front of it and never changes that limit.
export function recommendMultiplayerInputTiming(
  mobileSeats: number,
  rttMs: number | null,
  jitterMs: number | null,
  rollbackLimit: number,
  sustainableMobileRollback = 2,
): MultiplayerTimingRecommendation {
  const phones = Math.max(0, Math.trunc(mobileSeats));
  const limit = Math.max(1, Math.min(12, Math.trunc(rollbackLimit)));
  if (!phones) return { inputDelay: 0, targetRollbackFrames: limit, networkFrames: 0, mobileSeats: 0 };
  const robust = Math.max(1, Math.min(4, Math.trunc(sustainableMobileRollback)));
  const rtt = Number.isFinite(rttMs) ? Math.max(0, rttMs!) : 100;
  const jitter = Number.isFinite(jitterMs) ? Math.max(0, jitterMs!) : 10;
  const networkFrames = Math.max(1, Math.min(8, Math.ceil((rtt + 2 * jitter) * 60 / 1000)));
  const targetRollbackFrames = phones >= 2 ? Math.min(limit, robust) : Math.min(limit, robust * 2);
  return {
    inputDelay: phones === 1 ? 1 : phones === 2 ? 2 :
      Math.max(0, Math.min(4, networkFrames - targetRollbackFrames)),
    targetRollbackFrames,
    networkFrames,
    mobileSeats: phones,
  };
}
