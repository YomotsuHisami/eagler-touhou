import type {RuntimeMidiSynth} from './runtime.client';
type MidiHost=Window&{WebAudioTinySynth?:new(options:{quality:number;useReverb:number;voices:number})=>RuntimeMidiSynth};
let loading:Promise<void>|null=null;
/** The same vendored synthesizer used by the existing launcher; loaded only on demand. */
export async function loadMidiSynth():Promise<RuntimeMidiSynth>{
 const host=window as MidiHost;
 if(!host.WebAudioTinySynth){
  loading??=new Promise<void>((resolve,reject)=>{
   const script=document.createElement('script');script.src=new URL('/vendor/webaudio-tinysynth.min.js',location.href).href;script.async=true;
   const timer=setTimeout(()=>{script.remove();loading=null;reject(Error('MIDI 合成器读取超时'));},15000);
   script.onload=()=>{clearTimeout(timer);host.WebAudioTinySynth?resolve():reject(Error('MIDI 合成器不可用'));};
   script.onerror=()=>{clearTimeout(timer);script.remove();loading=null;reject(Error('MIDI 合成器读取失败'));};document.head.append(script);
  });
  await loading;
 }
 if(!host.WebAudioTinySynth)throw Error('MIDI 合成器不可用');
 return new host.WebAudioTinySynth({quality:1,useReverb:1,voices:64});
}
