import {useState} from 'react';

/** Announcement brand icons are optional Host assets; a missing one leaves only the label. */
export function SiteNoticeBrandIcon({src}: {src: string}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  return <span className="site-notice-brand-icon"><img src={src} alt="" decoding="async" onError={() => setFailed(src)}/></span>;
}
