// ts-strings プラグインが `${...}` を表すために置いた Code ノードは、文章ではないので全ルールの対象から外す。
// 前後 1 文字も含めるのは、インラインコードの前後のスペースを見るルールが隣の文字に報告するため。
export default function templateHoles(context) {
  const { Syntax, shouldIgnore } = context;
  return {
    [Syntax.Code](node) {
      if (node.hole) shouldIgnore([node.range[0] - 1, node.range[1] + 1], { ruleId: '*' });
    },
  };
}
