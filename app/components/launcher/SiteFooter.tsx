/** Exact, intentionally untranslated original main index.html722–729 footer. */
export function SiteFooter({onDonation, donationAvailable = true}: {onDonation: () => void; donationAvailable?: boolean}) {
  return <footer className="site-footer">
    <div className="site-footer-divider" aria-hidden="true"/>
    <div className="site-footer-inner">
      <p>由&nbsp;<a href="https://b23.tv/x3IIf0k" target="_blank" rel="noopener noreferrer">Ritosa</a>、<a href="https://github.com/Goan114" target="_blank" rel="noopener noreferrer">Goan114</a>、<a href="https://b23.tv/kmhLOQb" target="_blank" rel="noopener noreferrer">Grass1337</a>、<a href="https://github.com/Patchouli-CN" target="_blank" rel="noopener noreferrer">Patchouli-CN</a>、<a href="https://b23.tv/WOQhahY" target="_blank" rel="noopener noreferrer">SteinsGateON</a>&nbsp;倾力开发。</p>
      <p>使用 GPL-3.0 license。<a href="https://github.com/YomotsuHisami/eagler-touhou" target="_blank" rel="noopener noreferrer">Github 仓库</a><i aria-hidden="true">/</i><a href="https://qm.qq.com/q/eeUrxIltug" target="_blank" rel="noopener noreferrer">QQ 群</a><i aria-hidden="true">/</i><button className="site-footer-link" id="donationOpen" type="button" hidden={!donationAvailable} onClick={onDonation}>捐赠以支持服务器运行</button></p>
      <p className="site-footer-record"><a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">赣ICP备2025074288号-1</a></p>
    </div>
  </footer>;
}
