import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {scoreDifficulties, type ScoreReport} from '../../../src/launcher/score-dat.mts';
import {useLocale} from '../../i18n';
import {scoreText} from './score-copy';

export function ClearMatrix({loadouts, report}: {loadouts: readonly string[]; report: ScoreReport | null}) {
  const {t,locale} = useLocale(), [active,setActive] = useState<{row:number|null;column:number|null}|null>(null);
  const [touchRevealed,setTouchRevealed] = useState(false), wrap = useRef<HTMLDivElement>(null), pressType = useRef('');
  useEffect(()=>{
    if(!touchRevealed)return;
    const dismiss=(event:Event)=>{if(!wrap.current?.contains(event.target as Node))setTouchRevealed(false);};
    document.addEventListener('pointerdown',dismiss,true);
    document.addEventListener('focusin',dismiss);
    return()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('focusin',dismiss);};
  },[touchRevealed]);
  const label = (name:string) => locale === 'en' ? scoreText(name,locale) : name.replace(/^灵梦 ([ABC])$/,'梦$1').replace(/^魔理沙 ([ABC])$/,'魔$1').replace(/^咲夜 ([ABC])$/,'咲$1');
  const verticalHeads = locale !== 'en' && loadouts.some(name => label(name).length > 2);
  return <div ref={wrap} className="clear-matrix-wrap" data-revealed={touchRevealed} style={{'--clear-columns':loadouts.length} as CSSProperties}
    onPointerDown={event=>{pressType.current=event.pointerType;}} onPointerCancel={()=>{pressType.current='';}} onClick={()=>{if(pressType.current==='touch'||pressType.current==='pen')setTouchRevealed(true);pressType.current='';}}>
    <table className="clear-matrix" data-vertical-heads={verticalHeads} onPointerLeave={()=>setActive(null)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setActive(null);}}>
      <caption className="visually-hidden">{t('scores.clearMatrix')}</caption>
      <colgroup><col className="clear-axis-column"/>{loadouts.map(name=><col key={name} className="clear-loadout-column"/>)}</colgroup>
      <thead><tr><th scope="col" className="clear-matrix-corner" aria-label={t('lobby.difficulty')}/>{loadouts.map((name,column)=><th key={name} scope="col" tabIndex={0} data-highlight={active?.column===column} data-short={label(name).length<=2} title={scoreText(name,locale)}
        onPointerEnter={event=>{if(event.pointerType==='mouse' && matchMedia('(hover:hover) and (pointer:fine)').matches)setActive({row:null,column});}} onPointerLeave={()=>setActive(null)} onFocus={()=>setActive({row:null,column})}><span className="clear-head-label">{label(name)}</span></th>)}</tr></thead>
      <tbody>{scoreDifficulties.map((difficulty,row)=><tr key={difficulty}>
        <th scope="row" tabIndex={0} data-highlight={active?.row===row}
          onPointerEnter={event=>{if(event.pointerType==='mouse' && matchMedia('(hover:hover) and (pointer:fine)').matches)setActive({row,column:null});}} onPointerLeave={()=>setActive(null)} onFocus={()=>setActive({row,column:null})}>{difficulty}</th>
        {loadouts.map((name,column)=>{
          const cleared=report?.clears[row]?.[column]===true;
          const kind=report?.clearKinds?.[row]?.[column]??(cleared?'unknown':'none');
          const labelKey=kind==='no-continue'?'scores.clearedNoContinue':kind==='continued'?'scores.clearedContinued':kind==='unknown'?'scores.cleared':'scores.clearNotRecorded';
          const description=`${scoreText(name,locale)} · ${difficulty} · ${t(labelKey)}`;
          return <td key={name} tabIndex={0} aria-label={description} title={description} style={{'--clear-column':column} as CSSProperties} data-cleared={cleared} data-clear-kind={kind} data-highlight={active?.row===row||active?.column===column} data-hovered={active?.row===row&&active?.column===column}
            onPointerEnter={event=>{if(event.pointerType==='mouse' && matchMedia('(hover:hover) and (pointer:fine)').matches)setActive({row,column});}} onFocus={()=>setActive({row,column})}>
            <span className="clear-square" aria-hidden="true"/>
          </td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}
