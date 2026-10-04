import {useRef, type RefObject} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {useLocation, useNavigate, useSearchParams} from 'react-router';
import {motion} from 'motion/react';
/** Router owns presence; Radix owns focus/dismissal; Motion owns entry animation. */
export function HelpPanel({returnFocus}: {returnFocus?: RefObject<HTMLAnchorElement | null>} = {}) {
  const navigate = useNavigate(), location = useLocation();
  const parent = location.pathname;
  const closing = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const close = () => {
    if(closing.current) return;
    closing.current = true;
    if(location.state?.returnTo === parent) void navigate(-1);
    else {const query = new URLSearchParams(location.search); query.delete('panel'); void navigate({pathname:location.pathname,search:query.toString(),hash:location.hash},{replace:true});}
  };
  return <Dialog.Root open onOpenChange={open => {if(!open) close();}}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/60"/><Dialog.Content asChild onOpenAutoFocus={() => {
    // Capture the real opener before Radix moves focus, including the Runtime
    // toolbar. A directly loaded Help URL falls back to the route's Help link.
    opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : null;
  }} onCloseAutoFocus={event => {
    event.preventDefault();
    const target = opener.current?.isConnected && opener.current !== document.body ? opener.current : returnFocus?.current ?? document.getElementById('main-content');
    target?.focus();
  }}><motion.section initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.18}} className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-lg -translate-y-1/2 rounded-3xl border border-white/15 bg-panel p-6 shadow-2xl"><Dialog.Title className="text-xl font-bold">操作说明</Dialog.Title><Dialog.Description className="my-4 text-muted">方向键移动，Z 射击，X 使用 Bomb，Shift 低速移动。具体规则以作品能力为准。</Dialog.Description><p className="mb-5 text-sm text-muted">当前原版验证入口限定日文、无音乐和键盘。真实游戏及手机验收范围见开发文档。</p><Dialog.Close className="rounded-xl border border-white/20 px-4 py-2">关闭</Dialog.Close></motion.section></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function GlobalHelpPanel() {
  const [query] = useSearchParams(), location = useLocation();
  return query.get('panel') === 'help' ? <HelpPanel key={location.key}/> : null;
}
