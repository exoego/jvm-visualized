const PUNCTUATION = /[、。，．]/g;

// ページの見出し (index.html の h1〜h3) だけが対象。src/copy/*.md の見出しは解説のラベルで、読点を含んでよい。
export default function noPunctuationInHeadings(context) {
  const { Syntax, RuleError, report, locator, getFilePath } = context;
  if (!getFilePath()?.endsWith('.html')) return {};

  const walk = (node, visit) => {
    visit(node);
    for (const child of node.children ?? []) walk(child, visit);
  };

  return {
    [Syntax.Header](header) {
      walk(header, (node) => {
        if (node.type.toLowerCase() === 'break') {
          report(node, new RuleError('見出しの中で改行しない'));
          return;
        }
        if (node.type !== Syntax.Str) return;
        for (const m of node.value.matchAll(PUNCTUATION)) {
          report(node, new RuleError(`見出しに「${m[0]}」を使わない`, { padding: locator.at(m.index) }));
        }
      });
    },
  };
}
