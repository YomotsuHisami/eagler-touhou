import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefCallback} from 'react';
import {isProductId, type ProductId} from '../src/contracts/product-catalog.mts';
import type {UiLocale} from '../src/launcher/i18n.mts';
import {LocaleProvider, translate} from './i18n';
import {PlayerSurface} from './components/player/PlayerSurface';
import {LibrarySurface} from './components/launcher/LibrarySurface';
import {LobbySurface, type LobbySurfaceProps} from './components/launcher/LobbySurface';
import {OptionsPanel} from './components/launcher/OptionsPanel';
import type {LibraryProduct} from './components/launcher/products';
import {SettingsBody} from './components/settings/SettingsBody';
import {TouchLayoutEditor} from './components/settings/TouchLayoutEditor';
import type {SettingsActions, TouchEditorNativePorts} from './components/settings/types';
import type {GameSettingsModel, SettingsContext} from './models/game-settings';
import type {DecisionStore} from './models/decisions';
import type {TouchLayoutModel} from './models/touch-layout';
import {SurfaceNavigationProvider, useSurfaceNavigation} from './navigation/surface-navigation';

export type LobbyPresentation = Omit<LobbySurfaceProps, 'products' | 'selectedProduct' | 'openedProduct' | 'onSelect' | 'onActivate' | 'children' | 'roomUsersArtwork'>;
/** One document-lived domain host. Tests may explicitly inject fixture ports;
 * production must supply the actual storage, file, runtime and room owners. */
export interface LauncherHost {
  locale: UiLocale;
  products: readonly LibraryProduct[];
  settings: GameSettingsModel;
  touchLayout: TouchLayoutModel;
  settingsContext(productId: ProductId, locale: UiLocale): SettingsContext;
  settingsActions: SettingsActions;
  decisions?: DecisionStore;
  nativeTouch: TouchEditorNativePorts;
  assetUrl(path: string): string;
  lobbyHref: string;
  masthead: ReactNode;
  footer: ReactNode;
  lobby: LobbyPresentation;
  /** Full launch/room owners compose their original controls at this seam. */
  optionsActions?: ReactNode;
  multiplayerControls?: ReactNode;
  overlays?: ReactNode;
  previewImage?: string;
  runtimeOpen?: boolean;
  runtimeFrame?: RefCallback<HTMLIFrameElement>;
  runtimeControls?: ReactNode;
  /** Incremented for host/catalog/current-install changes, not every render. */
  metadataRevision?: number;
}

/** Actual React entry shared by Framework routes and the mounted regression.
 * It deliberately has no hidden default ports, demo preferences or fake room. */
export function LauncherApplication({host}: {host: LauncherHost}) {
  const layout = useSyncExternalStore(host.touchLayout.subscribe, host.touchLayout.getSnapshot, host.touchLayout.getSnapshot);
  return <LocaleProvider locale={host.locale}>
    <SurfaceNavigationProvider dirty={layout.dirty} isEditing={layout.isEditing} onDiscard={host.touchLayout.discard} decisions={host.decisions}>
      <LauncherSurfaces host={host}/>
    </SurfaceNavigationProvider>
  </LocaleProvider>;
}

function LauncherSurfaces({host}: {host: LauncherHost}) {
  const navigation = useSurfaceNavigation();
  const settings = useSyncExternalStore(host.settings.subscribe, host.settings.getSnapshot, host.settings.getSnapshot);
  const layout = useSyncExternalStore(host.touchLayout.subscribe, host.touchLayout.getSnapshot, host.touchLayout.getSnapshot);
  const [preview, setPreview] = useState<string | undefined>(navigation.productId ?? host.products[0]?.id);
  const selectedLifetime = useRef<ProductId | null>(null);
  const contextRevision = useRef<number | undefined>(undefined);
  const [playerElement, setPlayerElement] = useState<HTMLElement | null>(null);
  const optionsOpen = navigation.surface !== 'library';
  const retainedProduct = useRef<ProductId | undefined>(host.products[0]?.id);
  if (navigation.productId && host.products.some(product => product.id === navigation.productId)) retainedProduct.current = navigation.productId;
  // Main keeps the selected panel in the DOM during its closing transition.
  const selectedProduct = host.products.find(product => product.id === retainedProduct.current);
  useLayoutEffect(() => {
    if (!optionsOpen) {selectedLifetime.current = null; return;}
    if (!navigation.productId) return;
    const context = host.settingsContext(navigation.productId, host.locale);
    if (selectedLifetime.current !== navigation.productId) {
      selectedLifetime.current = navigation.productId;
      host.settings.hydrate(context);
    } else if (settings?.context.uiLocale !== host.locale || contextRevision.current !== host.metadataRevision) host.settings.refreshContext(context);
    contextRevision.current = host.metadataRevision;
  }, [host, navigation.productId, optionsOpen, settings?.context.uiLocale]);
  useEffect(() => {
    // Draft lifetime ends only after Router commits leaving the editor. A
    // cancelled blocker leaves both the surface and draft intact.
    if (navigation.surface !== 'touch' && layout.isEditing) {
      host.touchLayout.discard();
      host.settingsActions.feedback(translate(host.locale, 'touch.layoutEditorClosed'));
    }
  }, [navigation.surface, layout.isEditing, host.touchLayout]);
  useLayoutEffect(() => {
    document.body.classList.toggle('lobby-page', navigation.context === 'lobby');
    document.body.classList.toggle('library-tools-open', optionsOpen);
    return () => {document.body.classList.remove('lobby-page', 'library-tools-open');};
  }, [navigation.context, optionsOpen]);
  const activate = (id: string) => {if (isProductId(id)) navigation.openOptions(id);};
  const settingsPanel = selectedProduct && <OptionsPanel product={selectedProduct} open={optionsOpen}
    onBack={navigation.closeSurface} lobbyHref={host.lobbyHref} embeddedInLobby={navigation.context === 'lobby'} assetUrl={host.assetUrl}>
    <SettingsBody model={host.settings} actions={host.settingsActions} onOpenTouchLayout={navigation.openTouchLayout} multiplayerControls={host.multiplayerControls}/>
    {host.optionsActions}
  </OptionsPanel>;
  const editor = playerElement && navigation.surface === 'touch' && settings?.context.productId === navigation.productId &&
    <TouchLayoutEditor playerElement={playerElement} model={host.touchLayout} settings={host.settings} actions={host.settingsActions}
      native={host.nativeTouch} onCloseIntent={navigation.closeSurface} previewImage={host.previewImage}/>;
  return <>
    {navigation.context === 'lobby' ? <LobbySurface {...host.lobby} products={host.products.filter(product => product.multiplayer)}
      selectedProduct={navigation.filterProductId ?? undefined} onSelect={id => {if (isProductId(id)) navigation.selectLobbyProduct(id);}}
      onActivate={activate} roomUsersArtwork={host.assetUrl('assets/room-users.svg')}>
      {optionsOpen && <div className="lobby-options-overlay is-open" id="lobbyOptionsOverlay"><div className="main library-layout">{settingsPanel}</div></div>}
    </LobbySurface> : <LibrarySurface products={host.products} selectedProduct={preview} openedProduct={optionsOpen ? navigation.productId ?? undefined : undefined}
      onSelect={setPreview} onActivate={activate} masthead={host.masthead} footer={host.footer}
      lobbyHref={host.lobbyHref} roomUsersArtwork={host.assetUrl('assets/room-users.svg')} optionsOpen={optionsOpen} onBack={navigation.closeSurface}>
      {settingsPanel}
    </LibrarySurface>}
    <PlayerSurface onElement={setPlayerElement} onFrame={host.runtimeFrame} open={navigation.surface === 'touch' || host.runtimeOpen === true} editing={navigation.surface === 'touch'}>{host.runtimeControls}</PlayerSurface>
    {editor}{host.overlays}
  </>;
}
