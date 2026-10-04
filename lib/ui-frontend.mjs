import * as productCatalog from './contracts/product-catalog.mjs';
import {UI_WEB_APP_ASSETS,uiPublicationProducts} from '../scripts/ui-deployment-contract.mjs';
import {createUiDeploymentContract,uiNginxNavigation} from '../scripts/ui-deployment-contract.mjs';
/** Portable candidate-tree installation. The caller owns atomic publication;
 * this never edits a live source/deployment or changes Runtime/Package data. */
import {cp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {readUiArtifact,uiArtifactHash} from './ui-artifact.mjs';
import {PRODUCT_GAMES} from './contracts/product-catalog.mjs';
import {buildAppShell} from './app-shell-build.mjs';
import {FRONTEND_STATIC_SHELL_FILES,FRONTEND_UI_ARTIFACT} from './frontend-manifest.mjs';
import {writeSiteMetadata} from './site-metadata.mjs';
import {PRIVATE_FRONTEND_ASSETS} from './private-frontend-assets.mjs';
export const UI_PUBLICATION_SCHEMA='eagler-touhou/ui-publication/1';
const json=value=>JSON.stringify(value,null,2)+'\n';
export async function installUiFrontend(root,{artifact=FRONTEND_UI_ARTIFACT,hostManifest,status='react-main',baseReleaseId=null,siteUrl=null,supplementalShellFiles=FRONTEND_STATIC_SHELL_FILES}={}){
 if(!['react-main','experimental-opt-in'].includes(status))throw Error('Unknown UI publication status');
 artifact=await readUiArtifact(artifact.root);
 if(!hostManifest?.shared || !hostManifest?.games)throw Error('UI candidate installation needs the existing Host Manifest');
 const preserved=new Set([...Object.values(PRODUCT_GAMES).filter(game=>game.cardArtwork).map(game=>`assets/${game.cardArtwork}`),...PRIVATE_FRONTEND_ASSETS.map(item=>item.target)]);
 for(const path of artifact.publishedFiles){if(preserved.has(path) && await stat(resolve(root,path)).then(value=>value.isFile(),()=>false))continue;await mkdir(dirname(resolve(root,path)),{recursive:true});await cp(resolve(artifact.root,path),resolve(root,path));
  const input=artifact.files.find(file=>file.path===path),bytes=await readFile(resolve(root,path));if(bytes.length!==input.bytes||uiArtifactHash(bytes)!==input.sha256)throw Error(`UI input changed during candidate installation: ${path}`);}
 const html=await readFile(resolve(root,'index.html'),'utf8');
 for(const path of artifact.navigation.legacyEntries)await writeFile(resolve(root,path.slice(1)),html);
 // Only assembled site trees contain the standalone pages; the opt-in adapter
 // uses the same publication writer once its base has supplied them.
 if(await stat(resolve(root,'about.html')).then(s=>s.isFile(),()=>false))await writeSiteMetadata(root,siteUrl);
 const artwork={};
 for(const [game,product] of Object.entries(PRODUCT_GAMES)){
  if(!product.cardArtwork)continue;const path=`assets/${product.cardArtwork}`;
  try{const bytes=await readFile(resolve(root,path));if(bytes.length)artwork[game]={path,bytes:bytes.length,sha256:uiArtifactHash(bytes)};}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const webApp={};for(const [key,path] of Object.entries(UI_WEB_APP_ASSETS)){try{const bytes=await readFile(resolve(root,path));if(bytes.length)webApp[key]={path,bytes:bytes.length,sha256:uiArtifactHash(bytes)};}catch(error){if(error.code!=='ENOENT')throw error;}}
 const hostBytes=await readFile(resolve(root,'host-manifest.json'));
 const marker={hostManifest:{path:'host-manifest.json',profile:hostManifest.profile,sha256:uiArtifactHash(hostBytes)},products:uiPublicationProducts(hostManifest,productCatalog),testBuild:hostManifest.shared.testBuild===true,webApp,schema:UI_PUBLICATION_SCHEMA,status,mountPath:artifact.mountPath,worker:'app-shell-sw.js',workerPrelude:artifact.workerPrelude,baseReleaseId,
  uiBuild:{sha256:artifact.artifactId,files:artifact.files},navigation:artifact.navigation,artwork,
  originMigration:hostManifest.shared.originMigration?.mode==='http-to-https'?{mode:'http-to-https'}:null,
  storage:{runtime:'unchanged',packages:'unchanged',saves:'unchanged'}};
 await writeFile(resolve(root,'ui-publication.json'),json(marker));
 await writeFile(resolve(root,'ui-navigation.nginx.conf'),uiNginxNavigation(artifact.navigation));
 const shellFiles=[...new Set([...artifact.publishedFiles,...artifact.navigation.legacyEntries.map(path=>path.slice(1)),...supplementalShellFiles,'ui-publication.json',...Object.values(artwork).map(item=>item.path),...Object.values(webApp).map(item=>item.path)])];
 const result=await buildAppShell({globDirectory:root,swDest:resolve(root,'app-shell-sw.js'),appShellFiles:shellFiles,workerPrelude:artifact.workerPrelude,quiet:true});
 if(result.warnings.length||shellFiles.some(path=>!result.contract.entries.includes(path)))throw Error(`Incomplete React shell precache: ${result.warnings.join('; ')}`);
 return {...result,marker,publication:{...marker,appShell:result.contract}};
}
export function validateUiPublicationMarker(marker,{hostManifest=null}={}){
 if(marker.schema!==UI_PUBLICATION_SCHEMA||!['react-main','experimental-opt-in'].includes(marker.status)||marker.worker!=='app-shell-sw.js'||!Array.isArray(marker.uiBuild?.files)||!/^[a-f0-9]{64}$/.test(marker.uiBuild?.sha256||''))throw Error('React UI publication marker missing or invalid');
 if(marker.hostManifest?.path!=='host-manifest.json'||!/^[a-f0-9]{64}$/.test(marker.hostManifest.sha256||''))throw Error('Invalid published Host metadata identity');
 const navigation=createUiDeploymentContract(marker.navigation);
 if(navigation.mountPath!==marker.mountPath || typeof marker.workerPrelude!=='string' || !marker.workerPrelude.includes('__EAGLER_UI_NAVIGATION_FALLBACK'))throw Error('React UI navigation/prelude does not match its artifact');
 if(typeof marker.testBuild!=='boolean'||!Array.isArray(marker.products)||new Set(marker.products).size!==marker.products.length||marker.products.some(product=>!productCatalog.isProductId(product)||!productCatalog.productEnabledForBuild(product,marker.testBuild)))throw Error('Invalid published UI product selection');
 if(hostManifest && (marker.testBuild!==(hostManifest.shared.testBuild===true)||JSON.stringify(marker.products)!==JSON.stringify(uiPublicationProducts(hostManifest,productCatalog))))throw Error('Published UI products disagree with Host availability');
 for(const item of marker.uiBuild.files)if(typeof item.path!=='string'||!Number.isSafeInteger(item.bytes)||item.bytes<1||!/^[a-f0-9]{64}$/.test(item.sha256||'')||(!['index.html','compatibility.html','ui-build.json','ui-navigation.json','ui-ownership.json','NOTICE.txt','content/FIRST_USE_NOTICE.html','content/MULTIPLAYER.html'].includes(item.path)&&!/^assets\/[A-Za-z0-9._/-]+$/.test(item.path))||item.path.split('/').some(part=>!part||part.startsWith('.')))throw Error('Invalid React UI input identity');
 for(const [key,item] of Object.entries(marker.webApp||{}))if(!Object.hasOwn(UI_WEB_APP_ASSETS,key)||item.path!==UI_WEB_APP_ASSETS[key]||!Number.isSafeInteger(item.bytes)||item.bytes<1||!/^[a-f0-9]{64}$/.test(item.sha256||''))throw Error('Invalid published Web App asset');
 return marker;
}
export async function verifyUiFrontend(root,deployment,hostManifest=null){
 const marker=validateUiPublicationMarker(JSON.parse(await readFile(resolve(root,'ui-publication.json'),'utf8')),{hostManifest});
 if(await readFile(resolve(root,'ui-navigation.nginx.conf'),'utf8')!==uiNginxNavigation(marker.navigation))throw Error('Published HTTP navigation configuration differs from Framework routes');
 if(uiArtifactHash(await readFile(resolve(root,'host-manifest.json')))!==marker.hostManifest.sha256 || hostManifest && marker.hostManifest.profile!==hostManifest.profile)throw Error('Published Host metadata identity mismatch');
 const expected=new Set(marker.uiBuild.files.filter(file=>!['ui-ownership.json','ui-artifact.json'].includes(file.path)).map(file=>file.path));
 for(const path of ['index.html','en.html','lobby.html','ui-publication.json'])expected.add(path);
 for(const path of expected)if(!deployment.appShell.entries.includes(path))throw Error(`React shell precache omits ${path}`);
 for(const [game,entry] of Object.entries(marker.artwork||{})){
  if(!PRODUCT_GAMES[game]?.cardArtwork||entry.path!==`assets/${PRODUCT_GAMES[game].cardArtwork}`)throw Error('React artwork path is not catalog-owned');
  const bytes=await readFile(resolve(root,entry.path));if(bytes.length!==entry.bytes||uiArtifactHash(bytes)!==entry.sha256)throw Error('React artwork identity mismatch');
 }
 for(const entry of Object.values(marker.webApp||{})){const bytes=await readFile(resolve(root,entry.path));if(bytes.length!==entry.bytes||uiArtifactHash(bytes)!==entry.sha256)throw Error('Web App asset identity mismatch');if(!deployment.appShell.entries.includes(entry.path))throw Error('Web App asset missing from precache');}
 for(const path of deployment.appShell.entries)if(/^(?:runtime|games|shared|packages)\//.test(path)||['runtime-manifest.json','host-manifest.json','release-catalog.json','app.js'].includes(path))throw Error('Runtime/Package/legacy entry leaked into React precache');
 return marker;
}
