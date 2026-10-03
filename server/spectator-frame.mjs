import { parseMeasuredNetplayTiming } from '../lib/contracts/netplay-timing.mjs';
// Only the room's declared game protocol may enter its spectator backlog.
export function isSpectatorFrameForRoom(roomId, payload, playerCount) {
  if(/^th(?:08|10)mp-/.test(roomId)&&[2,3].includes(playerCount)&&payload?.length===40&&
     payload[0]===69&&payload[1]===(roomId.startsWith('th08mp-')?56:65)&&payload[2]===84&&payload[3]===77&&payload[4]===1){
    const v=new DataView(payload.buffer,payload.byteOffset,payload.byteLength),automatic=v.getUint32(32,true);
    return automatic<=1&&!!parseMeasuredNetplayTiming({phase:'ready',automatic:!!automatic,adonisMode:payload[5],
      inputDelay:payload[6],predictionReserve:payload[7],fullDelay:v.getUint32(8,true),rttP95Us:v.getUint32(24,true),
      lost:v.getUint32(28,true),samples:v.getUint32(36,true),route:'spectator'});
  }
  if(roomId.startsWith('th09mp-') && playerCount===2 && payload?.length===40 &&
     payload[0]===84 && payload[1]===57 && payload[2]===84 && payload[3]===77 && payload[4]===1) {
    const v=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
    const mode=payload[5],d=payload[6],reserve=payload[7],full=v.getUint32(8,true);
    const rtt=v.getUint32(24,true),lost=v.getUint32(28,true),automatic=v.getUint32(32,true),samples=v.getUint32(36,true);
    return automatic<=1 && !!parseMeasuredNetplayTiming({phase:'ready',automatic:!!automatic,
      adonisMode:mode,inputDelay:d,predictionReserve:reserve,fullDelay:full,
      rttP95Us:rtt,lost,samples,route:'spectator'});
  }
  if (!payload || payload[6] !== playerCount) return false;
  if (roomId.startsWith('th09mp-')) return playerCount === 2 &&
    payload.length === 46 && payload[0] === 0x54 && payload[1] === 0x39 &&
    payload[2] === 0x53 && payload[3] === 0x50 && payload[4] === 1 && payload[5] === 3 &&
    payload[7] === 0;
  const protocol = { th06mp: 0x36, th07mp: 0x37, th08mp: 0x38, th10mp: 0x41 }[roomId.split('-')[0]];
  return protocol !== undefined && (playerCount === 2 || playerCount === 3) &&
    payload.length === 24 + playerCount * 12 &&
    payload[0] === 0x45 && payload[1] === protocol &&
    payload[2] === 0x4e && payload[3] === 0x50 && payload[4] === 4 &&
    payload[5] === 3 && payload[7] === 0;
}
