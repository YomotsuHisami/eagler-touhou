import {useEffect, useId, useMemo, useRef, useState} from 'react';
import type {PackagedContent} from '../services/notices.client';
import {multiplayerGuideGameId, multiplayerGuideGroups} from '../services/multiplayer-guide-content';
import {renderPackagedNodes} from './PackagedContentNodes';
import {useLocale} from './LocaleProvider';
const prose = 'space-y-3 text-sm leading-relaxed [&_h2]:mt-5 [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:font-bold [&_h4]:mt-3 [&_h4]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent';
export function MultiplayerGuideContent({content, gameId, request}: {content: PackagedContent; gameId: string | null; request: number}) {
  const {t} = useLocale(), id = useId();
  const groups = useMemo(() => multiplayerGuideGroups(content.nodes), [content.nodes]);
  const [selected, setSelected] = useState(() => multiplayerGuideGameId(gameId));
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {setSelected(multiplayerGuideGameId(gameId));}, [gameId, request]);
  if (content.status === 'error') return <p role="alert">{t('multiplayerGuide.readFailed', {reason: content.error ?? ''})}</p>;
  if (content.status === 'empty') return <p>{t('common.none')}</p>;
  if (content.status !== 'available') return <p role="status">{t('multiplayerGuide.loading')}</p>;
  if (!groups) return <div lang="zh-CN" className={prose}>{renderPackagedNodes(content.nodes)}</div>;
  return <div className="space-y-4">
    <div lang="zh-CN" className={prose}>{renderPackagedNodes(groups.intro)}</div>
    <div role="tablist" aria-label={t('lobby.game')} className="flex flex-wrap gap-2">
      {groups.games.map((game, index) => <button key={game.id} type="button" role="tab" id={`${id}-tab-${game.id}`} aria-controls={`${id}-panel-${game.id}`} aria-selected={selected === game.id}
        tabIndex={selected === game.id ? 0 : -1} ref={node => {if (node) tabs.current.set(game.id, node);else tabs.current.delete(game.id);}}
        className={`min-h-11 rounded-xl border px-3 py-2 text-sm ${selected === game.id ? 'border-accent bg-accent/10 text-accent' : 'border-line'}`}
        onClick={() => setSelected(game.id)} onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? groups.games.length - 1 : event.key === 'ArrowRight' ? (index + 1) % groups.games.length : event.key === 'ArrowLeft' ? (index - 1 + groups.games.length) % groups.games.length : null;
          if (next === null) return;event.preventDefault();const target = groups.games[next].id;setSelected(target);tabs.current.get(target)?.focus();
        }}><span lang="zh-CN">{game.title}</span></button>)}
    </div>
    {groups.games.map(game => <section key={game.id} role="tabpanel" id={`${id}-panel-${game.id}`} aria-labelledby={`${id}-tab-${game.id}`} tabIndex={0} hidden={selected !== game.id} className="space-y-3">
      <details className="rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer content-center font-bold">{t('ui.multiplayer.commonRules')}</summary><div lang="zh-CN" className={prose}>{renderPackagedNodes(groups.common)}</div></details>
      <details className="rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer content-center font-bold">{t('ui.multiplayer.specificRules')}</summary><div lang="zh-CN" className={prose}>{game.nodes.some(node => node.kind === 'element' || node.text.trim()) ? renderPackagedNodes(game.nodes) : <p>{t('common.none')}</p>}</div></details>
    </section>)}
  </div>;
}
