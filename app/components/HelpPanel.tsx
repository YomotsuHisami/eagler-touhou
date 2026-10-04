import {useLayoutEffect, useRef} from 'react';
import {useLocation, useNavigate, useSearchParams} from 'react-router';
import {AnimatedDialog, AnimatedDialogClose} from './AnimatedDialog';

/** Router owns open state; the stable shell retains only its visual exit. */
export function GlobalHelpPanel() {
  const [query] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const open = query.get('panel') === 'help';
  const closing = useRef(false);
  useLayoutEffect(() => {closing.current = false;}, [location.key]);
  const close = () => {
    if (!open || closing.current) return;
    closing.current = true;
    if (location.state?.returnTo === location.pathname) void navigate(-1);
    else {
      const next = new URLSearchParams(location.search); next.delete('panel');
      void navigate({pathname: location.pathname, search: next.toString(), hash: location.hash}, {replace: true});
    }
  };
  return <AnimatedDialog open={open} onOpenChange={next => {if (!next) close();}} title="操作说明"
    description="方向键移动，Z 射击，X 使用 Bomb，Shift 低速移动。具体规则以作品能力为准。">
    <p className="mb-5 text-sm text-muted">当前原版验证入口限定日文、无音乐和键盘。真实游戏及手机验收范围见开发文档。</p>
    <AnimatedDialogClose className="rounded-xl border border-white/20 px-4 py-2">关闭</AnimatedDialogClose>
  </AnimatedDialog>;
}
