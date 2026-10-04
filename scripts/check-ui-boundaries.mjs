import {readFile, readdir} from 'node:fs/promises';
import {resolve, relative, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (!['loc', 'comments', 'tokens', 'errors'].includes(key)) walk(value, visit);
  }
}
function imports(source) {
  const found = [];
  walk(source, node => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && node.source?.type === 'StringLiteral') found.push(node.source.value);
    if (node.type === 'CallExpression' && node.callee?.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') found.push(node.arguments[0].value);
    if (node.type === 'TSExternalModuleReference' && node.expression?.type === 'StringLiteral') found.push(node.expression.value);
    if (node.type === 'TSImportType' && node.argument?.type === 'StringLiteral') found.push(node.argument.value);
  });
  return found;
}
const uiDependency = /^(?:react(?:-dom|-router(?:-dom)?)?(?:\/|$)|@react-router\/|@radix-ui\/|motion(?:\/|$))/;

export function boundaryViolations(name, text, root = process.cwd()) {
  const file = resolve(root, name), failures = [];
  const typescript = ['typescript', {dts: /\.d\.[cm]?tsx?$/.test(file)}];
  const plugins = /tsx$/.test(file) ? [typescript, 'jsx'] : /[cm]?ts$/.test(file) ? [typescript] : ['jsx'];
  const ast = parse(text, {sourceType: 'unambiguous', sourceFilename: name, plugins});
  const service = name.startsWith('app/services/'), core = !name.startsWith('app/');
  for (const specifier of imports(ast)) {
    const target = specifier.startsWith('.') ? relative(root, resolve(dirname(file), specifier)).replaceAll('\\', '/') : specifier;
    if ((core || service) && uiDependency.test(specifier)) failures.push(`${name}: UI dependency ${specifier}`);
    if (core && target.startsWith('app/')) failures.push(`${name}: reverse app dependency ${specifier}`);
    if (service && target.startsWith('app/') && !target.startsWith('app/services/')) failures.push(`${name}: service depends on view ${specifier}`);
  }
  if (name.startsWith('app/')) walk(ast, node => {
    if (!['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) return;
    const property = node.computed ? node.property?.value : node.property?.name;
    const object = node.object;
    const history = object?.type === 'Identifier' && object.name === 'history' || object?.type === 'MemberExpression' && object.property?.name === 'history';
    if (['pushState', 'replaceState'].includes(property) || history && ['back', 'forward', 'go'].includes(property)) failures.push(`${name}: secondary history owner ${property}`);
    if (service && ['querySelector', 'querySelectorAll', 'getElementById', 'createElement'].includes(property)) failures.push(`${name}: component DOM operation ${property}`);
  });
  return failures;
}
async function files(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  return (await Promise.all(entries.filter(entry => !entry.name.startsWith('.')).map(entry => entry.isDirectory()
    ? files(resolve(directory, entry.name)) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [resolve(directory, entry.name)] : []))).flat();
}
export async function checkUiBoundaries(root = process.cwd()) {
  const failures = [];
  for (const area of ['src', 'package', 'lib', 'server', 'app']) for (const file of await files(resolve(root, area))) {
    failures.push(...boundaryViolations(relative(root, file).replaceAll('\\', '/'), await readFile(file, 'utf8'), root));
  }
  if (failures.length) throw Error(failures.join('\n'));
  console.log('UI dependency ownership: PASS (core/services stay framework-independent; Router owns new-entry history)');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkUiBoundaries();
