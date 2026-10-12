// src/copy/*.md の見出しはステップ名や手順の 1 行で、文ではない。文体の統一チェックから外す。
export default function labelHeadings(context) {
  const { Syntax, shouldIgnore, getFilePath } = context;
  if (!getFilePath()?.endsWith('.md')) return {};
  return {
    [Syntax.Header](node) {
      shouldIgnore(node.range, { ruleId: 'ja-technical-writing/no-mix-dearu-desumasu' });
    },
  };
}
