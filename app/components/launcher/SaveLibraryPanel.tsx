import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {gameIdForProduct, PRODUCT_GAMES, type ProductId} from '../../../src/contracts/product-catalog.mts';
import {useLocale} from '../../i18n';
import type {SaveLibraryModel} from '../../models/save-library';
import type {SaveArchive} from '../../services/save-library';
import type {SettingsActions} from '../settings/types';
import {FileActionIcon} from './FileActionIcon';

export function SaveLibraryPanel({model, product, language, active, retainSelection = false, actions, assetUrl = path=>path}: {assetUrl?:(path:string)=>string;actions?: SettingsActions;retainSelection?: boolean;model: SaveLibraryModel;product: ProductId;language: string;active: boolean}) {
  const state=useSyncExternalStore(model.subscribe,model.getSnapshot,model.getSnapshot),{locale,t}=useLocale(),input=useRef<HTMLInputElement>(null);
  const [clearing,setClearing]=useState(false),clearTarget=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(active)model.select(product,language);else if(!retainSelection)model.clear(product);return()=>{if(!retainSelection)model.clear(product);};},[model,product,language,active,retainSelection]);
  if(!active||state.product!==product)return null;
  const blocked=clearing||state.busy||state.phase==='loading'||state.phase==='unavailable',unsupported=state.phase==='unsupported',storage=PRODUCT_GAMES[gameIdForProduct(product)].storage;
  const nativeAvailable=unsupported ? !!actions : state.currentPhase==='ready';
  const status=state.error ? t(`saveLibrary.error.${state.error}`) : state.phase==='unavailable' ? t('saveLibrary.error.storage') : '';
  async function clearNative(){if(!actions||clearing)return;setClearing(true);try{await actions.file('clear-save',product);}catch(error){actions.reportError(error);}finally{if(model.getSnapshot().product===product)await model.refresh();setClearing(false);requestAnimationFrame(()=>{if(model.getSnapshot().product!==product)return;const target=clearTarget.current?.isConnected&&!clearTarget.current.disabled ? clearTarget.current : document.querySelector<HTMLButtonElement>('.files-workspace [data-action="import-save"]');target?.focus({preventScroll:true});});}}
  return <section className="save-library file-library" aria-labelledby="saveLibraryTitle" aria-busy={state.busy||state.phase==='loading'||clearing}>
    <div className="file-library-heading"><h2 id="saveLibraryTitle">{t('settings.save')}</h2><button type="button" data-action="import-save" aria-label={t('files.importSave')} disabled={blocked||unsupported&&(!actions||state.runtimeBusy)} onClick={()=>{if(unsupported&&actions)void actions.file('import-save',product).catch(actions.reportError);else input.current?.click();}}>{t('files.import')}</button></div>
    <input ref={input} type="file" accept=".dat" aria-label={t('files.importSave')} hidden disabled={blocked} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void model.importFile(file);}}/>
    <p className="save-library-status" role="status" hidden={!status}>{status}</p>
    {state.phase==='unavailable'&&<button type="button" disabled={state.busy} onClick={()=>{void model.refresh();}}>{t('files.retry')}</button>}
    <div className="file-library-scroll save-library-scroll" tabIndex={0} role="region" aria-label={t('files.saveList')}>
      {state.binding?.run&&!state.runtimeBusy&&<div className="save-recovery" role="status"><p>{t('saveLibrary.recoveryHint')}</p><button type="button" disabled={blocked} onClick={()=>{void model.recover('keep');}}>{t('saveLibrary.keepProgress')}</button><button type="button" disabled={blocked} onClick={()=>{void model.recover('restore');}}>{t('saveLibrary.restoreBefore')}</button></div>}
      <ul className="file-library-list save-library-list">
        <li className={`file-library-row save-library-current${state.binding?.selectedId===null ? ' is-selected':''}`} data-native-save="">
          <strong className="file-library-name">{t('files.nativeSave')}</strong><small className="file-library-size">{state.current ? formatSaveSize(state.current.bytes.length) : '—'}</small>
          <div className="save-library-row-actions">
            {state.current ? <ArchiveDownload entry={{id:'native',product,name:t('files.nativeSave'),filename:storage.scoreFile,bytes:state.current.bytes,created:state.current.modified}} downloadName={storage.scoreFile} action="export-save" disabled={blocked||state.runtimeBusy} assetUrl={assetUrl} fallback={()=>{if(actions)void actions.file('export-save',product).catch(actions.reportError);}}/> : <button className="file-icon-action" type="button" data-action="export-save" disabled={blocked||state.runtimeBusy||!nativeAvailable} aria-label={`${t('files.export')} ${t('files.nativeSave')}`} title={t('files.export')} onClick={()=>{if(actions)void actions.file('export-save',product).catch(actions.reportError);}}><FileActionIcon kind="export" assetUrl={assetUrl}/></button>}
            <button ref={clearTarget} className="file-icon-action file-delete-action" type="button" data-action="clear-save" disabled={blocked||state.runtimeBusy||!nativeAvailable||!actions||!!state.binding?.run} aria-label={t('files.clearNative')} title={t('files.clearNative')} onClick={()=>{void clearNative();}}><FileActionIcon kind="delete" assetUrl={assetUrl}/></button>
          </div>
        </li>
        {state.entries.map(entry=><ArchiveRow key={entry.id} entry={entry} model={model} actions={actions} assetUrl={assetUrl} disabled={blocked} deletable={!blocked&&!state.runtimeBusy&&!state.binding?.run} selected={state.binding?.selectedId===entry.id}/>)}
      </ul>
      {state.binding?.run&&!!state.backups.length&&<details className="save-backups"><summary>{t('saveLibrary.backups',{count:state.backups.length})}</summary>{state.backups.map(backup=><div className="save-backup" key={backup.id}><span>{backup.archiveName} · {new Date(backup.created).toLocaleString(locale)}</span>{backup.bytes!==null&&<ArchiveDownload entry={{id:backup.id,product,name:`backup-${backup.id}`,filename:`${product}.dat`,bytes:backup.bytes,created:backup.created}} downloadLabel={t('saveLibrary.beforeDownload')} disabled={blocked} fallback={()=>model.downloadBackup(backup.id)}/>}<ArchiveDownload entry={{id:backup.id,product,name:`archive-before-${backup.id}`,filename:`${product}.dat`,bytes:backup.archiveBytes,created:backup.created}} downloadLabel={t('saveLibrary.archiveDownload')} disabled={blocked} fallback={()=>model.downloadBackup(backup.id,'archive')}/></div>)}</details>}
      {actions&&'hintFiles' in storage&&storage.hintFiles.length>0&&<div className="file-library-hints"><span>{t('settings.hint')}</span><button type="button" disabled={state.runtimeBusy} data-action="import-hint" onClick={()=>{void actions.file('import-hint',product).catch(actions.reportError);}}>{t('settings.import')}</button><button type="button" disabled={state.runtimeBusy} data-action="delete-hint" onClick={()=>{void actions.file('delete-hint',product).catch(actions.reportError);}}>{t('action.delete')}</button></div>}
    </div>
  </section>;
}
const formatSaveSize=(value:number)=>`${(value/1024).toFixed(1)} KB`;
function ArchiveRow({entry,model,actions,disabled,deletable,selected,assetUrl}:{entry:SaveArchive;model:SaveLibraryModel;actions?:SettingsActions;disabled:boolean;deletable:boolean;selected:boolean;assetUrl:(path:string)=>string}){
  const {t}=useLocale(),[confirming,setConfirming]=useState(false),removeTarget=useRef<HTMLButtonElement>(null);
  async function remove(){if(!actions||!deletable||confirming)return;setConfirming(true);const product=entry.product;try{if(await actions.confirm({message:t('files.deleteArchiveConfirm',{name:entry.name}),confirmText:t('action.delete'),tone:'danger'})&&model.getSnapshot().product===product&&!model.getSnapshot().runtimeBusy)await model.remove(entry.id);}catch(error){actions.reportError(error);}finally{setConfirming(false);requestAnimationFrame(()=>{if(model.getSnapshot().product!==product)return;const target=removeTarget.current?.isConnected&&!removeTarget.current.disabled ? removeTarget.current : document.querySelector<HTMLButtonElement>('.files-workspace [data-action="import-save"]');target?.focus({preventScroll:true});});}}
  return <li className={`file-library-row save-library-entry${selected ? ' is-selected':''}`}>
    <strong className="file-library-name" title={entry.name}>{entry.name}</strong><small className="file-library-size">{formatSaveSize(entry.bytes.length)}</small>
    <div className="save-library-row-actions"><ArchiveDownload entry={entry} disabled={disabled||confirming} fallback={()=>model.download(entry.id)} assetUrl={assetUrl}/><button ref={removeTarget} type="button" className="file-icon-action file-delete-action" disabled={!deletable||!actions||confirming} aria-label={`${t('action.delete')} ${entry.name}`} title={t('action.delete')} onClick={()=>{void remove();}}><FileActionIcon kind="delete" assetUrl={assetUrl}/></button></div>
  </li>;
}
function ArchiveDownload({entry,disabled,fallback,downloadLabel,downloadName,action,assetUrl=path=>path}:{entry:SaveArchive;disabled:boolean;fallback():void;downloadLabel?:string;downloadName?:string;action?:string;assetUrl?:(path:string)=>string}){
  const {t}=useLocale(),[url,setUrl]=useState<string|null>(null);
  useEffect(()=>{let value:string;try{const bytes=new Uint8Array(entry.bytes);value=URL.createObjectURL(new Blob([bytes.buffer],{type:'application/octet-stream'}));}catch{return;}setUrl(value);return()=>URL.revokeObjectURL(value);},[entry.bytes]);
  const text=downloadLabel??t('files.export'),label=`${text} ${entry.name}`,content=downloadLabel??<FileActionIcon kind="export" assetUrl={assetUrl}/>;
  const props={className:`save-library-download${downloadLabel ? '':' file-icon-action'}`,'data-action':action,'aria-label':label,title:text};
  return url ? <a {...props} href={url} download={downloadName??`${entry.product}-${entry.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')}.dat`} aria-disabled={disabled||undefined} tabIndex={disabled ? -1:undefined} onClick={event=>{if(disabled)event.preventDefault();}}>{content}</a> : <button {...props} type="button" disabled={disabled} onClick={fallback}>{content}</button>;
}
