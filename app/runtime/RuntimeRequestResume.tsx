import {useEffect, useSyncExternalStore, type RefObject} from 'react';
import {useDocumentRequestScope} from '../components/DocumentRequestProvider';
import type {RuntimeService} from '../services/runtime.client';
import {observeRuntimeRequestResume} from './runtime-frame-request-resume';

const none = () => () => {}, empty = () => null;
/** Direct trusted iframe input may resume a cancelled navigation's read pause.
 * This observer never sends Runtime commands or changes the current session.
 */
export function RuntimeRequestResume({service, frame}: {
  service: Pick<RuntimeService, 'subscribe' | 'getSnapshot' | 'getInputContext'> | null;
  frame: RefObject<HTMLIFrameElement | null>;
}) {
  const scope = useDocumentRequestScope();
  const snapshot = useSyncExternalStore(service?.subscribe ?? none, service?.getSnapshot ?? empty, empty);
  useEffect(() => {
    if (!scope || !service || !snapshot?.ready || snapshot.epoch === null) return;
    return observeRuntimeRequestResume({frame: () => frame.current, context: () => service.getInputContext(),
      resume: scope.resumeFromTrustedInput});
  }, [scope, service, frame, snapshot?.epoch, snapshot?.ready]);
  return null;
}
