import { parse as parseTs } from '@babel/parser';
import { parse as parseMarkdown } from '@textlint/markdown-to-ast';

// 日本語を含む文字列リテラルだけを取り出し、Markdown として解析した AST を元ファイルの位置に写す。
// rich() が解釈する `code` と **strong** は、そのまま Code と Strong のノードになる。

const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;
const SENTENCE = /。/;
const HOLE = '';
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`', $: '$', '0': '\0' };

class Cooked {
  constructor() {
    this.text = '';
    this.map = [];
  }

  // src[from, to) をエスケープを戻しながら追加する。map は cooked の各文字が元の何文字目かを持つ。
  append(src, from, to) {
    let i = from;
    while (i < to) {
      const c = src[i];
      if (c === '\\' && i + 1 < to) {
        const n = src[i + 1];
        if (n !== '\n') {
          this.text += ESCAPES[n] ?? n;
          this.map.push(i);
        }
        i += 2;
        continue;
      }
      this.text += c;
      this.map.push(i);
      i += 1;
    }
  }

  hole(at) {
    this.text += HOLE;
    this.map.push(at);
  }

  finish(end) {
    this.map.push(end);
  }
}

function cookLiteral(source, node) {
  if (node.type === 'StringLiteral') {
    const cooked = new Cooked();
    cooked.append(source, node.start + 1, node.end - 1);
    cooked.finish(node.end - 1);
    return cooked;
  }
  if (node.type === 'TemplateLiteral') {
    const cooked = new Cooked();
    node.quasis.forEach((q, i) => {
      if (i > 0) cooked.hole(node.expressions[i - 1].start - 2);
      cooked.append(source, q.start, q.end);
    });
    cooked.finish(node.end - 1);
    return cooked;
  }
  return null;
}

function makeLocator(source) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo] };
  };
}

// cooked 座標のノードを元ファイルの座標に写す。
// Str の中の HOLE は、前後の Str と `${...}` を表す Code ノードに分ける。
// ノードが元ファイル上で隙間なく並ぶので、文の位置計算をするルールが狂わない。
function relocate(node, cooked, source, locate) {
  const place = (n, start, end) => {
    n.range = [start, end];
    n.loc = { start: locate(start), end: locate(end) };
    n.raw = source.slice(start, end);
  };
  const convert = (n) => {
    const [a, b] = n.range;
    if (n.type === 'Str' && n.value.includes(HOLE)) {
      const out = [];
      let k = 0;
      while (k < n.value.length) {
        let e = k;
        while (e < n.value.length && n.value[e] !== HOLE) e++;
        if (e > k) {
          const piece = { type: 'Str', value: n.value.slice(k, e) };
          place(piece, cooked.map[a + k], cooked.map[a + e]);
          out.push(piece);
        }
        if (e < n.value.length) {
          // value を空にして、文の長さに式のコードを数えさせない
          const hole = { type: 'Code', hole: true, value: '' };
          place(hole, cooked.map[a + e], cooked.map[a + e + 1]);
          out.push(hole);
        }
        k = e + 1;
      }
      return out;
    }
    if (typeof n.value === 'string') n.value = n.value.replaceAll(HOLE, '');
    place(n, cooked.map[a], cooked.map[b]);
    if (n.children) n.children = n.children.flatMap(convert);
    return [n];
  };
  return convert(node);
}

function* literals(node) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') yield node;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'extra' || key === 'leadingComments' || key === 'trailingComments') continue;
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) yield* literals(c);
    else if (v && typeof v === 'object') yield* literals(v);
  }
}

export function parseStrings(source, filePath = 'input.ts') {
  const ast = parseTs(source, {
    sourceType: 'module',
    sourceFilename: filePath,
    plugins: ['typescript', 'jsx'],
    errorRecovery: true,
  });
  const locate = makeLocator(source);
  const children = [];

  for (const node of literals(ast.program)) {
    const cooked = cookLiteral(source, node);
    if (!JAPANESE.test(cooked.text)) continue;
    for (const top of parseMarkdown(cooked.text).children) {
      for (const n of relocate(top, cooked, source, locate)) {
        // 句点のない文字列はラベルや見出しなので、段落向けのルールから外す
        if (n.type === 'Paragraph' && !SENTENCE.test(cooked.text)) n.type = 'Label';
        children.push(n);
      }
    }
  }

  return {
    type: 'Document',
    children,
    range: [0, source.length],
    loc: { start: locate(0), end: locate(source.length) },
    raw: source,
  };
}

class TsStringsProcessor {
  constructor(options = {}) {
    this.options = options;
  }

  availableExtensions() {
    return ['.ts', '.tsx'];
  }

  processor() {
    return {
      preProcess: (text, filePath) => parseStrings(text, filePath),
      postProcess: (messages, filePath) => ({ messages, filePath: filePath ?? '<ts>' }),
    };
  }
}

export default { Processor: TsStringsProcessor };
