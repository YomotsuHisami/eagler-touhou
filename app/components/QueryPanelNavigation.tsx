import {useId, useLayoutEffect, useRef} from 'react';
import {useLocation, useNavigate, useNavigation} from 'react-router';
import {createQueryPanelNavigation, queryPanelAddress, type QueryPanelKind} from '../services/query-panel-navigation';

/** Each panel uses the same Router-owned pending/committed navigation semantics. */
export function useQueryPanelNavigation(panel: QueryPanelKind) {
  const location = useLocation(), navigation = useNavigation(), navigate = useNavigate(), id = useId();
  const go = useRef(navigate); go.current = navigate;
  const owner = useRef<ReturnType<typeof createQueryPanelNavigation> | null>(null);
  owner.current ??= createQueryPanelNavigation(panel, id, (target, options) => typeof target === 'number' ? go.current(target) : go.current(target, options), {location, navigation});
  const controller = owner.current, displayed = navigation.location ?? location;
  useLayoutEffect(() => {controller.update({location, navigation});}, [controller, location, navigation]);
  useLayoutEffect(() => () => controller.dispose(), [controller]);
  return {open: new URLSearchParams(displayed.search).get('panel') === panel, target: queryPanelAddress(location, panel),
    locationKey: displayed.key, openPanel: controller.open, closePanel: controller.close};
}
