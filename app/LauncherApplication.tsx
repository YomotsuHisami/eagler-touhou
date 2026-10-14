import type {ScoreStatistics} from './models/score-statistics';
import type {SaveLibraryModel} from './models/save-library';
import type {ReplayModel} from './models/replays';
import type {SiteNoticeLine} from './components/notices/site-notice-source';
import {directoryGameHref} from './navigation/addresses';
import {animateWorkspaceCard, workspaceCardSelector} from './components/launcher/workspace-motion';
import {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefCallback} from 'react';
import {isProductId, isMultiplayerProductId, gameIdForProduct, type ProductId} from '../src/contracts/product-catalog.mts';
import type {UiLocale} from '../src/launcher/i18n.mts';
import {LocaleProvider, translate} from './i18n';
import {PlayerSurface} from './components/player/PlayerSurface';
import {LibrarySurface} from './components/launcher/LibrarySurface';
import {GameWorkspace} from './components/launcher/GameWorkspace';
import {FilesWorkspace, type WorkspaceReplayActions} from './components/launcher/FilesWorkspace';
import {SettingsWorkspace} from './components/launcher/SettingsWorkspace';
import {resolveMusicAvailability} from '../src/launcher/music-availability.mts';
import {LobbySurface, type LobbySurfaceProps} from './components/launcher/LobbySurface';
import {OptionsPanel} from './components/launcher/OptionsPanel';
import {LobbyOptionsHost} from './components/launcher/LobbyOptionsHost';
import {OptionsOwnership} from './components/launcher/options-ownership';
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
  scores?: ScoreStatistics;
  saveLibrary?: SaveLibraryModel;
  replays?: ReplayModel | null;
  replayActions?: WorkspaceReplayActions;
  siteNoticeLines?: readonly SiteNoticeLine[];
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
  workspaceLobbyHref?: string;
  masthead: ReactNode;
  footer: ReactNode;
  serverStatusNote?: ReactNode;
  lobby: LobbyPresentation;
  renderLobby?(props: LobbySurfaceProps): ReactNode;
  /** Full launch/room owners compose their original controls at this seam. */
  optionsActions?: ReactNode;
  renderWorkspaceActions?(middle: ReactNode): ReactNode;
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
  roomProduct?: string;
  roomDirectoryLocked?: boolean;
  onRoomProductSelected?(id: string): void;
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
      playerOpen={host.runtimeOpen} requestRuntimeClose={host.requestRuntimeClose} requestRoomLeave={host.requestRoomLeave} titleOverlayOpen={host.titleOverlayOpen} productAvailable={host.productAvailable} onRouteSelection={host.onRouteSelection} lessMotion={host.lessMotion}>
      <LauncherSurfaces host={host}/>
    </SurfaceNavigationProvider>
  </LocaleProvider>;
}

function LauncherSurfaces({host}: {host: LauncherHost}) {
  const navigation = useSurfaceNavigation();
  const previousContext = useRef(navigation.context), restoreLaunchFocus = useRef(false);
  const settingsScope = navigation.workspaceSettingsScope;
  const filesOpen = navigation.context === 'library' && navigation.roomCode === null && navigation.infoDialogOpen('scoreFilesDialog');
  const workspaceKind = settingsScope ? `settings:${settingsScope}` : filesOpen ? 'files' : navigation.roomCode !== null ? 'room' : navigation.context;
  const motionContext = useRef(workspaceKind);
  useLayoutEffect(() => {
    if (motionContext.current === workspaceKind) return;
    const previous = motionContext.current;
    motionContext.current = workspaceKind;
    const backwards = previous === 'room' || workspaceKind === 'library';
    const settingsMotion = workspaceKind.startsWith('settings:') ? 'open' : previous.startsWith('settings:') ? 'close' : undefined;
    const filesMotion = workspaceKind === 'files' ? 'open' : previous === 'files' ? 'close' : undefined;
    const motion = animateWorkspaceCard(document.querySelector<HTMLElement>(workspaceCardSelector), 'entry', backwards, host.lessMotion,settingsMotion,filesMotion);
    void motion.finished.then(completed => {
      if (completed) {
        motion.cancel();
        // RoomWorkspace waits for both the assigned seat and this animation.
        if (workspaceKind === 'room') return;
        if(settingsMotion){document.querySelector<HTMLElement>(settingsMotion === 'open' ? '#globalSettingsClose' : previous === 'settings:game' ? '.workspace-game-settings' : '#globalSettingsOpen')?.focus({preventScroll:true});return;}
        if(filesMotion){document.getElementById(filesMotion === 'open' ? 'scoreFilesClose' : 'scoreFilesOpen')?.focus({preventScroll:true});return;}
        const target = document.querySelector<HTMLElement>(previous === 'room' ? '#createButton' : backwards ? '#optionsLobbyLink' : '#launcherLink') ??
          (backwards ? document.getElementById('siteInfoTitle') : null);
        if(target instanceof HTMLButtonElement && target.disabled) document.getElementById('launcherLink')?.focus({preventScroll:true});
        else target?.focus({preventScroll: true});
      }
    });
    return motion.cancel;
  }, [workspaceKind, host.lessMotion]);
  if (previousContext.current !== navigation.context) {restoreLaunchFocus.current = previousContext.current === 'lobby' && navigation.context === 'library'; previousContext.current = navigation.context;}
  const settings = useSyncExternalStore(host.settings.subscribe, host.settings.getSnapshot, host.settings.getSnapshot);
  const layout = useSyncExternalStore(host.touchLayout.subscribe, host.touchLayout.getSnapshot, host.touchLayout.getSnapshot);
  useLayoutEffect(() => {
    if (restoreLaunchFocus.current && navigation.context === 'library' && settings?.context.productId === navigation.productId) {
      const link = document.getElementById('optionsLobbyLink');
      if (link) {restoreLaunchFocus.current = false; link.focus({preventScroll: true});}
    }
  }, [settings?.context.productId, navigation.context, navigation.productId]);
  const selectedLifetime = useRef<string | null>(settings ? `${navigation.context}:${settings.context.productId}` : null);
  const contextRevision = useRef<number | undefined>(undefined);
  const [playerElement, setPlayerElement] = useState<HTMLElement | null>(null);
  const roomOpen = navigation.roomCode !== null && navigation.productId !== null && isMultiplayerProductId(navigation.productId);
  const catalog = host.catalogProducts ?? host.products;
  const workspaceSettingsContext = useMemo(()=>{
    if(!settingsScope)return null;
    const product = settings?.context.productId ?? navigation.productId ?? host.products[0]?.id;
    if(!product)return null;
    const base = host.settingsContext(product,host.locale);
    if(settingsScope === 'global'){
      const contexts = catalog.map(entry=>host.settingsContext(entry.id,host.locale));
      const availability = contexts.map(context=>resolveMusicAvailability(context.musicAvailability));
      const languages = [...new Map(contexts.flatMap(context=>context.languages).map(language=>[language.id,language])).values()];
      return {...base,forbidUnlimitedMovement:false,languages:languages.length ? languages : base.languages,
        musicAvailability:{audio:availability.some(value=>value.audio),midiAvailable:availability.some(value=>value.midi),remoteOggAdvertised:availability.some(value=>value.ogg),importServer:false}};
    }else return base;
  },[host.settings,settingsScope,settings?.context.productId,host.locale,host.metadataRevision]);
  const workspaceSettingsModel = useMemo(()=>{
    if(!settingsScope || !workspaceSettingsContext)return null;
    const editor = host.settings.createEditor(settingsScope);editor.hydrate(workspaceSettingsContext);return editor;
  },[host.settings,settingsScope]);
  useLayoutEffect(()=>{
    if(!workspaceSettingsModel || !workspaceSettingsContext)return;
    const previous = workspaceSettingsModel.getSnapshot()!.context;
    if(previous === workspaceSettingsContext)return;
    if(previous.uiLocale !== workspaceSettingsContext.uiLocale && !layout.isEditing)workspaceSettingsModel.restoreLocalePreferences(workspaceSettingsContext);
    else workspaceSettingsModel.refreshContext(workspaceSettingsContext);
  },[workspaceSettingsModel,workspaceSettingsContext,layout.isEditing]);
  const optionsOpen = !roomOpen && navigation.hasSelection;
  const retainedProduct = useRef<ProductId | undefined>(host.products[0]?.id);
  if (navigation.productId && catalog.some(product => product.id === navigation.productId)) retainedProduct.current = navigation.productId;
  // Main keeps the selected panel in the DOM during its closing transition.
  const selectedProduct = catalog.find(product => product.id === retainedProduct.current);
  const presence = useLibraryOptionsPresence({open: optionsOpen && navigation.context === 'lobby', context: navigation.context, product: selectedProduct, lessMotion: host.lessMotion === true, concealed: host.runtimeLaunched === true && navigation.surface !== 'touch'});
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
      if (navigation.context === 'lobby') requestAnimationFrame(() => presence.targets.panel?.querySelector<HTMLElement>('#libraryBack')?.focus({preventScroll: true}));}
  };
  const openTouchLayout = () => {
    if (host.runtimeLaunched) {
      const reason = translate(host.locale, 'touch.editWhileRunning');
      host.settingsActions.feedback(reason, translate(host.locale, 'status.errorReason', {reason}));
      return;
    }
    navigation.openTouchLayout();
  };
  const settingsPanel = !settingsScope && (navigation.context === 'lobby' || roomOpen) && presence.product && <OptionsPanel product={presence.product} open={presence.open || roomOpen && navigation.context === 'lobby'}
    onBack={roomOpen ? navigation.closeRoomSettings : navigation.closeSurface} roomDrawer={roomOpen} multiplayerDiagnostics={host.multiplayerDiagnostics} multiplayerOnline={host.multiplayerOnline} lobbyHref={host.lobbyHref} embeddedInLobby={navigation.context === 'lobby'} assetUrl={host.assetUrl} actions={host.optionsActions}>
    <SettingsBody model={host.settings} actions={host.settingsActions} onOpenTouchLayout={openTouchLayout} multiplayerControls={host.multiplayerControls}/>
  </OptionsPanel>;
  const editor = playerElement && navigation.surface === 'touch' && settings &&
    <TouchLayoutEditor playerElement={playerElement} model={host.touchLayout} settings={workspaceSettingsModel ?? host.settings} actions={host.settingsActions}
      native={host.nativeTouch} onCloseIntent={navigation.closeSurface} fireEnabled={host.touchFireEnabled} previewImage={host.previewImage ?? (selectedProduct?.artwork ? `url(${JSON.stringify(selectedProduct.artwork)})` : 'none')}/>;
  const lobbyProps: LobbySurfaceProps = {...host.lobby, products: host.products.filter(product => product.multiplayer),
    selectedProduct: navigation.filterProductId ?? undefined, openedProduct: presence.openedProduct, onSelect: id => {if (isProductId(id)) navigation.selectLobbyProduct(id);},
    embedded: true, footer: host.footer, launcherHref: navigation.filterProductId ? `${host.locale === 'en' ? 'en.html' : './'}?game=${gameIdForProduct(navigation.filterProductId)}` : host.locale === 'en' ? 'en.html' : './',
    siteHref: host.workspaceLobbyHref ?? host.lobbyHref, onSite: () => navigation.selectLobbyProduct(null), assetUrl: host.assetUrl,
    onActivate: activate, roomUsersArtwork: host.assetUrl('assets/room-users.svg'),
    children: <LobbyOptionsHost open={presence.open && !settingsScope} foregroundActive={navigation.surface === 'touch' || host.runtimeOpen === true} onCloseRequest={navigation.closeSurface}>{settingsPanel}</LobbyOptionsHost>};
  return <OptionsOwnership value={presence.targets}>
    <LibrarySurface lobby={navigation.context === 'lobby' || roomOpen} products={navigation.context === 'lobby' || roomOpen ? host.products.filter(product => product.multiplayer).map(product => ({...product, href: directoryGameHref(host.workspaceLobbyHref ?? host.lobbyHref, product.id)})) : host.products} selectedProduct={roomOpen ? host.roomProduct ?? navigation.productId ?? undefined : navigation.context === 'lobby' ? navigation.filterProductId ?? undefined : optionsOpen ? navigation.productId ?? undefined : undefined}
      roomDirectoryLocked={host.roomDirectoryLocked} onActivate={roomOpen ? host.onRoomProductSelected ?? (() => {}) : navigation.context === 'lobby' ? id => {if (isProductId(id)) navigation.selectLobbyProduct(id);} : activate} masthead={host.masthead} footer={host.footer} serverStatusNote={host.serverStatusNote}
      onSite={navigation.selectSite} siteHref={navigation.context === 'lobby' ? host.workspaceLobbyHref ?? host.lobbyHref : undefined}
      lobbyHref={host.workspaceLobbyHref ?? host.lobbyHref} optionsOpen={optionsOpen} settingsOpen={!!settingsScope} settingsCard={settingsScope && workspaceSettingsModel ? <SettingsWorkspace scope={settingsScope} gameTitle={selectedProduct?.title ?? settings?.gameId ?? ''} model={workspaceSettingsModel} effectiveModel={host.settings} actions={host.settingsActions} onOpenTouchLayout={openTouchLayout}/> : undefined}
      filesOpen={filesOpen} filesCard={filesOpen && selectedProduct ? <FilesWorkspace product={selectedProduct.id} language={settings?.language ?? 'ja'} saveLibrary={host.saveLibrary} replays={host.replays} replayActions={host.replayActions} actions={host.settingsActions} hidden={!!settingsScope} assetUrl={host.assetUrl}/> : undefined}
      roomOpen={roomOpen} foregroundActive={navigation.surface === 'touch' || host.runtimeOpen === true} roomDrawer={host.roomDrawer} onBack={navigation.closeSurface} assetUrl={host.assetUrl} siteNoticeLines={host.siteNoticeLines}>
      {roomOpen ? <>{settingsPanel}{host.roomSurface}</> : navigation.context === 'lobby' ? host.renderLobby ? host.renderLobby(lobbyProps) : <LobbySurface {...lobbyProps}/> : optionsOpen && selectedProduct ? <GameWorkspace saveLibrary={host.saveLibrary} scores={host.scores} scoreLanguage={settings?.language ?? 'ja'} assetUrl={host.assetUrl} product={selectedProduct} actions={host.optionsActions} renderActions={host.renderWorkspaceActions} multiplayerOnline={host.multiplayerOnline} multiplayerDiagnostics={host.multiplayerDiagnostics}
        multiplayerHref={host.products.some(product => product.gameId === selectedProduct.gameId && product.multiplayer && !product.hidden) ? directoryGameHref(host.workspaceLobbyHref ?? host.lobbyHref, `${selectedProduct.gameId}mp`) : undefined}
        onFiles={() => navigation.openInfoDialog('scoreFilesDialog')} onSettings={() => navigation.openWorkspaceSettings('game')}/> : null}
    </LibrarySurface>
    <PlayerSurface preview={host.bootTouchPreview} previewImage={host.bootTouchPreviewImage} onElement={setPlayerElement} onFrame={host.runtimeFrame} open={navigation.surface === 'touch' || host.runtimeOpen === true} editing={navigation.surface === 'touch'}>{host.runtimeControls}</PlayerSurface>
    {editor}{host.overlays}
  </OptionsOwnership>;
}
