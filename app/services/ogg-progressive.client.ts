/** Same two-track startup barrier as the existing launcher. This job acquires
 * Package bytes; RuntimeService remains the only writer and lease owner. */
import {RELEASE_CATALOG_FILE} from '../../src/contracts/release-catalog.mts';
import type {InstalledPackageGeneration} from '../../src/contracts/package-read-models.mts';
import {publishedDependencies, canonicalPublishedGeneration, acquirePublishedGeneration, loadPublishedCatalog, type ResolvedPublishedGame, type Th06SampleOptions} from './sample-launch.client';
import type {RuntimeSnapshot} from './runtime.client';
export interface PreparedOggSeed {epoch: number; resolved: ResolvedPublishedGame; fileIds: readonly string[]}
export interface OggRuntimePort {
  getSnapshot(): Pick<RuntimeSnapshot,'epoch'|'game'|'phase'|'launched'>;
  subscribe(listener: () => void): () => void;
  extendOggResources(epoch: number, generation: InstalledPackageGeneration, ids: readonly string[]): Promise<void>;
}
export interface ProgressiveOggSnapshot {
  readonly epoch: number | null;
  readonly game: string | null;
  readonly phase: 'idle'|'waiting'|'installing'|'complete'|'error'|'cancelled';
  readonly completed: number;
  readonly total: number;
  readonly error: string | null;
}
export function createProgressiveOggController(options: Th06SampleOptions & {runtime: OggRuntimePort}) {
  const deps=publishedDependencies(options), runtime=options.runtime, listeners=new Set<()=>void>();
  let snapshot:ProgressiveOggSnapshot=Object.freeze({epoch:null,game:null,phase:'idle',completed:0,total:0,error:null});
  let seed:PreparedOggSeed|null=null, controller:AbortController|null=null, disposed=false;
  let task:Promise<void>|null=null, serial=0, nextIndex=2;
  function update(patch:Partial<ProgressiveOggSnapshot>){if(disposed)return;snapshot=Object.freeze({...snapshot,...patch});for(const fn of listeners)fn();}
  function active(value:PreparedOggSeed){const live=runtime.getSnapshot();return !disposed && live.epoch===value.epoch && live.game===value.resolved.game && live.launched && live.phase==='running';}
  function cancel(){serial++;controller?.abort();controller=null;task=null;seed=null;update({phase:'cancelled'});}
  function start(retry=false){
    if(!seed||task||!active(seed)||snapshot.phase==='complete'||snapshot.phase==='cancelled'||snapshot.phase==='error'&&!retry)return;
    const value=seed,ticket=serial,abort=new AbortController();controller=abort;
    const assert=()=>{if(ticket!==serial||abort.signal.aborted||!active(value))throw new DOMException('OGG acquisition cancelled','AbortError');};
    const original=structuredClone(value.resolved.descriptor);
    let generation=value.resolved.generation!;
    update({phase:'installing',error:null});
    const pending=(async()=>{
      for(;nextIndex<value.fileIds.length;nextIndex++){
        assert();const id=value.fileIds[nextIndex],current=await deps.readCurrent(value.resolved.game);assert();
        if(current.installation?.currentGeneration!==generation.id||current.generation?.id!==generation.id||current.generation.descriptor.revision!==original.revision)throw new Error('Package changed during background OGG preparation; refresh resources before retrying');
        if(!generation.files[id]?.objectId){
          if (!value.resolved.development) value.resolved.catalog ??= await loadPublishedCatalog({...options, signal: abort.signal}, value.resolved.baseUrl);
          if(!value.resolved.development && (!value.resolved.catalog||value.resolved.catalog.games[value.resolved.game]?.revision!==original.revision))throw new Error('No matching published OGG resource remains available');
          const developmentGeneration = value.resolved.development ? await acquirePublishedGeneration({...options, signal: abort.signal}, {...value.resolved, generation}, [id]) : null;
          const result=developmentGeneration ? {generation: developmentGeneration, installation: {currentGeneration: developmentGeneration.id}} : await deps.install(value.resolved.game,{catalog:value.resolved.catalog!,catalogUrl:new URL(RELEASE_CATALOG_FILE,options.baseUrl).href,
            addFileIds:[id],addComponents:[],preserveLocalSource:true,expectedGenerationId:generation.id,expectedCurrentRevision:original.revision,
            expectedFileDeclarations:Object.fromEntries([...original.base.files,id].map(fileId=>[fileId,original.files[fileId]])),
            signal:abort.signal,fetchImpl:options.fetchImpl});
          assert();const next=result.generation;
          if(!next||result.installation.currentGeneration!==next.id||next.descriptor.revision!==original.revision||[...original.base.files,id].some(fileId=>
            ['revision','source','target','bytes','sha256'].some(key=>next.descriptor.files[fileId]?.[key]!==original.files[fileId]?.[key])))throw new Error('Published OGG identity changed during acquisition');
          canonicalPublishedGeneration(next,value.resolved.host,value.resolved.game);generation=next;
          value.resolved.generation=next;
        }
        assert();await runtime.extendOggResources(value.epoch,generation,[id]);assert();
        update({completed:nextIndex+1});
      }
      update({phase:'complete',error:null});
    })().catch(error=>{
      if(ticket!==serial||disposed)return;
      update({phase:abort.signal.aborted||!active(value)?'cancelled':'error',error:abort.signal.aborted||!active(value)?null:error instanceof Error?error.message:String(error)});
    }).finally(()=>{if(task===pending){task=null;controller=null;}});
    task=pending;
  }
  const unsubscribe=runtime.subscribe(()=>{
    if(!seed)return;const live=runtime.getSnapshot();
    if(live.epoch!==seed.epoch||['idle','saving','error','exited'].includes(live.phase)){cancel();return;}
    if(live.phase==='running')start();
  });
  return Object.freeze({
    arm(input:PreparedOggSeed){cancel();seed=structuredClone(input);nextIndex=2;
      update({epoch:seed.epoch,game:seed.resolved.game,phase:seed.fileIds.length>2?'waiting':'complete',completed:Math.min(2,seed.fileIds.length),total:seed.fileIds.length,error:null});
      const live=runtime.getSnapshot();if(live.epoch!==seed.epoch){cancel();return;}if(seed.fileIds.length>2)start();
    },
    retry(){if(seed&&snapshot.phase==='error')start(true);},cancel,
    getSnapshot:()=>snapshot,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
    dispose(){if(disposed)return;cancel();disposed=true;unsubscribe();listeners.clear();},
  });
}
