import {Link, useParams, useLocation, useNavigate} from 'react-router';
import {HelpLink} from '../components/HelpPanel';
import {GameSettings} from '../components/GameSettings';
import {SamplePreparation} from '../components/SamplePreparation';
import {PRODUCT_GAMES, gameIdForProduct, isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
export default function Game() {
  const {productId = ''} = useParams();
  const location = useLocation(), navigate = useNavigate();
  if (!isProductId(productId) || !productEnabledForBuild(productId, false)) return <section><h1>此作品当前不可用</h1><Link to="/">返回游戏库</Link></section>;
  const game = PRODUCT_GAMES[gameIdForProduct(productId)];
  return <section className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-panel p-6"><button type="button" className="text-muted hover:text-foreground" onClick={()=>{if(location.state?.returnTo==='/')void navigate(-1);else void navigate('/',{replace:true});}}>返回游戏库</button><h1 className="my-4 text-3xl font-bold">{game.title}</h1><p className="text-muted">{game.subtitle}</p><p className="my-6">main 基线组件样板。设置保存在当前浏览器的本地配置中；安装与游戏会话尚未接通。</p><GameSettings productId={productId}/><HelpLink className="inline-block rounded-xl border border-white/20 px-4 py-2 focus-visible:outline-2">操作说明</HelpLink>{productId === 'th06' && <SamplePreparation/>}</section>;
}
