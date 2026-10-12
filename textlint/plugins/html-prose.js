import html from 'textlint-plugin-html';

// textlint-plugin-html は HTML の整形用インデントを文の一部として残す。
// 改行を含む前後の空白を落とし、eyebrow は段落ではなくラベルとして扱う。

const LABEL_CLASSES = new Set(['eyebrow']);

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

function tidy(node, locate) {
  if (node.type === 'Paragraph') {
    const classes = node.properties?.className ?? [];
    if (classes.some((c) => LABEL_CLASSES.has(c))) node.type = 'Label';
  }
  if (!node.children) return;
  node.children = node.children.filter((child) => {
    if (child.type === 'Str') return trimStr(child, locate);
    tidy(child, locate);
    return true;
  });
}

class HtmlProseProcessor extends html.Processor {
  processor(ext) {
    const base = super.processor(ext);
    return {
      preProcess: (text, filePath) => {
        const ast = base.preProcess(text, filePath);
        tidy(ast, makeLocator(text));
        return ast;
      },
      postProcess: base.postProcess,
    };
  }
}

export default { Processor: HtmlProseProcessor };
