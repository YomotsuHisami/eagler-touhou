import {useLocale} from '../../i18n';
import {useMemo} from 'react';
import type {GameSettingsModel} from '../../models/game-settings';
import type {SettingsScope} from '../../models/scoped-settings';
import {useSurfaceNavigation} from '../../navigation/surface-navigation';
import {SettingsBody} from '../settings/SettingsBody';
import type {SettingsActions} from '../settings/types';

export function SettingsWorkspace({scope, gameTitle, model, effectiveModel, actions, onOpenTouchLayout}: {
  scope: SettingsScope; gameTitle: string; model: GameSettingsModel; effectiveModel: GameSettingsModel; actions: SettingsActions; onOpenTouchLayout(): void;
}) {
  const {t} = useLocale(), navigation = useSurfaceNavigation();
  const scopedActions = useMemo(()=>({...actions,externalMidi:{...actions.externalMidi,async selectOutput(value:string){
    model.setOption('externalMidiDeviceId',value);
    // Apply the effective preference, respecting a game's explicit override.
    await actions.externalMidi.selectOutput(effectiveModel.getSnapshot()?.options.externalMidiDeviceId ?? value);
  }}}),[actions,model,effectiveModel]);
  return <aside className="workspace-panel settings-workspace" id="globalSettingsDialog" data-settings-scope={scope} aria-labelledby="globalSettingsTitle"
    onKeyDown={event=>{if(event.key === 'Escape' && !event.defaultPrevented){event.preventDefault();event.stopPropagation();navigation.closeInfoDialog('globalSettingsDialog');}}}>
    <div className="settings-workspace-heading"><div><h1 id="globalSettingsTitle">{t(scope === 'global' ? 'settings.globalTitle' : 'settings.gameTitle')}</h1>
      <p>{scope === 'global' ? t('settings.globalDescription') : t('settings.gameDescription',{game:gameTitle})}</p></div>
      <button type="button" id="globalSettingsClose" onClick={()=>navigation.closeInfoDialog('globalSettingsDialog')}>{t('action.back')}</button>
    </div>
    <div className="workspace-dialogs workspace-settings-content settings-workspace-content">
      <SettingsBody model={model} actions={scopedActions} sections="settings" expanded onOpenTouchLayout={scope === 'game' ? ()=>navigation.openWorkspaceSettings('global') : onOpenTouchLayout}/>
    </div>
  </aside>;
}
