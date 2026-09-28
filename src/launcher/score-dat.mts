// DAT decoding adapted from ThScoreFileConverter, Copyright IIHOSHI Yoshinori.
// BSD-2-Clause: third_party/score-format/LICENSE.txt.
export type ScoreCell = string | number;
export interface ScoreSection { title: string; columns: string[]; rows: ScoreCell[][]; note?: string }
export interface ScoreReport { game: string; sections: ScoreSection[]; highest: number | null; rankingCount: number; spells: number; notes: string[] }
const MAX = 2_000_000;
const text = (b: Uint8Array) => new TextDecoder('shift-jis').decode(b).split('\0')[0].trim();
const ascii = (b: Uint8Array) => String.fromCharCode(...b);
class Reader {
  view: DataView;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) { this.b=b; this.view = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  u8(o: number) { if (o < 0 || o >= this.b.length) throw Error('DAT 记录不完整'); return this.b[o]; }
  u16(o: number) { return this.view.getUint16(o, true); }
  u32(o: number) { return this.view.getUint32(o, true); }
  f32(o: number) { const n = this.view.getFloat32(o, true); return Number.isFinite(n) ? n.toFixed(3) + '%' : '未知'; }
  str(o: number, n: number) { if (o+n>this.b.length) throw Error('DAT 记录不完整'); return text(this.b.subarray(o,o+n)); }
}
function crypt(data: Uint8Array, key: number, step: number, block: number, limit: number) {
  let size=data.length, extra=size%block;
  if(extra>=block/4) extra=0;
  extra+=size%2; size-=extra;
  const out=new Uint8Array(data); let pos=0;
  while(size>0 && limit>0) {
    block=Math.min(block,size); let i=0;
    for(let j=0;j<2;j++) for(let dst=block-j-1;dst>=0;dst-=2) {
      out[pos+dst]=data[pos+i++]^key; key=(key+step)&255;
    }
    pos+=block; limit-=block; size-=block;
  }
  return out;
}
function unpack(data: Uint8Array, expected: number) {
  if(expected<0 || expected>MAX) throw Error('DAT 展开大小异常');
  let bit=0,di=1,len=0; const dict=new Uint8Array(8192),out=new Uint8Array(expected);
  const bits=(n:number) => { let v=0; for(let i=0;i<n;i++) {
    if(bit>=data.length*8) throw Error('DAT 压缩数据不完整');
    v=(v<<1)|((data[bit>>3]>>(7-bit%8))&1); bit++;
  } return v; };
  const put=(v:number) => { if(len>=expected) throw Error('DAT 展开大小异常'); out[len++]=v;dict[di]=v;di=(di+1)&8191; };
  while(len<expected) { if(bits(1)) put(bits(8)); else {const off=bits(13);if(!off)break;const n=bits(4)+3;for(let i=0;i<n;i++)put(dict[(off+i)&8191]);} }
  if(len!==expected) throw Error('DAT 长度校验失败');
  return out;
}
function decode(game: number, original: Uint8Array) {
  if(original.length<24 || original.length>MAX) throw Error('DAT 文件大小无效');
  let d=new Uint8Array(original),r=new Reader(d);
  if(game===10) {
    if(ascii(d.subarray(0,4))!=='TH10'||r.u32(4)!==d.length) throw Error('不是风神录 DAT 文件');
    return unpack(crypt(d.subarray(24),0xac,0x35,16,d.length-24),r.u32(20));
  }
  if(game===8)d=crypt(d,0x59,0x79,256,3072);
  if(game===9)d=crypt(d,0x3a,0xcd,256,3072);
  let t=0;
  for(let i=2;i<d.length;i++){t=(t+d[i-1])&255;t=((t>>5)|(t<<3))&255;d[i]^=t;}
  r=new Reader(d);
  if((d.subarray(4).reduce((a,b)=>a+b,0)&65535)!==r.u16(2))throw Error('DAT 校验失败，文件可能损坏或作品不匹配');
  const h=r.u32(8),expected=r.u32(game===9?12:16);
  if(h<20||h>d.length||expected<h||expected>MAX)throw Error('DAT 文件头无效');
  const body=game===6?d.subarray(h):unpack(d.subarray(h),expected-h);
  if(body.length+h!==expected||ascii(body.subarray(0,4))!==`TH${game}K`)throw Error('DAT 与当前作品不匹配');
  return body;
}
const chars: Record<number,string[]>={
  6:['灵梦 A','灵梦 B','魔理沙 A','魔理沙 B'],
  7:['灵梦 A','灵梦 B','魔理沙 A','魔理沙 B','咲夜 A','咲夜 B'],
  8:['结界组','咏唱组','红魔组','幽冥组','灵梦','紫','魔理沙','爱丽丝','咲夜','蕾米莉亚','妖梦','幽幽子'],
  9:['灵梦','魔理沙','咲夜','妖梦','铃仙','琪露诺','莉莉卡','米斯蒂娅','帝','幽香','文','梅蒂欣','小町','映姬','梅露兰','露娜萨'],
  10:['灵梦 A','灵梦 B','灵梦 C','魔理沙 A','魔理沙 B','魔理沙 C'],
};
const character=(g:number,n:number)=>chars[g][n]??(n===chars[g].length?'合计':`机体 ${n}`);
const difficulty=(g:number,n:number)=>['Easy','Normal','Hard','Lunatic','Extra',g===8?'Last Word':'Phantasm','合计'][n]??`难度 ${n}`;
const stage8=['1','2','3','4A','4B','5','6A','6B','Extra'];
const stage=(g:number,n:number)=>g===8?(stage8[n]??String(n)):(['1','2','3','4','5','6','Extra','Phantasm'][n]??String(n));
const progress=(g:number,n:number)=>n===(g===10?8:99)?'已通关':g===8?stage(g,n):n===0?'未记录':stage(g,n-1);
const flags8=(n:number)=>[...stage8.filter((_,i)=>n&(1<<i)),...(n&0x8000?['全部开放']:[]),...(n&0x4000?['附加标记 0x4000']:[])].join(' / ')||'未开放';
export const scoreDuration=(seconds:number)=>{const minutes=Math.max(0,Math.floor(seconds/60));return `${Math.floor(minutes/60)} 小时 ${minutes%60} 分钟`;};
const time=(r:Reader,o:number)=>scoreDuration(r.u32(o)*3600+r.u32(o+4)*60+r.u32(o+8));
export function parseScoreDat(gameId: string, bytes: Uint8Array): ScoreReport {
  const g=Number(gameId.replace(/^th/,''));if(!chars[g])throw Error('暂不支持此作品的 DAT 格式');
  const body=decode(g,bytes), report:ScoreReport={game:gameId,sections:[],highest:null,rankingCount:0,spells:0,notes:[]};
  const section=(title:string,columns:string[],note?:string)=>{let s=report.sections.find(s=>s.title===title);if(!s){s={title,columns,rows:[],note};report.sections.push(s);}return s.rows;};
  const ranking=(row:ScoreCell[],score:number)=>{section('排行榜',['机体','难度','分数','进度／名次','名字','日期','续关','处理落率'],'包含存档中的默认排行槽位，不代表实际游玩局数。').push(row);report.rankingCount++;report.highest=Math.max(report.highest??0,score);};
  const bgm=(r:Reader,o:number,n:number)=>{for(let i=0;i<n;i++)section('音乐解锁',['曲目','状态']).push([`BGM ${String(i+1).padStart(2,'0')}`,r.u8(o+i)?'已开放':'未开放']);};
  let pos=0, blocks=0;
  while(pos<body.length) {
    if(++blocks>4096)throw Error("DAT 记录数量异常");
    const header=new Reader(body.subarray(pos)),sig=ascii(body.subarray(pos,pos+(g===10?2:4))),size=g===10?header.u32(8):header.u16(4),head=g===10?12:8;
    if(size<head||pos+size>body.length)throw Error('DAT 记录块越界');
    if(g===10&&body.subarray(pos+8,pos+size).reduce((a,b)=>a+b,0)!==header.u32(4))throw Error('DAT 记录块校验失败');
    const r=new Reader(body.subarray(pos+head,pos+size));pos+=size;
    if(sig==='HSCR') {
      const c=r.u8(g===6?8:12),d=r.u8(g===6?9:13),cont=g===6?0:g===9?r.u8(35):r.u16(30);
      const score=r.u32(4)*(g===6?1:10)+cont;
      ranking([character(g,c),difficulty(g,d),score,g===9?r.u16(14):progress(g,r.u8(g===6?10:14)),r.str(g===6?11:g===9?16:15,9),g===6?'未记录':r.str(g===9?25:24,g===9?9:6),g===6?'未记录':cont,g===6||g===9?'未记录':r.f32(8)],score);
      if(g===8) section('单局详细统计',['名字','难度','人数','游玩帧数','点道具','Miss','Bomb','Last Spell','暂停','刻符','人妖率（原值）']).push([r.str(15,9),difficulty(g,d),r.u8(60),r.u32(92),r.u32(96),r.u32(104),r.u32(108),r.u32(112),r.u32(116),r.u32(120),r.u32(124)]);
    } else if(sig==='CLRD') {
      const n=g===7?6:5,c=g===8?r.u8(25):g===6?r.u16(14):r.u32(16);
      for(let i=0;i<n;i++)section('通关与关卡进度',['机体','难度','主线','练习']).push([character(g,c),difficulty(g,i),g===8?flags8(r.u16(4+i*2)):progress(g,r.u8(4+i)),g===8?flags8(r.u16(14+i*2)):progress(g,r.u8(4+n+i))]);
    } else if(sig==='PSCR') {
      const rows=section('单关练习',['机体','难度','关卡','最高分','次数']);
      if(g===8){const c=r.u8(364);for(let i=0;i<45;i++)rows.push([character(g,c),difficulty(g,i%5),stage(g,Math.floor(i/5)),r.u32(184+i*4)*10,r.u32(4+i*4)]);}
      else rows.push([character(g,r.u8(g===6?8:12)),difficulty(g,r.u8(g===6?9:13)),stage(g,r.u8(g===6?10:14)),r.u32(g===6?4:8)*(g===6?1:10),g===6?'未记录':r.u32(4)]);
    } else if(sig==='PLST') {
      section('时间与存档',['项目','记录']).push(['程序运行时间',time(r,4)],['游玩时间'+(g===9?'（字段含义待确认）':''),time(r,20)]);
      if(g===9) {
        bgm(r,36,19);
        for(let c=0;c<16;c++) {
          section('通关与关卡进度',['角色','对战开放','主线标记','Extra 标记']).push([character(g,c),r.u8(68+c)?'已开放':'未开放',r.u8(84+c),r.u8(100+c)]);
          for(let d=0;d<5;d++)section('通关次数',['角色','难度','次数']).push([character(g,c),difficulty(g,d),r.u32(116+c*24+d*4)]);
        }
        report.notes.push('花映冢的游玩时间字段含义尚未确认，保留原值供参考。');
      } else {
        const nc=g===7?6:12,stride=(nc+5)*4;
        for(let d=0;d<7;d++) {
          const o=36+d*stride;
          section('游玩次数',['难度','开局','重试','通关','续关','练习']).push([difficulty(g,d),r.u32(o),g===7?r.u32(o+(nc+1)*4):'未记录',r.u32(o+(nc+2)*4),r.u32(o+(nc+3)*4),r.u32(o+(nc+4)*4)]);
          for(let c=0;c<nc;c++)section('各机体开局次数',['机体','难度','次数']).push([character(g,c),difficulty(g,d),r.u32(o+4+c*4)]);
        }
        if(g===8)bgm(r,512,21);
      }
    } else if(sig==='LSNM')section('时间与存档',['项目','记录']).push(['最近名字',r.str(4,r.b.length-4)||'未填写']);
    else if(sig==='VRSM')section('时间与存档',['项目','记录']).push(['游戏版本',r.str(4,6)||'未记录']);
    else if(sig==='CATK') {
      report.spells++;
      // Aggregate careers only: no individual spell names, descriptions or enemy names.
      const add=(mode:string,c:number,trials:number,captures:number)=>{
        const rows=section('符卡汇总',['模式','机体','挑战次数','取得次数']);
        let row=rows.find(row=>row[0]===mode&&row[1]===character(g,c));
        if(!row){row=[mode,character(g,c),0,0];rows.push(row);}row[2]=Number(row[2])+trials;row[3]=Number(row[3])+captures;
      };
      if(g===6)add('主线',4,r.u16(52),r.u16(54));
      if(g===7)for(let c=0;c<7;c++)add('主线',c,r.u16(84+c*2),r.u16(98+c*2));
      if(g===8)for(const [mode,o] of [['主线',232],['符卡练习',388]] as const)for(let c=0;c<13;c++)add(mode,c,r.u32(o+52+c*4),r.u32(o+104+c*4));
    } else if(sig==='CR'&&g===10) {
      const c=r.u32(0);
      for(let i=0;i<50;i++){const o=4+i*24,score=r.u32(o)*10+r.u8(o+5),stamp=r.u32(o+16);ranking([character(g,c),difficulty(g,Math.floor(i/10)),score,progress(g,r.u8(o+4)),r.str(o+6,10),stamp?new Date(stamp*1000).toISOString().replace('T',' ').slice(0,19)+' UTC':'未记录',r.u8(o+5),r.f32(o+20)],score);}
      section('各机体游玩统计',['机体','开局次数','游玩时间','游玩帧数'],'合计块保留存档原值，不与各机体重复相加。').push([character(g,c),r.u32(1204),scoreDuration(r.u32(1208)/60),r.u32(1208)]);
      for(let d=0;d<5;d++)section('通关次数',['机体','难度','次数']).push([character(g,c),difficulty(g,d),r.u32(1212+d*4)]);
      for(let i=0;i<24;i++){const o=1232+i*8;section('单关练习',['机体','难度','关卡','最高分','通关','开放']).push([character(g,c),difficulty(g,Math.floor(i/6)),stage(g,i%6),r.u32(o)*10,r.u8(o+4)?'是':'否',r.u8(o+5)?'是':'否']);}
      let trials=0,captures=0;for(let i=0;i<110;i++){const o=1424+i*144;captures+=r.u32(o+128);trials+=r.u32(o+132);}
      section('符卡汇总',['模式','机体','挑战次数','取得次数']).push(['主线',character(g,c),trials,captures]);report.spells=110;
    } else if(sig==='ST'&&g===10) {section('时间与存档',['项目','记录']).push(['最近名字',r.str(0,10)||'未填写']);bgm(r,26,18);}
    else if(!/^TH\dK$/.test(sig))report.notes.push(`存在尚未解释的 ${sig} 记录，未推测其内容。`);
  }
  if(!report.rankingCount)report.notes.push('此存档没有普通排行榜记录。');
  return report;
}
