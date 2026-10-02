// Only the room's declared game protocol may enter its spectator backlog.
export function isSpectatorFrameForRoom(roomId, payload, playerCount) {
  if(roomId.startsWith('th09mp-') && playerCount===2 && payload?.length===40 &&
     payload[0]===84 && payload[1]===57 && payload[2]===84 && payload[3]===77 && payload[4]===1) {
    const v=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
    const mode=payload[5],d=payload[6],reserve=payload[7],full=v.getUint32(8,true);
    const rtt=v.getUint32(24,true),lost=v.getUint32(28,true),automatic=v.getUint32(32,true),samples=v.getUint32(36,true);
    return (mode===1?reserve===0:mode===2&&(reserve===1||reserve===2)) && d<=9 && rtt>0 && rtt<=1e6 &&
      full===Math.ceil(rtt*60/2_000_000)+1 && lost<=48 && automatic<=1 && samples>=96 && samples<=120 &&
      (!automatic||d===Math.max(0,full-reserve));
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
