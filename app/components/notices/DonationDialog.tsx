import {useMainDialog, type MainDialogProps} from './use-main-dialog';
export interface DonationDialogProps extends MainDialogProps {
  assetUrl(path: string): string;
  /** Main hides both donation triggers after missing artwork, without fallback copy. */
  onArtworkUnavailable(): void;
  /** Main library animates; original standalone lobby closes immediately. */
  closeDurationMs?: 0 | 220;
}
/** Exact intentionally untranslated main index.html804–816. */
export function DonationDialog({assetUrl, onArtworkUnavailable, closeDurationMs = 220, ...props}: DonationDialogProps) {
  const dialog = useMainDialog(props, closeDurationMs, 'replay-window-out');
  return <dialog ref={dialog.ref} className="apple-refresh-dialog donation-dialog" id="donationDialog" aria-labelledby="donationTitle" onCancel={dialog.onCancel} onClick={dialog.onClick} onAnimationEnd={dialog.onAnimationEnd}>
    <article className="apple-refresh-window donation-window"><header><h1 id="donationTitle">捐赠以支持服务器运行</h1><button id="donationClose" type="button" aria-label="关闭捐赠窗口" onClick={dialog.requestClose}>×</button></header>
      <div className="donation-image-wrap"><p className="donation-scan-hint">使用微信扫码。</p><img id="donationImage" src={assetUrl('assets/donation.webp')} alt="Tenko 的赞赏码" decoding="async" onError={() => {dialog.requestImmediateClose(); onArtworkUnavailable();}}/></div>
    </article>
  </dialog>;
}
