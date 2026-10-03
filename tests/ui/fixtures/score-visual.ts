/** Entirely synthetic, parser-valid DATs. No retail game or user save bytes. */
import {Buffer} from 'node:buffer';
export type ScoreVisualGame = 'th07' | 'th08';
export interface ScoreVisualFixture {
  game: ScoreVisualGame;
  title: string;
  name: string;
  bytes: Buffer;
  highest: number;
  favorite: string;
  count: number;
  portraits: readonly string[];
}
function block(tag: string, payload: Buffer) {
  const bytes=Buffer.alloc(8+payload.length);
  bytes.write(tag);bytes.writeUInt16LE(bytes.length,4);payload.copy(bytes,8);
  return bytes;
}
/** The existing decoder accepts a literal-only stream: one marker plus 8 bits. */
function literalStream(data: Buffer) {
  const bytes=Buffer.alloc(Math.ceil(data.length*9/8));let bit=0;
  for(const byte of data)for(let index=8;index>=0;index--){
    const value=index===8?1:(byte>>index)&1;
    bytes[bit>>3]|=value<<(7-bit%8);bit++;
  }
  return bytes;
}
function envelope(body: Buffer) {
  const packed=literalStream(body),plain=Buffer.alloc(20+packed.length);
  plain.writeUInt32LE(20,8);plain.writeUInt32LE(20+body.length,16);packed.copy(plain,20);
  plain.writeUInt16LE(plain.subarray(4).reduce((sum,value)=>sum+value,0)&65535,2);
  const bytes=Buffer.from(plain);let key=0;
  for(let index=2;index<plain.length;index++){
    key=(key+plain[index-1])&255;key=((key>>5)|(key<<3))&255;bytes[index]=plain[index]^key;
  }
  return bytes;
}
/** Inverse of the shared TH08 permutation/XOR decoder, never borrowed save data. */
function encryptTh08(plain: Buffer) {
  let key=0x59,blockSize=256,limit=3072,size=plain.length,extra=size%blockSize;
  if(extra>=blockSize/4)extra=0;
  extra+=size%2;size-=extra;
  const bytes=Buffer.from(plain);let position=0;
  while(size>0&&limit>0){
    blockSize=Math.min(blockSize,size);let index=0;
    for(let lane=0;lane<2;lane++)for(let destination=blockSize-lane-1;destination>=0;destination-=2){
      bytes[position+index++]=plain[position+destination]^key;key=(key+0x79)&255;
    }
    position+=blockSize;limit-=blockSize;size-=blockSize;
  }
  return bytes;
}
export function createScoreVisualFixture(game: ScoreVisualGame): ScoreVisualFixture {
  const paired=game==='th08',number=paired?8:7,character=paired?1:0;
  const high=Buffer.alloc(paired?128:36);
  high.writeUInt32LE(9_876_543,4);high[12]=character;high[13]=1;high[14]=99;
  high.write('FIXTURE',15);high.write('261003',24);
  const characterCount=paired?12:6,stride=(characterCount+5)*4;
  const plays=Buffer.alloc(paired?536:344);
  // Normal difficulty and overall total each record 48 starts for one loadout.
  // favoriteLoadout deliberately uses only the total, never ranking counts.
  for(const difficulty of [1,6]){
    const offset=36+difficulty*stride;
    plays.writeUInt32LE(48,offset);plays.writeUInt32LE(48,offset+4+character*4);
  }
  const encoded=envelope(Buffer.concat([block(`TH${number}K`,Buffer.from([16,0,0,0])),block('HSCR',high),block('PLST',plays)]));
  return {game,title:paired?'東方永夜抄':'東方妖々夢',name:`synthetic-${game}-visual.dat`,bytes:paired?encryptTh08(encoded):encoded,
    highest:98_765_430,favorite:paired?'咏唱组':'灵梦 A',count:48,portraits:paired?['marisa','alice']:['reimu']};
}
