import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefCallback} from 'react';
import {isProductId, isMultiplayerProductId, type ProductId} from '../src/contracts/product-catalog.mts';
import type {UiLocale} from '../src/launcher/i18n.mts';
import {LocaleProvider, translate} from './i18n';
import {PlayerSurface} from './components/player/PlayerSurface';
import {LibrarySurface} from './components/launcher/LibrarySurface';
import {LobbySurface, type LobbySurfaceProps} from './components/launcher/LobbySurface';
import {OptionsPanel} from './components/launcher/OptionsPanel';
import {LobbyOptionsHost} from './components/launcher/LobbyOptionsHost';
import {useLibraryOptionsPresence} from './components/launcher/use-library-options-presence';
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
  lessMotion?: boolean;
  products: readonly LibraryProduct[];
  catalogProducts?: readonly LibraryProduct[];
  productAvailable?(productId: ProductId): boolean;
  onProductSelected?(productId: ProductId, changed: boolean): void;
  onRouteSelection?(productId: ProductId, context?: 'library' | 'lobby'): void;
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
  serverStatusNote?: ReactNode;
  lobby: LobbyPresentation;
  renderLobby?(props: LobbySurfaceProps): ReactNode;
  /** Full launch/room owners compose their original controls at this seam. */
  optionsActions?: ReactNode;
  multiplayerControls?: ReactNode;
  multiplayerDiagnostics?: ReactNode;
  multiplayerOnline?: ReactNode;
  overlays?: ReactNode;
  previewImage?: string;
  touchFireEnabled?: boolean;
  bootTouchPreview?: boolean;
  bootTouchPreviewImage?: string;
  runtimeOpen?: boolean;
  runtimeLaunched?: boolean;
  titleOverlayOpen?: boolean;
  requestRuntimeClose?(): Promise<boolean>;
  requestRoomLeave?(): void;
  roomSurface?: ReactNode;
  roomDrawer?: ReactNode;
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
    <SurfaceNavigationProvider dirty={layout.dirty} isEditing={layout.isEditing} onDiscard={host.touchLayout.discard} decisions={host.decisions}
      playerOpen={host.runtimeOpen} requestRuntimeClose={host.requestRuntimeClose} requestRoomLeave={host.requestRoomLeave} titleOverlayOpen={host.titleOverlayOpen} productAvailable={host.productAvailable} onRouteSelection={host.onRouteSelection}>
      <LauncherSurfaces host={host}/>
    </SurfaceNavigationProvider>
  </LocaleProvider>;
}

function LauncherSurfaces({host}: {host: LauncherHost}) {
  const navigation = useSurfaceNavigation();
  const settings = useSyncExternalStore(host.settings.subscribe, host.settings.getSnapshot, host.settings.getSnapshot);
  const layout = useSyncExternalStore(host.touchLayout.subscribe, host.touchLayout.getSnapshot, host.touchLayout.getSnapshot);
  const [preview, setPreview] = useState<string | undefined>(navigation.productId ?? host.products[0]?.id);
  const selectedLifetime = useRef<string | null>(settings ? `${navigation.context}:${settings.context.productId}` : null);
  const contextRevision = useRef<number | undefined>(undefined);
  const [playerElement, setPlayerElement] = useState<HTMLElement | null>(null);
  const roomOpen = navigation.roomCode !== null && navigation.productId !== null && isMultiplayerProductId(navigation.productId);
  const catalog = host.catalogProducts ?? host.products;
  const optionsOpen = !roomOpen && navigation.hasSelection;
  const retainedProduct = useRef<ProductId | undefined>(host.products[0]?.id);
  if (navigation.productId && catalog.some(product => product.id === navigation.productId)) retainedProduct.current = navigation.productId;
  // Main keeps the selected panel in the DOM during its closing transition.
  const selectedProduct = catalog.find(product => product.id === retainedProduct.current);
  const presence = useLibraryOptionsPresence({open: optionsOpen, context: navigation.context, product: selectedProduct, lessMotion: host.lessMotion === true, concealed: host.runtimeLaunched === true && navigation.surface !== 'touch'});
  useLayoutEffect(() => {
    if (!optionsOpen && !roomOpen) {if (navigation.context === 'lobby') selectedLifetime.current = null; return;}
    if (!navigation.productId) return;
    const context = host.settingsContext(navigation.productId, host.locale);
    const lifetime = `${navigation.context}:${navigation.productId}`;
    if (host.onRouteSelection && settings?.context.productId !== navigation.productId) return;
    if (selectedLifetime.current !== lifetime) {
      selectedLifetime.current = lifetime;
      if (!host.onRouteSelection) host.settings.hydrate(context, {resetDisclosure: navigation.context === 'lobby'});
    } else if (settings?.context.uiLocale !== host.locale || contextRevision.current !== host.metadataRevision) host.settings.refreshContext(context);
    contextRevision.current = host.metadataRevision;
  }, [host, navigation.productId, optionsOpen, roomOpen, settings?.context.uiLocale]);
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
    document.body.classList.toggle('mp-room-active', roomOpen);
    return () => {document.body.classList.remove('lobby-page', 'mp-room-active');};
  }, [navigation.context, optionsOpen, roomOpen]);
  const activate = (id: string) => {
    if (!isProductId(id)) return;
    if (navigation.context === 'library' && isMultiplayerProductId(id)) navigation.openDirectory(id);
    else {
      const previous = host.settings.getSnapshot()?.context.productId;
      navigation.openOptions(id);
      if (navigation.context === 'library' && !isMultiplayerProductId(id)) {if (host.onProductSelected) host.onProductSelected(id, previous !== id); else host.settingsActions.feedback('', translate(host.locale, previous === id ? 'status.selectedProduct' : 'status.switchedProduct', {product: host.products.find(product => product.id === id)?.title ?? id}));}
      requestAnimationFrame(() => document.querySelector<HTMLElement>('#libraryBack')?.focus({preventScroll: true}));}
  };
  const openTouchLayout = () => {
    if (host.runtimeLaunched) {
      const reason = translate(host.locale, 'touch.editWhileRunning');
      host.settingsActions.feedback(reason, translate(host.locale, 'status.errorReason', {reason}));
      return;
    }
    navigation.openTouchLayout();
  };
  const settingsPanel = presence.product && <OptionsPanel product={presence.product} open={navigation.context === 'lobby' || presence.open}
    onBack={roomOpen ? navigation.closeRoomSettings : navigation.closeSurface} roomDrawer={roomOpen} multiplayerDiagnostics={host.multiplayerDiagnostics} multiplayerOnline={host.multiplayerOnline} lobbyHref={host.lobbyHref} embeddedInLobby={navigation.context === 'lobby'} assetUrl={host.assetUrl} actions={host.optionsActions}>
    <SettingsBody model={host.settings} actions={host.settingsActions} onOpenTouchLayout={openTouchLayout} multiplayerControls={host.multiplayerControls}/>
  </OptionsPanel>;
  const editor = playerElement && navigation.surface === 'touch' && settings &&
    <TouchLayoutEditor playerElement={playerElement} model={host.touchLayout} settings={host.settings} actions={host.settingsActions}
      native={host.nativeTouch} onCloseIntent={navigation.closeSurface} fireEnabled={host.touchFireEnabled} previewImage={host.previewImage ?? (selectedProduct?.artwork ? `url(${JSON.stringify(selectedProduct.artwork)})` : 'none')}/>;
  const lobbyProps: LobbySurfaceProps = {...host.lobby, products: host.products.filter(product => product.multiplayer),
    selectedProduct: navigation.filterProductId ?? undefined, onSelect: id => {if (isProductId(id)) navigation.selectLobbyProduct(id);},
    onActivate: activate, roomUsersArtwork: host.assetUrl('assets/room-users.svg'),
    children: <LobbyOptionsHost open={optionsOpen} foregroundActive={navigation.surface === 'touch' || host.runtimeOpen === true} onCloseRequest={navigation.closeSurface}>{settingsPanel}</LobbyOptionsHost>};
  return <>
    {navigation.context === 'lobby' ? host.renderLobby ? host.renderLobby(lobbyProps) : <LobbySurface {...lobbyProps}/> : <LibrarySurface products={host.products} selectedProduct={preview} openedProduct={presence.openedProduct}
      onSelect={setPreview} onActivate={activate} masthead={host.masthead} footer={host.footer} serverStatusNote={host.serverStatusNote}
      lobbyHref={host.lobbyHref} roomUsersArtwork={host.assetUrl('assets/room-users.svg')} optionsOpen={presence.open} roomOpen={roomOpen} roomDrawer={host.roomDrawer} onBack={navigation.closeSurface}>
      {settingsPanel}{host.roomSurface}
    </LibrarySurface>}
    <PlayerSurface preview={host.bootTouchPreview} previewImage={host.bootTouchPreviewImage} onElement={setPlayerElement} onFrame={host.runtimeFrame} open={navigation.surface === 'touch' || host.runtimeOpen === true} editing={navigation.surface === 'touch'}>{host.runtimeControls}</PlayerSurface>
    {editor}{host.overlays}
  </>;
}
