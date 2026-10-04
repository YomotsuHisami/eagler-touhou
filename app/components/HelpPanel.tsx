import {useRef, type RefObject} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {useLocation, useNavigate, useParams} from 'react-router';
import {motion} from 'motion/react';
/** Router owns presence; Radix owns focus/dismissal; Motion owns entry animation. */
export function HelpPanel({returnFocus}: {returnFocus: RefObject<HTMLAnchorElement | null>}) {
  const navigate = useNavigate(), location = useLocation(), {productId} = useParams();
  const parent = `/games/${productId}`;
  const closing = useRef(false);
  const close = () => {
    if(closing.current) return;
    closing.current = true;
    if(location.state?.returnTo === parent) void navigate(-1);
    else {const query = new URLSearchParams(location.search); query.delete('panel'); void navigate({pathname:location.pathname,search:query.toString(),hash:location.hash},{replace:true});}
  };
  return <Dialog.Root open onOpenChange={open => {if(!open) close();}}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/60"/><Dialog.Content asChild onCloseAutoFocus={event => {event.preventDefault(); returnFocus.current?.focus();}}><motion.section initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.18}} className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-lg -translate-y-1/2 rounded-3xl border border-white/15 bg-panel p-6 shadow-2xl"><Dialog.Title className="text-xl font-bold">操作说明</Dialog.Title><Dialog.Description className="my-4 text-muted">方向键移动，Z 射击，X 使用 Bomb，Shift 低速移动。具体规则以作品能力为准。</Dialog.Description><p className="mb-5 text-sm text-muted">此轮样板仅验证导航与组件；真实 Runtime 接入尚待完成。</p><Dialog.Close className="rounded-xl border border-white/20 px-4 py-2">关闭</Dialog.Close></motion.section></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
