import {useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, multiplayerConfigForProduct} from '../../../src/contracts/product-catalog.mts';
import type {LobbyDirectoryService} from '../../services/lobby-directory';
import {LobbyDialogHeader} from './LobbyDialogHeader';
import {useLocale} from '../../i18n';

export interface DirectoryRoomDialogProps {
  service: LobbyDirectoryService;
  open: boolean;
  onCloseRequest(): void;
  completionContext?: {locationKey: string; parentKey: string | null; href: string};
}
/** Original lobby.html178–188 + lobby.mts634–737. Native selects are deliberate:
 * the original directory installs custom-select only on its header language.
 */
export function DirectoryRoomDialog({service, open, onCloseRequest, completionContext}: DirectoryRoomDialogProps) {
  const {locale, t} = useLocale(), state = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null), code = useRef<HTMLInputElement>(null), lifetimeOpen = useRef(false);
  const submission = useRef<{owner: object; parentKey: string | null | undefined; href?: string} | null>(null);
  const form = state.form, created = form.mode === 'create';
  const policy = form.product ? multiplayerConfigForProduct(form.product) : null;
  const disabled = state.connection !== 'live' || !!state.mine || state.leaving || !state.products.length;
  useLayoutEffect(() => {
    const node = dialog.current; if (!node) return;
    if (open) {
      const opening = !node.open;
      lifetimeOpen.current = true;
      if (opening) node.showModal();
      if (opening && form.mode === 'join') code.current?.focus();
    } else {
      if (node.open) node.close();
      if (lifetimeOpen.current) {
        lifetimeOpen.current = false;
        const pending = submission.current; submission.current = null;
        // Main closes synchronously before leaving its document. In the SPA,
        // only returning to this form's history parent may finish that intent.
        // Parentless restored entries retain the Router's same-address replace
        // fallback; standalone (non-Router) consumers keep the original API.
        const returnedToOwner = !pending || pending.parentKey === undefined || (pending.parentKey === null
          ? pending.href === completionContext?.href : pending.parentKey === completionContext?.locationKey);
        service.formDidClose(pending?.owner, returnedToOwner);
      }
    }
  }, [open, form.mode, service, completionContext?.locationKey, completionContext?.href]);
  useLayoutEffect(() => () => {
    if (dialog.current?.open) dialog.current.close();
    const pending = submission.current; submission.current = null;
    if (pending) service.formDidClose(pending.owner, false);
  }, [service]);
  useLayoutEffect(() => {code.current?.setCustomValidity(form.validationMessage);}, [form.validationMessage]);
  return <dialog ref={dialog} className="lobby-dialog" id="roomDialog" aria-labelledby="dialogTitle" onCancel={event => {event.preventDefault(); onCloseRequest();}}
    onClick={event => {const rect = event.currentTarget.getBoundingClientRect(); if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onCloseRequest();}}>
    <form id="roomForm" onSubmit={event => {
      event.preventDefault();
      const owner = {};
      const result = service.submitForm(owner);
      if (result === 'invalid-code') {code.current?.setCustomValidity(service.getSnapshot().form.validationMessage); code.current?.reportValidity();}
      else if (result === 'close') {submission.current = {owner, parentKey: completionContext?.parentKey, href: completionContext?.href}; onCloseRequest();}
    }}>
      <LobbyDialogHeader titleId="dialogTitle" title={t(created ? 'lobby.create' : 'lobby.byCode')} closeId="closeDialog" closeContent={t('lobby.cancel')} onCloseRequest={onCloseRequest}/>
      <label className="lobby-field"><span>{t('lobby.game')}</span><select id="gameSelect" required value={form.product} onChange={event => {if (isMultiplayerProductId(event.target.value)) service.updateForm({product: event.target.value});}}>{state.products.map(product => {const game = PRODUCT_GAMES[gameIdForProduct(product)]; return <option key={product} value={product}>{locale === 'en' ? game.subtitle : game.title}</option>;})}</select></label>
      <div id="createFields" className="lobby-form-pair" hidden={!created}><label className="lobby-field"><span>{t('lobby.capacity')}</span><select id="capacitySelect" value={form.capacity} onChange={event => service.updateForm({capacity: Number(event.target.value) as 2 | 3})}>{policy?.playerCounts.map(count => <option key={count} value={count}>{t('lobby.playersCount', {count})}</option>)}</select></label><label className="lobby-field"><span>{t('lobby.difficulty')}</span><select id="difficultySelect" value={form.difficulty} onChange={event => service.updateForm({difficulty: Number(event.target.value)})}>{policy?.difficulties.map((name, index) => <option key={index} value={index}>{name}</option>)}</select></label></div>
      <label className="lobby-field" id="codeField" hidden={created}><span>{t('lobby.roomCode')}</span><input ref={code} id="roomCodeInput" type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,8}" minLength={4} maxLength={8} placeholder="0000" required={!created} value={form.code} onChange={event => {event.currentTarget.setCustomValidity(''); service.updateForm({code: event.currentTarget.value});}}/></label>
      <div className="lobby-form-pair" id="policyFields" hidden={!created}><label className="lobby-field"><span>{t('room.visibility')}</span><select id="visibilitySelect" value={form.visibility} onChange={event => service.updateForm({visibility: event.target.value === 'private' ? 'private' : 'public'})}><option value="public">{t('room.public')}</option><option value="private">{t('room.private')}</option></select></label><label className="lobby-field"><span>{t('room.cheatMovement')}</span><select id="cheatSelect" value={form.disableCheatMovement ? '1' : '0'} onChange={event => service.updateForm({disableCheatMovement: event.target.value === '1'})}><option value="0">{t('room.cheatAllowed')}</option><option value="1">{t('room.cheatDisabled')}</option></select></label></div>
      <p className="lobby-form-note" id="formNote">{t(created ? form.visibility === 'private' ? 'room.privateHint' : 'lobby.publicRoom' : 'lobby.codeHint')}</p><p className="lobby-form-error" id="formError" role="alert" hidden/>
      <button className="lobby-button lobby-primary lobby-submit" id="submitRoom" type="submit" disabled={disabled}>{t(created ? 'lobby.create' : 'lobby.joinRoom')}</button>
    </form>
  </dialog>;
}
