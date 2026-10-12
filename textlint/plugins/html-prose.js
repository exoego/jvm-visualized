import html from 'textlint-plugin-html';

// textlint-plugin-html は HTML の整形用インデントを文の一部として残し、属性値は見ない。
// 改行を含む前後の空白を落とし、eyebrow は段落ではなくラベルとして扱う。
// meta description や aria-label のような日本語の属性値も文として扱う。

const LABEL_CLASSES = new Set(['eyebrow']);
const JAPANESE = /[　-ヿ一-鿿]/;
const QUOTED_ATTR = /=\s*(?:"([^"]*)"|'([^']*)')/g;

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

function trimStr(node, locate) {
  const lead = node.value.match(/^\s*\n\s*/)?.[0].length ?? 0;
  const trail = node.value.match(/\s*\n\s*$/)?.[0].length ?? 0;
  if (!lead && !trail) return true;
  const value = node.value.slice(lead, node.value.length - trail);
  if (!value) return false;
  const start = node.range[0] + lead;
  const end = node.range[1] - trail;
  node.value = value;
  node.raw = node.raw.slice(lead, node.raw.length - trail);
  node.range = [start, end];
  node.loc = { start: locate(start), end: locate(end) };
  return true;
}

function openTagEnd(source, start) {
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
  }
  return source.length;
}

function textNode(value, start, locate) {
  const range = [start, start + value.length];
  const loc = { start: locate(range[0]), end: locate(range[1]) };
  const str = { type: 'Str', value, raw: value, range, loc };
  return { type: /。/.test(value) ? 'Paragraph' : 'Label', raw: value, range, loc, children: [str] };
}

function attrNodes(node, source, locate) {
  if (!node.properties || !node.range) return [];
  const tag = source.slice(node.range[0], openTagEnd(source, node.range[0]));
  const nodes = [];
  for (const m of tag.matchAll(QUOTED_ATTR)) {
    const value = m[1] ?? m[2];
    if (!JAPANESE.test(value)) continue;
    const start = node.range[0] + m.index + m[0].length - value.length - 1;
    nodes.push(textNode(value, start, locate));
  }
  return nodes;
}

function tidy(node, source, locate) {
  if (node.type === 'Paragraph') {
    const classes = node.properties?.className ?? [];
    if (classes.some((c) => LABEL_CLASSES.has(c))) node.type = 'Label';
  }
  const attrs = attrNodes(node, source, locate);
  if (attrs.length) node.children = [...attrs, ...(node.children ?? [])];
  if (!node.children) return;
  node.children = node.children.filter((child) => {
    if (child.type === 'Str') return trimStr(child, locate);
    tidy(child, source, locate);
    return true;
  });
}

class HtmlProseProcessor extends html.Processor {
  processor(ext) {
    const base = super.processor(ext);
    return {
      preProcess: (text, filePath) => {
        const ast = base.preProcess(text, filePath);
        tidy(ast, text, makeLocator(text));
        return ast;
      },
      postProcess: base.postProcess,
    };
  }
}

export default { Processor: HtmlProseProcessor };
