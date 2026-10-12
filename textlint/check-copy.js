import { parse } from '@babel/parser';
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { parseCopy } from '../src/ui/copy.ts';

// コードの copy.title / body / step の呼び出しと、src/copy/*.md の項目を突き合わせる。
// key がない、ラベルや本文がない、本文の {name} に値を渡していない、を見つける。

const PLACEHOLDER = /\{(\w+)\}/g;
const problems = [];
const warnings = [];

function literals(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return [node.value];
  if (node.type === 'ConditionalExpression') {
    const a = literals(node.consequent);
    const b = literals(node.alternate);
    return a && b ? [...a, ...b] : null;
  }
  return null;
}

function* walk(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'extra') continue;
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) yield* walk(c);
    else if (v && typeof v === 'object') yield* walk(v);
  }
}

function propertyNames(obj) {
  const names = new Set();
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') return null;
    if (p.key.type === 'Identifier') names.add(p.key.name);
    else if (p.key.type === 'StringLiteral') names.add(p.key.value);
  }
  return names;
}

function checkFile(file) {
  const source = readFileSync(file, 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'], errorRecovery: true });
  const mdImport = ast.program.body.find((n) => n.type === 'ImportDeclaration' && /\.md\?raw$/.test(n.source.value));
  if (!mdImport) return;
  const mdPath = path.join(path.dirname(file), mdImport.source.value.replace(/\?raw$/, ''));
  const entries = parseCopy(readFileSync(mdPath, 'utf8'));
  const md = path.relative(process.cwd(), mdPath);

  // `const params = { ... }` の形なら、渡しているプレースホルダー名を知れる
  const objects = new Map();
  for (const node of walk(ast.program)) {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init?.type === 'ObjectExpression') {
      objects.set(node.id.name, propertyNames(node.init));
    }
  }

  const used = new Set();
  let dynamic = false;
  for (const node of walk(ast.program)) {
    if (node.type !== 'CallExpression') continue;
    const callee = node.callee;
    if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier' || callee.object.name !== 'copy') continue;
    const method = callee.property.name;
    if (!['title', 'body', 'step'].includes(method)) continue;
    const at = `${file}:${node.loc.start.line}:${node.loc.start.column + 1}`;
    const keys = literals(node.arguments[0]);
    if (!keys) {
      dynamic = true;
      continue;
    }
    const arg = node.arguments[1];
    const given = !arg ? new Set() : arg.type === 'ObjectExpression' ? propertyNames(arg) : arg.type === 'Identifier' ? (objects.get(arg.name) ?? null) : null;
    for (const key of keys) {
      used.add(key);
      const entry = entries.get(key);
      if (!entry) {
        problems.push(`${at}  ${md} に ${key} がありません`);
        continue;
      }
      const texts = [];
      if (method !== 'body') {
        if (entry.title === undefined) problems.push(`${at}  ${md} の ${key} にラベル (## 行) がありません`);
        else texts.push(entry.title);
      }
      if (method !== 'title') {
        if (!entry.body) problems.push(`${at}  ${md} の ${key} に本文がありません`);
        else texts.push(entry.body);
      }
      if (!given) continue;
      for (const text of texts) {
        for (const m of text.matchAll(PLACEHOLDER)) {
          if (!given.has(m[1])) problems.push(`${at}  ${md} の ${key} にある {${m[1]}} に値を渡していません`);
        }
      }
    }
  }

  if (!dynamic) {
    for (const [key, entry] of entries) {
      if (!used.has(key)) warnings.push(`${md}:${entry.line}  ${key} はコードから使われていません`);
    }
  }
}

for await (const file of glob('src/**/*.ts')) checkFile(file);

for (const w of warnings) console.log(`warning  ${w}`);
for (const p of problems) console.log(`error    ${p}`);
if (problems.length) {
  console.log(`\ncheck-copy: ${problems.length} problems`);
  process.exitCode = 1;
} else {
  console.log(`check-copy: ok${warnings.length ? ` (${warnings.length} warnings)` : ''}`);
}
