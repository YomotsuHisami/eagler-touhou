import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMultiplayerProductId } from '../lib/contracts/product-catalog.mjs';

const routes = ['direct', 'turn', 'mixed', 'websocket', 'unknown'];
export function validateSample(value) {
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !/^[a-z0-9-]{16,64}$/i.test(value.id) ||
      !Number.isSafeInteger(value.seq) || value.seq < 1 || value.seq > 1e7 ||
      !isMultiplayerProductId(value.product) || ![2,3].includes(value.players) ||
      !['player','spectator'].includes(value.role) || !routes.includes(value.route) ||
      typeof value.automated !== 'boolean' ||
      !Number.isFinite(value.seconds) || value.seconds < 0 || value.seconds > 90 ||
      !Array.isArray(value.links) || value.links.length > value.players - 1) return null;
  const links = [];
  for (const link of value.links) {
    if (!['direct','turn'].includes(link.path) || !Number.isFinite(link.seconds) || link.seconds !== value.seconds || !link.seconds ||
        ['tx','rx','txPackets','rxPackets'].some(k => !Number.isSafeInteger(link[k]) || link[k] < 0 || link[k] > 1e8)) return null;
    links.push({path:link.path,seconds:link.seconds,tx:link.tx,rx:link.rx,txPackets:link.txPackets,rxPackets:link.rxPackets});
  }
  if ((value.route === 'websocket' || value.role === 'spectator') && links.length) return null;
  if (value.role === 'spectator' && value.route !== 'websocket') return null;
  if (value.seconds > 0 && ['direct','turn','mixed'].includes(value.route)) {
    const paths=new Set(links.map(link=>link.path));
    if (links.length !== value.players-1 || (value.route==='mixed' ? paths.size!==2 : paths.size!==1 || !paths.has(value.route))) return null;
  }
  return {version:1,id:value.id,seq:value.seq,product:value.product,players:value.players,role:value.role,
    automated:value.automated,seconds:value.seconds,route:value.route,links};
}
const blankLink = () => ({seconds:0,tx:0,rx:0,txPackets:0,rxPackets:0});
export function capacityModel(days) {
  let payloadBytesPerSecond=15250,packetsPerSecond=143;
  for(const day of Object.values(days))for(const product of Object.values(day.products))for(const path of ['direct','turn']){
    const link=product[path];if(link.seconds>0){payloadBytesPerSecond=Math.max(payloadBytesPerSecond,link.tx/link.seconds);packetsPerSecond=Math.max(packetsPerSecond,link.txPackets/link.seconds);}
  }
  const headerBytesPerPacket=64,turnHops=2,headroom=1.5;
  const unitMbps=Math.ceil((payloadBytesPerSecond+packetsPerSecond*headerBytesPerPacket)*8/1e6*turnHops*headroom*10)/10;
  return {payloadBytesPerSecond,packetsPerSecond,headerBytesPerPacket,turnHops,headroom,unitMbps,
    basis:'Highest observed per-product average or TH11 baseline. Conservative egress budget per player per opponent, not billed traffic.'};
}
const blank = () => ({samples:0,sessions:0,playerSeconds:0,spectatorSeconds:0,
  routeSeconds:Object.fromEntries(routes.map(r=>[r,0])),direct:blankLink(),turn:blankLink()});
function add(target, value) {
  target.samples += 1;
  target[value.role === 'player' ? 'playerSeconds' : 'spectatorSeconds'] += value.seconds;
  if (value.role === 'player') target.routeSeconds[value.route] += value.seconds;
  for (const link of value.links) for (const key of Object.keys(target[link.path])) target[link.path][key] += link[key];
}
export function createTelemetryStore(initial = {}, clock = Date.now) {
  const days = initial.days ?? {}, sessions = new Map();
  const startedAt = initial.startedAt ?? new Date(clock()).toISOString();
  let revision = 0, savedRevision = 0, pruneAt = 0;
  function accept(raw) {
    const value = validateSample(raw); if (!value) return false;
    const at=clock();if(at>=pruneAt){prune();pruneAt=at+30000;}const old=sessions.get(value.id);
    if (old && (value.seq <= old.seq || at-old.at < 1000 || old.product !== value.product || old.role !== value.role || old.automated!==value.automated)) return false;
    // Never trust a client to add more time than has passed at the collector.
    if (old && value.seconds > (at-old.at)/1000 + 2) return false;
    if (!old && value.seconds > 0) value.seconds=0, value.links=[];
    if (!old && sessions.size >= 20000) return false;
    sessions.set(value.id,{seq:value.seq,at,product:value.product,role:value.role,route:value.route,automated:value.automated});
    const day=new Date(at).toISOString().slice(0,10);
    const entry=days[day]??= {total:blank(),products:{}};
    if(value.automated){const automation=entry.automation??=blank();if(!old)automation.sessions++;add(automation,value);revision++;return true;}
    const product=entry.products[value.product]??=blank();
    if (!old) entry.total.sessions++, product.sessions++;
    add(entry.total,value);add(product,value);revision++;
    return true;
  }
  function prune() {
    const now=clock();for(const [id,s] of sessions)if(now-s.at>180000)sessions.delete(id);
    const cutoff=new Date(now-6*86400000).toISOString().slice(0,10);
    for(const day of Object.keys(days))if(day<cutoff)delete days[day];
  }
  function snapshot() {
    prune(); const now=clock(), active={players:0,spectators:0,routes:Object.fromEntries(routes.map(r=>[r,0]))};
    for(const s of sessions.values())if(!s.automated&&now-s.at<45000){if(s.role==='spectator')active.spectators++;else active.players++,active.routes[s.route]++;}
    return {schema:'eagler-netplay-telemetry/1',startedAt,updatedAt:new Date(now).toISOString(),
      coverage:'New Launcher clients reporting selected ICE pairs. Not a census or unique people count.',active,days,capacity:capacityModel(days)};
  }
  return {accept,snapshot,isDirty:()=>revision!==savedRevision,revision:()=>revision,markSaved:r=>{savedRevision=r;}};
}

function page() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>主站联机线路统计</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:0 20px;background:#11151c;color:#edf2f8}a{color:#8cc9ff}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{padding:12px;text-align:left;border-bottom:1px solid #394354}input,select{font:inherit;padding:7px;background:#202936;color:inherit;border:1px solid #596575}p{line-height:1.7}.muted{color:#b4bfce}</style><h1>主站联机线路统计</h1><p><a href="/lobby.html">返回房间列表</a> · <a href="./summary">下载原始统计</a></p><p id="status">正在读取统计…</p><table><thead><tr><th>线路</th><th>玩家时间占比</th><th>当前上报玩家</th></tr></thead><tbody id="routes"></tbody></table><p id="links"></p><p class="muted">按实际选中的 ICE 候选对采样，每 15 秒上报。三人房间可以同时有直连和 TURN，列为混合。旧版页面、短时连接和未上报客户端不在样本内，自动化测试单独计数。观战单列，WebSocket 回退单列。这里的占比按时间加权，不是按 IP 或独立用户统计。数据只保留 7 天。</p><h2>TURN 带宽估算</h2><p>总人数 <input id="people" type="number" min="1" max="100000" value="1000" style="width:100px">　房间人数 <select id="size"><option value="2">2 人</option><option value="3">3 人</option></select>　TURN 链路占比 <input id="fraction" type="number" min="0" max="100" value="50" style="width:70px"> %</p><p id="estimate"></p><p class="muted">人数包括直连用户。为保守预留，默认全部都是游戏玩家。观战走 WebSocket，实际应从游戏玩家数中扣除并另计 WebSocket 带宽。<span id="basis">初始每人每个对端预留 0.6 Mbps。</span>按各作品实测平均流量的较高值更新预留。样本不足时采用 TH11 基线。加入每包 64 字节开销、双 TURN 路径及 50% 余量。这是容量模型，不是已测到的 TURN 服务器带宽。不含网页、游戏资源和音乐下载。</p><table><thead><tr><th>总在线人数</th><th>TURN 20%</th><th>TURN 50%</th><th>TURN 100%</th></tr></thead><tbody id="capacity"></tbody></table><script>
const statusEl=document.querySelector('#status'),routes=document.querySelector('#routes'),links=document.querySelector('#links'),people=document.querySelector('#people'),size=document.querySelector('#size'),fraction=document.querySelector('#fraction'),capacity=document.querySelector('#capacity');let unitMbps=.6;const labels={direct:'直连',turn:'TURN',mixed:'混合',websocket:'WebSocket 回退',unknown:'尚未确认'};function estimate(){const n=Math.max(0,Number(people.value)),p=Math.min(100,Math.max(0,Number(fraction.value)))/100,k=Number(size.value)-1;const mbps=n*p*k*unitMbps;document.querySelector('#estimate').textContent='保守出口预留：'+mbps.toFixed(1)+' Mbps。进口约同量，双向合计约 '+(mbps*2).toFixed(1)+' Mbps。';capacity.innerHTML=[100,500,1000].map(n=>'<tr><td>'+n+' 人</td>'+[.2,.5,1].map(p=>'<td>'+(n*p*k*unitMbps).toFixed(1)+' Mbps</td>').join('')+'</tr>').join('');}for(const el of [people,size,fraction])el.addEventListener('input',estimate);estimate();
async function refresh(){try{const r=await fetch('./summary',{cache:'no-store'});if(!r.ok)throw Error('统计暂时不可用');const s=await r.json();unitMbps=s.capacity?.unitMbps??.6;document.querySelector('#basis').textContent='当前每人每个对端预留 '+unitMbps.toFixed(1)+' Mbps，流量基线 '+((s.capacity?.payloadBytesPerSecond??15250)/1000).toFixed(1)+' KB/s、'+Math.round(s.capacity?.packetsPerSecond??143)+' 包/s。';estimate();const totals=Object.values(s.days).map(d=>d.total);let time=0,direct=0,turn=0;const routeSeconds=Object.fromEntries(Object.keys(labels).map(k=>[k,0]));for(const t of totals){time+=t.playerSeconds;direct+=t.direct.seconds;turn+=t.turn.seconds;for(const k in routeSeconds)routeSeconds[k]+=t.routeSeconds[k];}statusEl.textContent='统计开始：'+new Date(s.startedAt).toLocaleString()+'。当前上报 '+s.active.players+' 名玩家、'+s.active.spectators+' 名观战者。更新：'+new Date(s.updatedAt).toLocaleString();routes.innerHTML=Object.keys(labels).map(k=>'<tr><td>'+labels[k]+'</td><td>'+(time?(routeSeconds[k]/time*100).toFixed(2)+'%':'暂无样本')+'</td><td>'+s.active.routes[k]+'</td></tr>').join('');links.textContent=direct+turn?'按已确认链路时间加权：直连 '+(direct/(direct+turn)*100).toFixed(2)+'%，TURN '+(turn/(direct+turn)*100).toFixed(2)+'%。三人链路分别计算。':'直连 / TURN 比例正在积累，暂不提供猜测值。';}catch(e){statusEl.textContent=e.message;}}refresh();setInterval(refresh,30000);
</script></html>`;
}
export async function startTelemetryServer({port=18153,host='127.0.0.1',origin,stateFile}={}) {
  let initial={};if(stateFile)try{initial=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const store=createTelemetryStore(initial);
  let rateAt=0,rateCount=0;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='GET'&&req.url==='/netplay-stats/summary'){res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(store.snapshot()));return;}
    if(req.method==='GET'&&req.url==='/netplay-stats/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page());return;}
    if(req.method!=='POST'||req.url!=='/netplay-stats/sample'){res.writeHead(404).end();return;}
    const second=Math.floor(Date.now()/1000);if(second!==rateAt){rateAt=second;rateCount=0;}if(++rateCount>500){res.writeHead(429).end();return;}
    if(req.headers.origin!==origin||req.headers['content-type']!=='application/json'){res.writeHead(403).end();return;}
    let bytes=0,chunks=[];
    try{for await(const chunk of req){bytes+=chunk.length;if(bytes>4096){res.writeHead(413).end();req.destroy();return;}chunks.push(chunk);}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!store.accept(value)){res.writeHead(400).end();return;}res.writeHead(204).end();
    }catch{if(!res.headersSent)res.writeHead(400).end();}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;
  async function persist(){if(!stateFile||!store.isDirty())return;const revision=store.revision(),data=JSON.stringify(store.snapshot());await mkdir(dirname(stateFile),{recursive:true});await writeFile(stateFile+'.next',data,{mode:0o600});await rename(stateFile+'.next',stateFile);store.markSaved(revision);}
  let saving=null;const timer=setInterval(()=>{if(saving)return;saving=persist().catch(e=>console.error('Telemetry persistence failed:',e.code)).finally(()=>{saving=null;});},15000);timer.unref();
  await new Promise(resolve=>server.listen(port,host,resolve));
  return {server,store,close:async()=>{clearInterval(timer);await new Promise(resolve=>server.close(resolve));await saving;await persist();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const service=await startTelemetryServer({port:Number(process.env.EAGLER_NETPLAY_TELEMETRY_PORT||18153),
    origin:process.env.EAGLER_NETPLAY_TELEMETRY_ORIGIN,stateFile:process.env.EAGLER_NETPLAY_TELEMETRY_STATE});
  console.log('Anonymous netplay telemetry listening on loopback');
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void service.close().then(()=>process.exit(0));});
}
