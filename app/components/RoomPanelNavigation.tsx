import {useId, useLayoutEffect, useRef} from 'react';
import {useLocation, useNavigate, useNavigation} from 'react-router';
import {createRoomPanelNavigation} from '../services/room-panel-navigation';
import {roomPanelKind} from '../services/room-panel-route';

/** Router alone owns secondary-room visibility, including its pending target. */
export function useRoomPanelNavigation() {
  const location = useLocation(), navigation = useNavigation(), navigate = useNavigate(), id = useId();
  const go = useRef(navigate); go.current = navigate;
  const owner = useRef<ReturnType<typeof createRoomPanelNavigation> | null>(null);
  owner.current ??= createRoomPanelNavigation(id, (target, options) => typeof target === 'number' ? go.current(target) : go.current(target, options), {location, navigation});
  const controller = owner.current;
  useLayoutEffect(() => {controller.update({location, navigation});}, [controller, location, navigation]);
  useLayoutEffect(() => () => controller.dispose(), [controller]);
  return {key: (navigation.location ?? location).key, kind: roomPanelKind((navigation.location ?? location).search), openPanel: controller.open, closePanel: controller.close};
}
