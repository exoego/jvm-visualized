import { cpText, prettyDescriptor } from '../classfile/describe';
import type { ClassFile, Member } from '../classfile/types';
import { fitter, h, rich, showable, specLink, type Fitter } from '../ui/dom';
import { Player } from '../ui/player';

type Tone = 'load' | 'resolve' | 'exec' | 'error' | 'done';

const TONE_LABEL: Record<Tone, string> = {
  load: '組み合わせ',
  resolve: '解決',
  exec: '実行',
  error: 'エラー',
  done: '気づく',
};

interface Step {
  title: string;
  body: string;
  tone: Tone;
  specs?: string[];
  pc?: number;
  focus?: 'ref' | 'ctor' | 'class';
  resolved?: ('class' | 'ctor' | 'ref')[];
  failed?: boolean;
  chain?: { text: string; state: 'done' | 'active' | 'todo' }[];
  bar?: 'old' | 'new';
  missing?: boolean;
  run?: 'old' | 'cmd' | 'new';
  note?: boolean;
}

const OK_RUN = ['$ java -cp app:foo:bar-1.0 Main', 'bar.Bar#buz'];
const NG_CMD = ['$ java -cp app:foo:bar-2.0 Main'];
const NG_RUN = [
  ...NG_CMD,
  "Exception in thread \"main\" java.lang.NoSuchMethodError: 'void bar.Bar.buz()'",
  '\tat foo.Foo.foo(Foo.java:7)',
  '\tat Main.main(Main.java:3)',
];

const HIERARCHY: { name: string; depth: number; here?: boolean }[] = [
  { name: 'LinkageError', depth: 0 },
  { name: 'NoClassDefFoundError', depth: 1 },
  { name: 'VerifyError', depth: 1 },
  { name: 'IncompatibleClassChangeError', depth: 1 },
  { name: 'NoSuchMethodError', depth: 2, here: true },
  { name: 'NoSuchFieldError', depth: 2 },
  { name: 'IllegalAccessError', depth: 2 },
  { name: 'AbstractMethodError', depth: 2 },
];

function memberLabel(m: Member): string {
  const [params, ret] = prettyDescriptor(m.descriptor).split(' → ');
  return `${showable(m.name)}${params} → ${ret}`;
}

export function mountLinkage(root: HTMLElement, foo: ClassFile, barOld: ClassFile, barNew: ClassFile): void {
  const owner = cpText(barNew, barNew.thisClass);
  const method = foo.methods.find((m) => m.name === 'foo')!;
  const insns = method.attributes.find((a) => a.name === 'Code')!.code!.instructions;
  const refs = insns
    .map((i) => i.cp)
    .filter((cp): cp is number => !!cp)
    .filter((cp) => foo.pool[cp]?.kind === 'Methodref' && cpText(foo, cp).startsWith(owner));
  const classRef = foo.pool.findIndex((e) => e?.kind === 'Class' && cpText(foo, e.index) === owner);
  const ctorRef = refs.find((cp) => cpText(foo, cp).includes('<init>'))!;
  const callRef = refs.find((cp) => cp !== ctorRef)!;
  const callName = cpText(foo, foo.pool[callRef]!.refs[1].index).split(':')[0];
  const natRef = foo.pool[callRef]!.refs[1].index;
  const gone = !barNew.methods.some((m) => m.name === callName);

  const STEPS: Step[] = [
    {
      title: 'ライブラリを組み合わせる',
      body: `\`foo/Foo\` は \`${owner}\` の **1.0** に対してコンパイルされました。ところが実行時のクラスパスに入っているのは **2.0** です。1.0 にあった \`${callName}()\` は、2.0 では名前が変わっています。javac はもう関係ありません。実行するのは、この 2 つの class ファイルです。`,
      tone: 'load',
      bar: 'old',
    },
    {
      title: '1.0 と動かすと、ふつうに動く',
      body: 'クラスパスに 1.0 を置くと、`Foo.foo()` は `bar.Bar#buz` と出力して終わります。ここまでは何も問題がありません。',
      tone: 'exec',
      run: 'old',
      bar: 'old',
    },
    {
      title: '2.0 に差し替えて実行する',
      body: '依存の解決でバージョンが入れ替わり、クラスパスの `bar/Bar` が 2.0 になりました。`Foo.class` は再コンパイルしていません。`Main.main` から `Foo.foo()` が呼ばれます。',
      tone: 'exec',
      run: 'cmd',
      bar: 'new',
      pc: insns[0].pc,
    },
    {
      title: `\`new #${classRef}\` — クラスは見つかる`,
      body: `\`#${classRef}\` は Class エントリで、名前は \`${owner}\` です。クラスパスから 2.0 の \`${owner}\` が見つかり、解決できます。**クラスがあるかどうかの確認は、ここで済んでしまいます**。`,
      tone: 'resolve',
      specs: ['5.4.3.1'],
      pc: insns[0].pc,
      focus: 'class',
      resolved: ['class'],
      run: 'cmd',
      bar: 'new',
    },
    {
      title: `\`invokespecial #${ctorRef}\` — コンストラクタも見つかる`,
      body: `\`${owner}.<init>:()V\` は 2.0 にもあります。解決できるので、インスタンスが作られます。`,
      tone: 'resolve',
      specs: ['5.4.3.3'],
      pc: insns.find((i) => i.cp === ctorRef)!.pc,
      focus: 'ctor',
      resolved: ['class', 'ctor'],
      run: 'cmd',
      bar: 'new',
    },
    {
      title: `\`invokevirtual #${callRef}\` — ここで探しに行く`,
      body: `\`#${callRef}\` は \`${cpText(foo, callRef)}\`。class_index \`#${classRef}\` は解決済みなので、NameAndType \`#${natRef}\` から名前 \`${callName}\` と記述子 \`()V\` を取り出し、\`${owner}\` とその親クラスから探します。`,
      tone: 'resolve',
      specs: ['5.4.3.3'],
      pc: insns.find((i) => i.cp === callRef)!.pc,
      focus: 'ref',
      resolved: ['class', 'ctor'],
      run: 'cmd',
      bar: 'new',
      chain: [
        { text: `class_index \`#${classRef}\` は解決済み → \`${owner}\``, state: 'done' },
        { text: `name_and_type_index \`#${natRef}\` → \`${callName}\` \`()V\``, state: 'done' },
        { text: `\`${owner}\` とその親クラスから探す`, state: 'active' },
      ],
    },
    {
      title: 'どこにもないので NoSuchMethodError',
      body: `2.0 の \`${owner}\` には \`${callName}()\` がありません。親クラス \`java/lang/Object\` にもないので、メソッドの探索は失敗します。JVM は \`NoSuchMethodError\` を投げます。これは \`IncompatibleClassChangeError\` の一種で、**LinkageError** の仲間です。`,
      tone: 'error',
      specs: ['5.4.3.3', '5.4.3'],
      pc: insns.find((i) => i.cp === callRef)!.pc,
      focus: 'ref',
      resolved: ['class', 'ctor'],
      failed: true,
      missing: true,
      bar: 'new',
      run: 'new',
      chain: [
        { text: `class_index \`#${classRef}\` は解決済み → \`${owner}\``, state: 'done' },
        { text: `name_and_type_index \`#${natRef}\` → \`${callName}\` \`()V\``, state: 'done' },
        { text: `\`${owner}\` とその親クラスから探す → 見つからない`, state: 'done' },
        { text: '`NoSuchMethodError` を投げる', state: 'active' },
      ],
    },
    {
      title: '次に同じ命令を実行しても、同じエラー',
      body: '解決に失敗した記号参照は、その後も同じエラーになります。探索をやり直すことはありません。エラーは、その参照を**使う場所**で投げられます。だから呼ばれないメソッドの中にあれば、いつまでも気づけません。',
      tone: 'error',
      specs: ['5.4.3'],
      resolved: ['class', 'ctor'],
      failed: true,
      missing: true,
      bar: 'new',
      run: 'new',
    },
    {
      title: '実行する前に気づくには',
      body: `\`Foo.class\` の定数プールには \`${cpText(foo, callRef)}\` という**名前**が残っています。クラスパスにある class ファイルを読めば、JVM と同じ突き合わせを、実行せずにできます。`,
      tone: 'done',
      specs: ['4.4.2', '5.4.3.3'],
      resolved: ['class', 'ctor'],
      failed: true,
      missing: true,
      bar: 'new',
      run: 'new',
      note: true,
    },
  ];

  const captionTitle = h('h3', { class: 'caption-title' });
  const captionSpecs = h('div', { class: 'caption-specs' });
  const captionBody = h('p', { class: 'caption-body' });
  const caption = h('div', { class: 'panel caption', 'aria-live': 'polite' }, captionTitle, captionSpecs, captionBody);

  const bcList = h('ul', { class: 'bc-list' });
  const poolList = h('ul', { class: 'rcp-list' });
  const oldList = h('div', { class: 'mlist' });
  const newList = h('div', { class: 'mlist' });
  const terminal = h('pre', { class: 'console' });
  const tree = h('div', { class: 'tree' });
  const noteBox = h(
    'div',
    { class: 'panel check-note' },
    h('h3', { class: 'panel-title' }, '先に気づくには'),
    h(
      'p',
      {},
      rich(
        '定数プールに残っているのは名前だけです。だからこそ、実行しなくてもクラスパスと突き合わせれば、同じ検査ができます。ライブラリの新旧を比べて、壊れる参照だけを報告するツールが',
      ),
      h('a', { href: 'https://github.com/exoego/uika', target: '_blank', rel: 'noopener' }, ' Uika '),
      rich('です。PR の時点で `NoSuchMethodError` などを見つけます。'),
    ),
  );

  const fitters: Fitter[] = [];
  const panel = (cls: string, title: string, spec: string | null, body: HTMLElement) => {
    const box = h('div', { class: 'fit-box' }, body);
    fitters.push(fitter(box, body));
    return h(
      'div',
      { class: `panel ${cls}` },
      h(
        'h3',
        { class: 'panel-title' },
        h(
          'span',
          { class: 'pt' },
          title,
          spec
            ? h(
                'a',
                {
                  class: 'pt-spec',
                  href: `https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-${spec.split('.')[0]}.html#jvms-${spec}`,
                  target: '_blank',
                  rel: 'noopener',
                },
                `§${spec}`,
              )
            : null,
        ),
      ),
      box,
    );
  };

  const grid = h(
    'div',
    { class: 'linkage' },
    h('div', { class: 'rt-col' }, panel('grow', 'foo/Foo.class のバイトコード', null, bcList)),
    h('div', { class: 'rt-col' }, panel('grow', 'foo/Foo.class の定数プール', '4.4.2', poolList)),
    h(
      'div',
      { class: 'rt-col' },
      panel('grow', 'コンパイル時の bar/Bar 1.0', null, oldList),
      panel('grow', '実行時の bar/Bar 2.0', null, newList),
    ),
    h(
      'div',
      { class: 'rt-col' },
      panel('run-panel', '実行', null, terminal),
      panel('grow', 'LinkageError の仲間', null, tree),
    ),
  );

  const player = new Player({
    count: STEPS.length,
    dwell: () => 4200,
    onStep: (i) => render(i),
    tick: (i) => `tone-${STEPS[i].tone === 'error' ? 'error' : STEPS[i].tone}`,
    label: (i) => STEPS[i].title.replace(/[`*]/g, ''),
  });

  const head = h('div', { class: 'lk-head' }, caption, noteBox);
  root.append(h('div', { class: 'card fit linkage-card', tabindex: -1 }, head, grid, player.el));
  player.bindKeys(root);

  function renderBytecode(step: Step): void {
    bcList.replaceChildren(
      ...insns.map((insn) =>
        h(
          'li',
          { class: step.pc === insn.pc ? 'cur' : step.pc !== undefined && insn.pc < step.pc ? 'done' : '' },
          h('span', { class: 'pc' }, String(insn.pc)),
          h('span', { class: 'op' }, insn.mnemonic),
          h(
            'span',
            { class: 'cm' },
            insn.cp ? h('span', { class: `cp-ref k-${foo.pool[insn.cp]?.kind}` }, `#${insn.cp}`) : null,
            h('span', { class: 'txt' }, insn.cp ? showable(cpText(foo, insn.cp)) : ''),
          ),
        ),
      ),
    );
  }

  function renderPool(step: Step): void {
    const rows: { key: 'class' | 'ctor' | 'ref'; index: number }[] = [
      { key: 'class', index: classRef },
      { key: 'ctor', index: ctorRef },
      { key: 'ref', index: callRef },
    ];
    poolList.replaceChildren(
      ...rows.map(({ key, index }) => {
        const entry = foo.pool[index]!;
        const failed = key === 'ref' && step.failed;
        const resolved = !failed && step.resolved?.includes(key);
        const focus = step.focus === key;
        return h(
          'li',
          {
            class: `rcp k-${entry.kind} ${failed ? 'failed' : resolved ? 'resolved' : 'unresolved'}${focus ? ' focus open' : ''}`,
            style: '--fc: var(--blue)',
          },
          h(
            'div',
            { class: 'rcp-row' },
            h('span', { class: 'rcp-ix' }, `#${index}`),
            h('span', { class: 'rt', title: showable(cpText(foo, index)) }, showable(cpText(foo, index))),
            h('span', { class: 'state' }, failed ? 'エラー' : resolved ? '解決済み' : '未解決'),
          ),
          focus && step.chain
            ? h(
                'ol',
                { class: 'chain' },
                step.chain.map((c, k) => h('li', { class: c.state, style: `animation-delay:${k * 60}ms` }, h('span', {}, rich(c.text)))),
              )
            : null,
        );
      }),
    );
  }

  function renderMethods(target: HTMLElement, cf: ClassFile, step: Step, side: 'old' | 'new'): void {
    const rows = cf.methods.map((m) =>
      h(
        'div',
        {
          class: `mrow${side === 'old' && m.name === callName ? ' had' : ''}`,
        },
        h('span', { class: 'mname' }, memberLabel(m)),
        side === 'old' && m.name === callName ? h('span', { class: 'mtag' }, 'Foo が呼ぶ相手') : null,
      ),
    );
    if (side === 'new' && gone && step.missing) {
      rows.push(
        h(
          'div',
          { class: 'mrow gone' },
          h('span', { class: 'mname' }, `${callName}() → void`),
          h('span', { class: 'mtag' }, 'ない'),
        ),
      );
    }
    target.className = `mlist${step.bar === side ? ' focus' : ''}`;
    target.replaceChildren(...rows);
  }

  const RUNS = [OK_RUN, NG_RUN, NG_CMD, ['$ _']];

  // 例外が出た行で急に伸びると読みにくいので、一番長い出力に合わせて固定する
  function lockRunHeight(): void {
    terminal.style.height = '';
    const probe = terminal.cloneNode(false) as HTMLElement;
    probe.setAttribute(
      'style',
      `position:absolute;visibility:hidden;left:0;top:0;height:auto;width:${terminal.clientWidth}px`,
    );
    terminal.parentElement?.append(probe);
    let tallest = 0;
    for (const lines of RUNS) {
      probe.replaceChildren(...lines.map((line) => h('span', { class: 'line' }, line)));
      tallest = Math.max(tallest, probe.offsetHeight);
    }
    probe.remove();
    terminal.style.height = `${tallest}px`;
  }

  function renderTerminal(step: Step): void {
    const lines =
      step.run === 'old' ? OK_RUN : step.run === 'new' ? NG_RUN : step.run === 'cmd' ? NG_CMD : ['$ _'];
    terminal.replaceChildren(
      ...lines.map((line, i) =>
        h(
          'span',
          { class: `line${line.startsWith('$') ? ' cmd' : line.includes('NoSuchMethodError') ? ' err' : ''}`, style: `animation-delay:${i * 60}ms` },
          line,
        ),
      ),
    );
  }

  function renderTree(step: Step): void {
    tree.replaceChildren(
      ...HIERARCHY.map((node) =>
        h(
          'div',
          { class: `tnode d${node.depth}${node.here && step.failed ? ' here' : ''}` },
          h('span', {}, node.name),
          node.here && step.failed ? h('span', { class: 'mtag' }, '今回') : null,
        ),
      ),
    );
  }

  function render(i: number): void {
    const step = STEPS[i];
    captionTitle.replaceChildren(
      h('span', { class: `chip tone-${step.tone === 'error' ? 'error' : step.tone}` }, h('i', { class: 'dot' }), TONE_LABEL[step.tone]),
      h('span', {}, rich(step.title)),
    );
    captionBody.replaceChildren(rich(step.body));
    captionSpecs.replaceChildren(...(step.specs ?? []).map((sec) => specLink(sec)));
    renderBytecode(step);
    renderPool(step);
    renderMethods(oldList, barOld, step, 'old');
    renderMethods(newList, barNew, step, 'new');
    renderTerminal(step);
    renderTree(step);
    noteBox.classList.toggle('on', !!step.note);
    fitters.forEach((f) => f.update());
  }

  function lockHeadHeight(): void {
    head.style.height = '';
    const probeTitle = h('h3', { class: 'caption-title' });
    const probeSpecs = h('div', { class: 'caption-specs' });
    const probeBody = h('p', { class: 'caption-body' });
    const probe = h(
      'div',
      { class: 'panel caption', style: `position:absolute;visibility:hidden;left:0;top:0;height:auto;width:${caption.clientWidth}px` },
      probeTitle,
      probeSpecs,
      probeBody,
    );
    head.append(probe);
    let tallest = 0;
    for (const step of STEPS) {
      probeTitle.replaceChildren(h('span', { class: 'chip' }, TONE_LABEL[step.tone]), h('span', {}, rich(step.title)));
      probeBody.replaceChildren(rich(step.body));
      probeSpecs.replaceChildren(...(step.specs ?? []).map((sec) => specLink(sec)));
      tallest = Math.max(tallest, probe.offsetHeight);
    }
    probe.remove();
    noteBox.style.alignSelf = 'start';
    tallest = Math.max(tallest, noteBox.offsetHeight);
    noteBox.style.alignSelf = '';
    head.style.height = `${tallest}px`;
  }

  let lastWidth = 0;
  new ResizeObserver(() => {
    if (head.clientWidth === lastWidth) return;
    lastWidth = head.clientWidth;
    lockHeadHeight();
    lockRunHeight();
    fitters.forEach((f) => f.update());
  }).observe(head);

  render(0);
  lockHeadHeight();
  lockRunHeight();
}
