import { cpText, prettyDescriptor } from '../classfile/describe';
import type { ClassFile, Member } from '../classfile/types';
import copyText from '../copy/05-linkage.md?raw';
import { loadCopy } from '../ui/copy';
import { fitter, h, rich, showable, specLink, type Fitter } from '../ui/dom';
import { Player } from '../ui/player';

const copy = loadCopy(copyText, '05-linkage');

type Tone = 'load' | 'resolve' | 'exec' | 'error' | 'done';

const TONE_LABEL: Record<Tone, string> = {
  load: '構成',
  resolve: '解決',
  exec: '実行',
  error: 'エラー',
  done: '検出',
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

  const params = { owner, method: callName, classRef, ctorRef, callRef, natRef, ref: cpText(foo, callRef) };
  const STEPS: Step[] = [
    {
      ...copy.step('versions', params),
      tone: 'load',
      bar: 'old',
    },
    {
      ...copy.step('run-old'),
      tone: 'exec',
      run: 'old',
      bar: 'old',
    },
    {
      ...copy.step('run-new'),
      tone: 'exec',
      run: 'cmd',
      bar: 'new',
      pc: insns[0].pc,
    },
    {
      ...copy.step('new', params),
      tone: 'resolve',
      specs: ['5.4.3.1'],
      pc: insns[0].pc,
      focus: 'class',
      resolved: ['class'],
      run: 'cmd',
      bar: 'new',
    },
    {
      ...copy.step('ctor', params),
      tone: 'resolve',
      specs: ['5.4.3.3'],
      pc: insns.find((i) => i.cp === ctorRef)!.pc,
      focus: 'ctor',
      resolved: ['class', 'ctor'],
      run: 'cmd',
      bar: 'new',
    },
    {
      ...copy.step('call', params),
      tone: 'resolve',
      specs: ['5.4.3.3'],
      pc: insns.find((i) => i.cp === callRef)!.pc,
      focus: 'ref',
      resolved: ['class', 'ctor'],
      run: 'cmd',
      bar: 'new',
      chain: [
        { text: copy.title('chain-class', params), state: 'done' },
        { text: copy.title('chain-nat', params), state: 'done' },
        { text: copy.title('chain-lookup', params), state: 'active' },
      ],
    },
    {
      ...copy.step('error', params),
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
        { text: copy.title('chain-class', params), state: 'done' },
        { text: copy.title('chain-nat', params), state: 'done' },
        { text: copy.title('chain-missing', params), state: 'done' },
        { text: copy.title('chain-throw'), state: 'active' },
      ],
    },
    {
      ...copy.step('again'),
      tone: 'error',
      specs: ['5.4.3'],
      resolved: ['class', 'ctor'],
      failed: true,
      missing: true,
      bar: 'new',
      run: 'new',
    },
    {
      ...copy.step('detect', params),
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
    h('h3', { class: 'panel-title' }, copy.title('note')),
    h('p', {}, rich(copy.body('note'))),
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
      panel('grow', 'LinkageError の階層', null, tree),
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
        side === 'old' && m.name === callName ? h('span', { class: 'mtag' }, 'Foo が参照') : null,
      ),
    );
    if (side === 'new' && gone && step.missing) {
      rows.push(
        h(
          'div',
          { class: 'mrow gone' },
          h('span', { class: 'mname' }, `${callName}() → void`),
          h('span', { class: 'mtag' }, '2.0 にはない'),
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
          node.here && step.failed ? h('span', { class: 'mtag' }, '今回の例外') : null,
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
