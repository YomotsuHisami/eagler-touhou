import {useLayoutEffect, useRef} from 'react';
import {useLocation, useNavigation, useOutlet} from 'react-router';
import {GameLibrary} from '../components/LauncherShell';
import {AnimatedDialog} from '../components/AnimatedDialog';
import {LibraryPanelNavigationProvider, useLibraryPanelNavigation} from '../components/LibraryPanelNavigation';
import {ProductPanelHeader} from '../components/ProductPanelHeader';
import {ManagementSurfaceSlot} from '../components/ManagementSurface';
import {useLocale} from '../components/LocaleProvider';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {libraryPanelParent, libraryPanelProduct} from '../services/library-panel-navigation';
import {isMultiplayerProductId} from '../../src/contracts/product-catalog.mts';

/** The pathless layout survives every library/product child route. Only the
 * Router-owned sheet changes; the actual rail nodes and Runtime stay mounted. */
export default function Library() {return <LibraryPanelNavigationProvider><LibraryScene/></LibraryPanelNavigationProvider>;}
function LibraryScene() {
  const location = useLocation(), navigation = useNavigation(), outlet = useOutlet(), {t} = useLocale();
  const owner = useLibraryPanelNavigation()!, runtime = useRuntimeSnapshot();
  const shown = navigation.location ?? location;
  const product = libraryPanelProduct(shown.pathname), parent = libraryPanelParent(shown);
  const room = !!product && isMultiplayerProductId(product) && shown.pathname.replace(/\/$/, '') === `/play/${product}` && new URLSearchParams(shown.search).has('mpRoom');
  // Match the existing Runtime viewport ownership, including its recoverable
  // ready/error surface. No launch, close, save or navigation blocker lives here.
  const runtimeVisible = !!runtime && (runtime.launched || runtime.phase === 'launching' || runtime.phase === 'error' && runtime.ready);
  const library = useRef<HTMLDivElement>(null), back = useRef<HTMLButtonElement>(null), returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (product) returnFocus.current = library.current?.querySelector<HTMLElement>(`[data-library-product="${product}"]`) ?? null;
  }, [product]);
  const title = room ? t('multiplayer.roomAria') : shown.pathname.endsWith('/resources') ? t('react.resources.title') : shown.pathname.endsWith('/replays') ? 'Replay' : shown.pathname.endsWith('/saves') ? t('nav.oldSitePart1') : t('settings.title');
  return <>
    <div ref={library} data-library-stage="" hidden={room}><GameLibrary activeProductId={product ?? undefined}/></div>
    <AnimatedDialog open={!!product && !runtimeVisible} onOpenChange={open => {if (!open && !room) owner.close();}}
      layout={room ? 'fullscreen' : 'library-panel'} layer={room ? 15 : 31} title={title} initialFocus={room ? undefined : back} returnFocus={returnFocus}
      onEscapeKeyDown={event => {if (room) event.preventDefault();}} onPointerDownOutside={event => {if (room) event.preventDefault();}}>
      {room ? outlet : <>
        {product && <ProductPanelHeader productId={product} onBack={owner.close} backRef={back} backLabel={parent.pathname === '/' ? t('library.back') : t('react.routes.backSettings')}/>}
        <div className="library-panel-scroll" data-library-panel-body="" aria-busy={navigation.state !== 'idle'}>
          {outlet ?? <p role="status" className="py-6 text-sm text-muted">{t('react.app.loading')}</p>}
        </div>
      </>}
      <ManagementSurfaceSlot floating={room}/>
    </AnimatedDialog>
    {!product && outlet}
  </>;
}
