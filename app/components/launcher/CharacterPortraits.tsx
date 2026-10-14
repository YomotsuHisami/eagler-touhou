import {useState} from 'react';
import {CHARACTER_ART, type CharacterArtId} from '../../../src/contracts/character-art.mts';
import {useLocale} from '../../i18n';
import {scoreText} from './score-copy';

export function CharacterPortraits({characters, assetUrl, label}: {label?: string; characters: readonly CharacterArtId[]; assetUrl(path: string): string}) {
  const {t} = useLocale();
  if (!characters.length) return null;
  return <figure className="score-character" data-count={characters.length} aria-label={label ?? t('scores.portraits')}>
    {characters.map(id => <Portrait key={id} id={id} src={assetUrl(`assets/dairi/${id}.png`)}/>)}
    <figcaption>{label && <span>{label} · </span>}<a href={assetUrl('assets/dairi/CREDITS.txt')} target="_blank" rel="noopener noreferrer">DAIRI / はるか</a></figcaption>
  </figure>;
}
function Portrait({id, src}: {id: CharacterArtId; src: string}) {
  const {locale, t} = useLocale();
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const name = scoreText(CHARACTER_ART[id].name, locale);
  return <span className="character-portrait" data-character={id} data-art-state={state}>
    {state !== 'missing' && <img src={src} alt={name} decoding="async" draggable={false} onLoad={() => setState('ready')} onError={() => setState('missing')}/>}
    {state === 'missing' && <span className="character-art-placeholder"><strong>{name}</strong><small>{t('scores.portraitMissing')}</small></span>}
  </span>;
}
