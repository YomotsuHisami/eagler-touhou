/** Shared presentation-only cover accent, sampled once per decoded source. */
const accents = new Map<string,string>();
export function accentFromPixels(pixels: ArrayLike<number>): string {
  const bins = Array.from({ length:24 },()=>({weight:0,x:0,y:0}));
  for(let i=0;i+3<pixels.length;i+=4){
    const r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255;
    const high=Math.max(r,g,b),low=Math.min(r,g,b),chroma=high-low;
    if(pixels[i+3]<128||chroma<.12||high<.18)continue;
    let hue=high===r?(g-b)/chroma:high===g?(b-r)/chroma+2:(r-g)/chroma+4;
    hue=(hue*60+360)%360;
    const bin=bins[Math.floor(hue/15)],weight=chroma*Math.sqrt(high);
    bin.weight+=weight;bin.x+=Math.cos(hue*Math.PI/180)*weight;bin.y+=Math.sin(hue*Math.PI/180)*weight;
  }
  const dominant=bins.reduce((best,bin)=>bin.weight>best.weight?bin:best);
  const hue=(Math.atan2(dominant.y,dominant.x)*180/Math.PI+360)%360;
  return dominant.weight?`hsl(${Math.round(hue)} 62% 78%)`:'#d0cbc3';
}
export function decodedCoverAccent(image: HTMLImageElement): string | null {
  if(!image.naturalWidth)return null;
  const source=image.currentSrc||image.src;
  const cached=accents.get(source);if(cached)return cached;
  try{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;
    context.drawImage(image,0,0,32,32);
    const accent=accentFromPixels(context.getImageData(0,0,32,32).data);
    accents.set(source,accent);return accent;
  }catch{return null;}
}
