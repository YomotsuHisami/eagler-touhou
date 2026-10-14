import {useEffect, useRef, useState} from 'react';
import {useLocale} from '../../i18n';
import type {LauncherMastheadProps} from './LauncherMasthead';
import {grass1337CreditHref} from './SiteFooter';

type BrandPhase = 'normal' | 'hide-status' | 'show-visit' | 'hide-visit' | 'restore-status';

/** A temporary subtitle animation; the real update-age owner stays mounted. */
export function MastheadBrand({interactive = true, updatedAge, lessMotion}: Pick<LauncherMastheadProps,'interactive' | 'updatedAge' | 'lessMotion'>) {
  const {t} = useLocale(), clicks = useRef(0), [phase,setPhase] = useState<BrandPhase>('normal');
  useEffect(() => {
    if (!interactive) {clicks.current = 0;setPhase('normal');return;}
    if (phase === 'normal') return;
    const duration = lessMotion || matchMedia('(prefers-reduced-motion:reduce)').matches ? 0 : 280;
    const next: Record<Exclude<BrandPhase,'normal'>,BrandPhase> = {'hide-status':'show-visit','show-visit':'hide-visit','hide-visit':'restore-status','restore-status':'normal'};
    const timer = setTimeout(()=>setPhase(next[phase]),phase === 'show-visit' ? duration + 2000 : duration);
    return () => clearTimeout(timer);
  }, [phase,interactive,lessMotion]);
  const normal = phase === 'normal' || phase === 'restore-status';
  return <div className="brand" data-brand-phase={phase}>
    <button className="brand-logo" type="button" aria-label="EAGLER TOUHOU" disabled={!interactive} onClick={()=>{
      if (phase !== 'normal') return;
      if (++clicks.current === 10) {clicks.current = 0;setPhase('hide-status');}
    }}><span className="brand-eagler"><span className="brand-title">EAGLER</span></span><span className="brand-separator" aria-hidden="true"><span className="brand-yinyang">☯</span></span><span className="brand-title">TOUHOU</span></button>
    <span className="brand-subtitle" aria-live="polite">
      <time className="brand-version" id="brandUpdateAge" aria-hidden={!normal} title={updatedAge?.title} dateTime={updatedAge?.dateTime}>{updatedAge?.text ?? t('brand.noUpdateRecord')}</time>
      <span className="brand-visit" aria-hidden={phase !== 'show-visit'} inert={phase !== 'show-visit'}><a href={grass1337CreditHref} target="_blank" rel="noopener noreferrer">Grass1337</a><span>{t('brand.visitSuffix')}</span></span>
    </span>
  </div>;
}
