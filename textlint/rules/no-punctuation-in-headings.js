const PUNCTUATION = /[、。，．]/g;

export default function noPunctuationInHeadings(context) {
  const { Syntax, RuleError, report, locator } = context;

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
