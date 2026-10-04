import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRODUCT_GAMES} from './contracts/product-catalog.mjs';
import {ensureUiBuild} from './ui-build.mjs';
import {resolvePublicOrRepositorySource} from './public-source.mjs';
import {browserModuleClosure} from './browser-module-graph.mjs';
import {resolveBrowserPublicationSource} from './launcher-build.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
export const FRONTEND_UI_ARTIFACT=await ensureUiBuild();
// Standalone network-only migration/compatibility readers are retained. Shared
// informational-page styles stay until those authored pages are restyled.
const staticEntries=[
 ['site.webmanifest',true],['robots.txt',true],['sitemap.xml',false],
 ['styles.css',true],['touch-guide.css',true],['about.css',true],['ui-fonts.css',true],['ui-fonts-deferred.css',true],
 ['migrate.html',false],['legacy-mount-retirement-sw.js',false],
 ['legacy/legacy-game-pack.mjs',false],['legacy/legacy-import-storage.mjs',false],['legacy/legacy-package-adapter.mjs',false],
 ['about.html',true],['faq.html',true],['compatibility.html',true],
 ['vendor/fflate.min.js',true],['vendor/webaudio-tinysynth.min.js',true],['vendor/fflate.LICENSE',false],['vendor/webaudio-tinysynth.LICENSE',false],
 ['README.md',false],['ASSETS.md',false],['THIRD_PARTY.md',false],
];
const aliases=['en.html','lobby.html'];
const uiFiles=FRONTEND_UI_ARTIFACT.publishedFiles;
export const LEGACY_READER_FILES=await browserModuleClosure({root:project,
 entries:['legacy/legacy-game-pack.mjs','legacy/legacy-import-storage.mjs','legacy/legacy-package-adapter.mjs'],
 resolveFile:resolveBrowserPublicationSource});
export const FRONTEND_STATIC_SHELL_FILES=Object.freeze(staticEntries.filter(([,cache])=>cache).map(([path])=>path));
export const FRONTEND_PACKAGE_FILES=Object.freeze([...new Set([...uiFiles,...aliases,...staticEntries.map(([path])=>path),...LEGACY_READER_FILES])]);
export const APP_SHELL_FILES=Object.freeze([...new Set([...uiFiles,...aliases,...staticEntries.filter(([,cache])=>cache).map(([path])=>path)])]);
export const BROWSER_MODULE_FILES=Object.freeze(uiFiles.filter(path=>/\.[cm]?js$/.test(path)));
export const BROWSER_MODULE_ENTRYPOINTS=Object.freeze(BROWSER_MODULE_FILES.filter(path=>/^assets\/(?:entry\.client-|manifest-)/.test(path)));
export const PUBLIC_ASSET_FILES=Object.freeze(FRONTEND_PACKAGE_FILES.filter(path=>path.startsWith('assets/')));
export function resolveFrontendPackageSource(path){
 if(!FRONTEND_PACKAGE_FILES.includes(path))throw Error(`unknown frontend package file: ${path}`);
 if(aliases.includes(path))return resolve(FRONTEND_UI_ARTIFACT.root,'index.html');
 if(uiFiles.includes(path))return resolve(FRONTEND_UI_ARTIFACT.root,path);
 if(LEGACY_READER_FILES.includes(path))return resolveBrowserPublicationSource(path);
 return resolvePublicOrRepositorySource(path);
}
// Host-generated site branding is global publication state, not a per-game
// capability. Keep it separate from PRODUCT_GAMES so adding/selecting a title
// cannot accidentally drop a shell-level asset.
export const HOST_SITE_ARTWORK_FILES = Object.freeze([
  "th06.ico",
  "pwa/icon-192.png",
  "pwa/icon-512.png",
  "pwa/icon-maskable-512.png",
  "pwa/apple-touch-icon.png",
]);
export function hostArtworkFiles(games) {
  const files = games.flatMap(game => {
    const product = PRODUCT_GAMES[game];
    if (!product) throw new Error(`unknown artwork product: ${game}`);
    return product.cardArtwork ? [product.cardArtwork] : [];
  });
  return Object.freeze([...files, ...HOST_SITE_ARTWORK_FILES]);
}
