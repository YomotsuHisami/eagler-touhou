/** Synthetic score bytes only; never imports private player saves. */
function block(tag,payload){const b=Buffer.alloc(8+payload.length);b.write(tag);b.writeUInt16LE(b.length,4);payload.copy(b,8);return b;}
function literals(bytes){const out=[];let current=0,bits=0;const bit=b=>{current=(current<<1)|b;if(++bits===8){out.push(current);current=bits=0;}};for(const b of bytes){bit(1);for(let i=7;i>=0;i--)bit((b>>i)&1);}if(bits)out.push(current<<(8-bits));return Buffer.from(out);}
function outerCipher(bytes,key,step,block,limit){const out=Buffer.from(bytes);let size=bytes.length,extra=size%block;if(extra>=block/4)extra=0;extra+=size%2;size-=extra;let pos=0;while(size>0&&limit>0){block=Math.min(block,size);let i=0;for(let j=0;j<2;j++)for(let dst=block-j-1;dst>=0;dst-=2){out[pos+i++]=bytes[pos+dst]^key;key=(key+step)&255;}pos+=block;size-=block;limit-=block;}return out;}
function encode(game,body){
  if(game===10){const compressed=literals(body), b=Buffer.alloc(24+compressed.length);b.write('TH10');b.writeUInt32LE(b.length,4);b.writeUInt32LE(body.length,20);outerCipher(compressed,0xac,0x35,16,compressed.length).copy(b,24);return b;}
  const encoded=game===6?body:literals(body), plain=Buffer.alloc(20+encoded.length);plain.writeUInt32LE(20,8);plain.writeUInt32LE(20+body.length,game===9?12:16);encoded.copy(plain,20);plain.writeUInt16LE(plain.subarray(4).reduce((n,b)=>n+b,0)&65535,2);
  const out=Buffer.from(plain);let key=0;for(let i=2;i<plain.length;i++){key=(key+plain[i-1])&255;key=((key>>5)|(key<<3))&255;out[i]=plain[i]^key;}
  return game===8?outerCipher(out,0x59,0x79,256,3072):game===9?outerCipher(out,0x3a,0xcd,256,3072):out;
}
export function score6(name='PLAYER'){const payload=Buffer.alloc(20);payload.writeUInt32LE(1);payload.writeUInt32LE(98765430,4);payload[8]=2;payload[9]=1;payload[10]=99;payload.write(name,11,9,'ascii');return encode(6,Buffer.concat([block('TH6K',Buffer.from([16,0,0,0])),block('HSCR',payload)]));}
