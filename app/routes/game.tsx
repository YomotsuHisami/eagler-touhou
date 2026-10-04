import {useRef} from 'react';
import {Link, useParams, useLocation, useSearchParams} from 'react-router';
import {GameSettings} from '../components/GameSettings';
import {HelpPanel} from '../components/HelpPanel';
import {PRODUCT_GAMES, gameIdForProduct, isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
export default function Game() {
  const {productId = ''} = useParams();
  const [query] = useSearchParams(), location = useLocation();
  const helpTrigger = useRef<HTMLAnchorElement>(null);
  const helpQuery = new URLSearchParams(query); helpQuery.set('panel', 'help');
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return <section><h1>此作品当前不可用</h1><Link to="/">返回游戏库</Link></section>;
  const game = PRODUCT_GAMES[gameIdForProduct(productId)];
  return <section className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-panel p-6"><Link to="/" className="text-muted hover:text-foreground">返回游戏库</Link><h1 className="my-4 text-3xl font-bold">{game.title}</h1><p className="text-muted">{game.subtitle}</p><p className="my-6">main 基线组件样板。设置保存在当前浏览器的本地配置中；安装与游戏会话尚未接通。</p><GameSettings productId={productId}/><Link ref={helpTrigger} to={{search:helpQuery.toString(),hash:location.hash}} state={{returnTo: `/games/${productId}`}} className="inline-block rounded-xl border border-white/20 px-4 py-2 focus-visible:outline-2">操作说明</Link>{query.get('panel') === 'help' && <HelpPanel key={location.key} returnFocus={helpTrigger}/>}</section>;
}
