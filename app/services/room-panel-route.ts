export const roomPanelKinds = ['personal', 'game', 'network', 'spectators', 'options'] as const;
export type RoomPanelKind = typeof roomPanelKinds[number];
export interface RoomPanelAddress {pathname: string; search: string; hash: string}

/** roomOptions stays a supported settings link, including native TH09 entry. */
export function roomPanelKind(search: string): RoomPanelKind | null {
  const query = new URLSearchParams(search);
  if (query.get('roomOptions') === '1') return 'options';
  const kind = query.get('roomPanel');
  return roomPanelKinds.find(value => value !== 'options' && value === kind) ?? null;
}
export function roomPanelAddress(location: RoomPanelAddress, kind: RoomPanelKind | null): RoomPanelAddress {
  const query = new URLSearchParams(location.search);
  query.delete('roomPanel'); query.delete('roomOptions');
  if (kind === 'options') query.set('roomOptions', '1');
  else if (kind) query.set('roomPanel', kind);
  return {pathname: location.pathname, search: query.size ? `?${query}` : '', hash: location.hash};
}
export function sameRoomPanelAddress(a: RoomPanelAddress, b: RoomPanelAddress) {
  return a.pathname === b.pathname && a.search.replace(/^\?/, '') === b.search.replace(/^\?/, '') && a.hash === b.hash;
}
