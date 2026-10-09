import type {ReactNode, RefCallback} from 'react';
/** Main's one direct player/iframe. It is never keyed by route or product, and
 * touch editing only composes its workbench into this already existing stage. */
export function PlayerSurface({open, editing, onElement, onFrame, children}: {
  open: boolean; editing: boolean; onElement: RefCallback<HTMLElement>;
  onFrame?: RefCallback<HTMLIFrameElement>; children?: ReactNode;
}) {
  return <section ref={onElement} className={`player${open ? ' open' : ''}${editing ? ' touch-preview touch-layout-edit touch-enabled' : ''}`}
    id="player" aria-hidden={!open}>
    {children}
    <div className="game-viewport" id="gameViewport"><iframe ref={onFrame} id="gameFrame" title="Touhou game" allow="autoplay; fullscreen" tabIndex={0}/></div>
  </section>;
}
