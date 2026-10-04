import {Link, NavLink, Outlet, useParams, useLocation, useNavigate} from 'react-router';
import {productManagementSearch} from '../runtime/route-session.mts';
import {useLocale} from '../components/LocaleProvider';
import {HelpLink} from '../components/HelpPanel';
import {PRODUCT_GAMES, gameIdForProduct, isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';

/** Router owns the product and child view; services live above this route. */
export default function Game() {
  const {productId = ''} = useParams();
  const {t} = useLocale();
  const location = useLocation(), navigate = useNavigate();
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return <section><h1>此作品当前不可用</h1><Link to="/">返回游戏库</Link></section>;
  const game = PRODUCT_GAMES[gameIdForProduct(productId)];
  const home = `/play/${productId}`;
  return <section className="mx-auto max-w-3xl rounded-3xl border border-line bg-panel p-6">
    <button type="button" className="min-h-11 text-muted hover:text-paper" onClick={()=>{if(location.pathname === home && location.state?.returnTo==='/')void navigate(-1);else void navigate('/');}}>返回游戏库</button>
    <h1 className="my-4 text-3xl font-bold">{game.title}</h1><p className="text-muted">{game.subtitle}</p>
    <nav aria-label="作品管理" className="my-6 flex flex-wrap gap-2">
      {[['设置', home], ['资源管理', `${home}/resources`], ['Replay', `${home}/replays`], ['存档', `${home}/saves`]].map(([label,to])=><NavLink key={to} to={{pathname:to,search:productManagementSearch(location.search)}} end className={({isActive})=>`min-h-11 rounded-xl border px-4 py-2 focus-visible:outline-2 ${isActive?'border-accent bg-accent/10 text-paper':'border-line text-muted hover:text-paper'}`}>{label}</NavLink>)}
    </nav>
    <Outlet/>
    <HelpLink className="mt-6 inline-block min-h-11 rounded-xl border border-line px-4 py-2 focus-visible:outline-2">{t('help.controlsTitle')}</HelpLink>
  </section>;
}
