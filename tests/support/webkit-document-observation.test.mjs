/** Setup/source/DOM observations only: never imports or launches Playwright,
 * packages native games, or establishes WebKit/input/storage acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {runtimeDocumentObservationScript} from './runtime-document-observation.mjs';
import {runtimeGenerationEntry} from '../../lib/contracts/runtime-generations.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const baseline = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const child = 'tests/browser/launcher-playwright-webkit.py';
const wrapper = 'tests/browser/test-playwright-webkit-gate.mjs';
const source = readFileSync(new URL('../../' + child, import.meta.url), 'utf8');
const pinned = path => execFileSync('git', ['show', `${baseline}:${path}`], {cwd: project, encoding: 'utf8'});
const python = text => JSON.parse(execFileSync('python', ['-c', text], {cwd: project, encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}}));
const helper = 'globalThis.__originalRuntimeDocumentObservation';
const prefix = `${helper} ? ${helper}.url(document.getElementById('gameFrame')) : `;
const original = pinned(child);
function restore(value) {
  return value.replace('from pathlib import Path\n', '')
    .replace('\nsys.path.insert(0, str(Path(__file__).resolve().parents[1]))\nfrom support.runtime_document_observation import install_runtime_document_observation\n', '')
    .replace('        install_runtime_document_observation(page)\n', '')
    .replaceAll(prefix, '');
}
const observations = python(`import ast,json\nfrom pathlib import Path\ns=Path('${child}').read_text()\nprint(json.dumps([n.value for n in ast.walk(ast.parse(s)) if isinstance(n,ast.Constant) and isinstance(n.value,str) and 'frameSrc:' in n.value]))`);
const installed = runtimeDocumentObservationScript({EAGLER_RUNTIME_TEST_OBSERVATION: 'document'});
function fixture({mode = 'document', src = '/runtime/th07/th07.html?managedData=1&gameGeneration=old'} = {}) {
  const dom = new JSDOM('<iframe id="gameFrame"></iframe>', {url: 'https://launcher.test/', runScripts: 'outside-only'});
  const frame = dom.window.document.getElementById('gameFrame'); if (src) frame.src = src;
  if (mode === 'document') dom.window.eval(installed);
  return {window: dom.window, frame};
}
function evaluate(window, text) {return JSON.parse(JSON.stringify(window.eval(`(${text})()`)));}

test('only helper setup and two URL inputs change; full Python source and separate server adapter reverse to pinned', () => {
  assert.equal(restore(source), original);
  assert.equal(readFileSync(new URL('../../' + wrapper, import.meta.url), 'utf8')
    .replace('import { webkitPublicationServerArguments } from \"../support/webkit-publication-server.mjs\";\n', '')
    .replace('webkitPublicationServerArguments(output, port)', '[\"scripts/serve.mjs\", String(port), output]'), pinned(wrapper));
  assert.equal(observations.length, 2);
  const result = python(`import ast,json,subprocess\nfrom pathlib import Path\na=subprocess.check_output(['git','show','${baseline}:${child}'],text=True);b=Path('${child}').read_text()\ndef segments(s,kind): return [ast.get_source_segment(s,n) for n in ast.walk(ast.parse(s)) if isinstance(n,kind)]\ndef predicates(s): return [ast.get_source_segment(s,n.test) for n in ast.walk(ast.parse(s)) if isinstance(n,(ast.If,ast.While))]\nprint(json.dumps({'asserts':len(segments(a,ast.Assert)),'raises':len(segments(a,ast.Raise)),'predicates':len(predicates(a)),'allRaisesEqual':segments(a,ast.Raise)==segments(b,ast.Raise),'allPredicatesEqual':predicates(a)==predicates(b)}))`);
  assert.equal(result.asserts, 0); assert.equal(result.raises, 12); assert.equal(result.predicates, 33);
  assert.equal(result.allRaisesEqual, true); assert.equal(result.allPredicatesEqual, true);
  const suffix = '        # Second launch must come from the installed Package Store.';
  assert.equal(source.slice(source.indexOf(suffix)).replaceAll(prefix, ''), original.slice(original.indexOf(suffix)));
});

test('browser-child helper imports resolve from its direct-script location; defaults install nothing and explicit document mode installs the same read-only observer', () => {
  const result = python(`import ast,json,os,sys\nfrom pathlib import Path\np=Path('${child}').resolve();scope={'__file__':str(p),'sys':sys}\ntree=ast.parse(p.read_text());nodes=[]\nfor n in tree.body:\n if isinstance(n,ast.ImportFrom) and n.module in ('pathlib','support.runtime_document_observation'): nodes.append(n)\n elif isinstance(n,ast.Expr) and ast.get_source_segment(p.read_text(),n).startswith('sys.path.insert('):nodes.append(n)\nexec(compile(ast.Module(body=nodes,type_ignores=[]),str(p),'exec'),scope)\nclass Page:\n def __init__(self): self.scripts=[]\n def add_init_script(self,script): self.scripts.append(script)\nresults=[]\nfor mode in (None,'attribute','document'):\n if mode is None:os.environ.pop('EAGLER_RUNTIME_TEST_OBSERVATION',None)\n else:os.environ['EAGLER_RUNTIME_TEST_OBSERVATION']=mode\n page=Page();scope['install_runtime_document_observation'](page);results.append(page.scripts)\nos.environ['EAGLER_RUNTIME_TEST_OBSERVATION']='unsupported'\ntry:scope['install_runtime_document_observation'](Page())\nexcept ValueError:results.append('rejected')\nprint(json.dumps(results))`);
  assert.deepEqual(result, [[], [], [installed], 'rejected']);
});

test('both original status snapshots preserve default src reads and opt-in observes actual child URL without mutating other observations', () => {
  for (const mode of ['attribute', 'document']) {
    const f = fixture({mode});
    try {
      const attribute = f.frame.getAttribute('src');
      f.frame.contentWindow.history.replaceState(null, '', '?managedData=1&gameGeneration=new');
      for (const snapshot of observations) {
        const before = evaluate(f.window, snapshot.replace(prefix, '')), after = evaluate(f.window, snapshot);
        assert.equal(after.frameSrc, mode === 'document' ? f.frame.contentWindow.location.href : f.frame.src);
        assert.deepEqual({...after, frameSrc: null}, {...before, frameSrc: null});
        assert.equal(after.firstFrame, false, 'the adapter never supplies a successful first-frame result');
      }
      assert.equal(f.frame.getAttribute('src'), attribute); assert.equal(Object.hasOwn(f.frame, 'src'), false);
    } finally {f.window.close();}
  }
});

test('selected missing, detached and foreign child documents reject rather than falling back to src or manufacturing a generation', () => {
  const f = fixture();
  try {
    f.frame.remove();
    for (const snapshot of observations) assert.throws(() => evaluate(f.window, snapshot), /missing or detached/);
  } finally {f.window.close();}
  const foreign = fixture({src: 'https://foreign.test/runtime/th07/th07.html?gameGeneration=old'});
  try {for (const snapshot of observations) assert.throws(() => evaluate(foreign.window, snapshot), /share the Launcher origin/);}
  finally {foreign.window.close();}
});

test('unchanged original Runtime path predicate exposes the pinned immutable-publication conflict rather than accepting a weaker path', () => {
  const generation = 'a'.repeat(64);
  const immutable = 'https://launcher.test/' + runtimeGenerationEntry('runtime/th07/', {generation, entry: 'th07.html'}) + '?managedData=1&gameGeneration=package-id';
  const result = python(`import ast,json\nfrom urllib.parse import parse_qs,urlparse\nfrom pathlib import Path\nt=ast.parse(Path('${child}').read_text());nodes=[n for n in t.body if isinstance(n,ast.FunctionDef) and n.name in ('is_runtime_frame','runtime_generation')]\nscope={'parse_qs':parse_qs,'urlparse':urlparse};exec(compile(ast.Module(body=nodes,type_ignores=[]),'original-path-predicates','exec'),scope)\nurls=['https://launcher.test/runtime/th07/th07.html?managedData=1&gameGeneration=package-id',${JSON.stringify(immutable)}]\nprint(json.dumps([[scope['is_runtime_frame'](u,'th07'),scope['runtime_generation'](u,'th07')] for u in urls]))`);
  assert.deepEqual(result, [[true, 'package-id'], [false, '']]);
  assert.ok(pinned('scripts/package-server.mjs').includes('await freezeHostRuntimes(staging, manifest'));
  assert.ok(pinned('lib/runtime-generations.mjs').includes('url.pathname = "/" + runtimeGenerationEntry(root, current);'));
  assert.ok(readFileSync(new URL('../../scripts/serve.mjs', import.meta.url), 'utf8').includes('Explicit directory serving for React must use the verified packaged static server'));
});
