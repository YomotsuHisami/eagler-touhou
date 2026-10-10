import type {MainDialogProps} from './use-main-dialog';
import {InformationalDialog, informationalDialogPresentation} from './InformationalDialog';
export interface DonationDialogProps extends MainDialogProps {
  assetUrl(path: string): string;
  /** Main hides both donation triggers after missing artwork, without fallback copy. */
  onArtworkUnavailable(): void;
  /** Main library animates; original standalone lobby closes immediately. */
  closeDurationMs?: 0 | 220;
}
/** Exact intentionally untranslated main index.html804–816. */
export function DonationDialog({assetUrl, onArtworkUnavailable, closeDurationMs, ...props}: DonationDialogProps) {
  return <InformationalDialog {...props} id="donationDialog" titleId="donationTitle" closeId="donationClose"
    title="捐赠以支持服务器运行" closeLabel="关闭捐赠窗口" presentation={informationalDialogPresentation.artwork} immediateClose={closeDurationMs === 0}>
    {({closeImmediately}) =>
      <div className="donation-image-wrap"><p className="donation-scan-hint">使用微信扫码。</p><img id="donationImage" src={assetUrl('assets/donation.webp')} alt="Tenko 的赞赏码" decoding="async" onError={() => {closeImmediately(); onArtworkUnavailable();}}/></div>
    }
  </InformationalDialog>;
}
