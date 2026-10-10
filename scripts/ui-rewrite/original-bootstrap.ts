import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse, type DefaultTreeAdapterMap} from 'parse5';
import type {Plugin} from 'vite';
type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const moduleId = 'virtual:original-bootstrap';
const resolvedId = '\0' + moduleId;
/** Extract trusted, current-main bootstrap assets byte-for-byte. Never infer
 * emergency UI text or duplicate it into a newly authored React implementation. */
export function readOriginalBootstrap() {
  function fromFile(name: string) {
    const file = fileURLToPath(new URL(`../../public/${name}`, import.meta.url));
    const source = readFileSync(file, 'utf8');
    const root = parse(source, {sourceCodeLocationInfo: true});
    const elements: Element[] = [];
    function visit(node: Node) {
      if ('tagName' in node) elements.push(node);
      if ('childNodes' in node) for (const child of node.childNodes) visit(child);
    }
    visit(root);
    function inner(element: Element) {
      const location = element.sourceCodeLocation;
      if (!location?.startTag || !location.endTag) throw new Error(`Missing original markup location in ${name}`);
      return source.slice(location.startTag.endOffset, location.endTag.startOffset);
    }
    function find(predicate: (element: Element) => boolean) {
      const found = elements.filter(predicate); if (found.length !== 1) throw new Error(`Expected one original bootstrap asset in ${name}; found ${found.length}`);
      return found[0];
    }
    const id = name === 'index.html' ? 'eaglerPreload' : 'lobbyPreload';
    const preload = find(element => element.attrs.some(attr => attr.name === 'id' && attr.value === id));
    const css = find(element => element.tagName === 'style' && inner(element).includes(`#${id}`) && inner(element).includes('is-done'));
    const script = find(element => element.tagName === 'script' && !!element.sourceCodeLocation?.endTag &&
      (name === 'index.html' ? inner(element).includes('window.__eaglerBoot = boot;') : inner(element).includes("document.getElementById('lobbyModule').addEventListener('error', fail)")));
    const loc = preload.sourceCodeLocation!;
    const compatibility = name === 'index.html' ? inner(find(element => element.tagName === 'script' && !!element.sourceCodeLocation?.endTag && inner(element).includes('var supportedChromium ='))) : '';
    return {script: inner(script), compatibility, css: inner(css), preload: source.slice(loc.startOffset, loc.endOffset)};
  }
  return {library: fromFile('index.html'), lobby: fromFile('lobby.html')};
}
export function originalBootstrap(): Plugin {
  return {name: 'current-main-bootstrap',
    resolveId(id) {if (id === moduleId) return resolvedId;},
    load(id) {
      if (id !== resolvedId) return;
      this.addWatchFile(fileURLToPath(new URL('../../public/index.html', import.meta.url)));
      this.addWatchFile(fileURLToPath(new URL('../../public/lobby.html', import.meta.url)));
      return `export const originalBootstrap = ${JSON.stringify(readOriginalBootstrap())};`;
    },
  };
}
