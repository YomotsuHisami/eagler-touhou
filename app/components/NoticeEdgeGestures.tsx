import {useEffect} from 'react';
import {bindNoticeEdgeGestures} from '../browser/notice-edge-bindings';
import type {NoticesService} from '../services/notices.client';
/** Presentation adapter; existing service owns open/dismissal/opt-out/jobs/timers. */
export function NoticeEdgeGestures({service}:{service:NoticesService|null}) {
  useEffect(()=>service?bindNoticeEdgeGestures(service):undefined,[service]);
  return null;
}
