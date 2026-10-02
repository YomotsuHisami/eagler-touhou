// Experimental measured timing result, not a new source of gameplay authority.
// The native peers agree before frame zero; Launcher/relay only mirror it.
export interface MeasuredNetplayTiming {
  phase: "ready";
  automatic: boolean;
  adonisMode: 1 | 2;
  inputDelay: number;
  fullDelay: number;
  predictionReserve: number;
  rttP95Us: number;
  samples: number;
  lost: number;
  route: "rtc" | "relay" | "spectator";
}
export function parseMeasuredNetplayTiming(value: unknown): MeasuredNetplayTiming | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v=value as Record<string, unknown>;
  const integer=(key:string,min:number,max:number)=>typeof v[key]==="number" && Number.isInteger(v[key]) && v[key]>=min && v[key]<=max;
  if(v.phase!=="ready" || typeof v.automatic!=="boolean" || (v.adonisMode!==1&&v.adonisMode!==2) ||
     !integer("inputDelay",0,9) || !integer("fullDelay",1,31) || !integer("predictionReserve",0,2) ||
     !integer("rttP95Us",1,1_000_000) || !integer("samples",96,120) || !integer("lost",0,48) ||
     !["rtc","relay","spectator"].includes(String(v.route)))return null;
  const fullDelay=v.fullDelay as number,predictionReserve=v.predictionReserve as number;
  if(fullDelay!==Math.ceil((v.rttP95Us as number)*60/2_000_000)+1 ||
     (v.adonisMode===1?predictionReserve!==0:predictionReserve<1) ||
     (v.automatic && v.inputDelay!==Math.max(0,fullDelay-predictionReserve)))return null;
  return {phase:"ready",automatic:v.automatic,adonisMode:v.adonisMode,inputDelay:v.inputDelay as number,
    fullDelay,predictionReserve,rttP95Us:v.rttP95Us as number,samples:v.samples as number,
    lost:v.lost as number,route:v.route as MeasuredNetplayTiming["route"]};
}
