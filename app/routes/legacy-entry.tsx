import {Link} from 'react-router';

/** Display-only alias route. The single root LegacyEntryAdapter owns replacement. */
export default function LegacyEntryRoute() {
  return <section className="mx-auto max-w-3xl rounded-3xl border border-line bg-panel p-6" aria-labelledby="legacy-entry-title">
    <h1 id="legacy-entry-title" className="text-2xl font-bold">正在打开原有链接</h1>
    <p role="status" className="mt-3 text-sm text-muted">正在恢复作品或房间页面，游戏不会自动启动。</p>
    <Link to="/" replace className="mt-5 inline-block min-h-11 rounded-xl border border-line px-4 py-2">返回游戏库</Link>
  </section>;
}
