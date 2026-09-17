import { cpRaw, cpText, holdsValue } from '../classfile/describe';
import type { ClassFile, Instruction, Member } from '../classfile/types';
import { fill, fitter, h, rich, showable, specLink } from '../ui/dom';
import { nodeText } from './graph';

type Origin =
  | { kind: 'thisClass' }
  | { kind: 'superClass' }
  | { kind: 'member'; member: 'field' | 'method'; name: string; attributes?: boolean }
  | { kind: 'insn'; line: number; ops?: string[]; member?: string }
  | { kind: 'attribute'; name: string }
  | { kind: 'utf8'; value: string; label: string };

interface Spot {
  id: string;
  spec: string[];
  line?: number;
  match?: string;
  label?: string;
  title: string;
  note: string;
  origins: Origin[];
}

const SPOTS: Spot[] = [
  {
    id: 'class',
    spec: ['4.1', '4.4.1'],
    line: 1,
    match: 'class Greeter',
    title: 'クラス宣言',
    note: 'クラス名は Class と Utf8 の組で表します。extends を書かなくても、親クラスとして `java/lang/Object` が入ります。',
    origins: [{ kind: 'thisClass' }, { kind: 'superClass' }],
  },
  {
    id: 'constant',
    spec: ['4.7.2', '5.5'],
    line: 2,
    match: 'private static final String GREETING = "Hello, ";',
    title: '定数フィールド',
    note: '値がコンパイル時に決まる `static final` の定数です。値 "Hello, " は **ConstantValue 属性**に入り、クラスを初期化するときにフィールドへ入ります。',
    origins: [{ kind: 'member', member: 'field', name: 'GREETING', attributes: true }],
  },
  {
    id: 'field',
    spec: ['4.5', '4.3.2'],
    line: 4,
    match: 'private final String name;',
    title: 'フィールド宣言',
    note: 'フィールドの名前と型を、2 つの Utf8 で表します。型は `Ljava/lang/String;` という**記述子**の形です。',
    origins: [{ kind: 'member', member: 'field', name: 'name' }],
  },
  {
    id: 'ctor',
    spec: ['2.9.1', '3.8'],
    line: 6,
    match: 'public Greeter(String name)',
    title: 'コンストラクタ',
    note: 'コンストラクタの名前は `<init>` です。書いていない `super()` の呼び出しも javac が入れるので、Object のコンストラクタへの Methodref ができます。',
    origins: [
      { kind: 'member', member: 'method', name: '<init>' },
      { kind: 'insn', line: 6 },
    ],
  },
  {
    id: 'assign',
    spec: ['3.8'],
    line: 7,
    match: 'this.name = name;',
    title: 'フィールドへの代入',
    note: '代入は `putfield` 命令になり、Fieldref を 1 つ使います。その中身の Class や名前は、クラス宣言とフィールド宣言で生まれたエントリの再利用です。',
    origins: [{ kind: 'insn', line: 7 }],
  },
  {
    id: 'greet',
    spec: ['4.6', '4.3.3'],
    line: 10,
    match: 'public String greet()',
    title: 'メソッド宣言',
    note: 'メソッドの名前と記述子。記述子 `()Ljava/lang/String;` は「引数なしで String を返す」という意味です。',
    origins: [{ kind: 'member', member: 'method', name: 'greet' }],
  },
  {
    id: 'concat',
    spec: ['4.4.10', '4.7.23'],
    line: 11,
    match: 'GREETING + name + "!"',
    title: '文字列の連結',
    note: 'Java 9 以降、文字列の `+` は **invokedynamic** になります (JEP 280)。`GREETING` は定数なので、javac は値 "Hello, " をその場に埋め込み、`"Hello, \\u0001!"` という 1 つのレシピにまとめます。バイトコードは GREETING を読みません。`\\u0001` の位置に name の値が入ります。',
    origins: [
      { kind: 'insn', line: 11 },
      { kind: 'attribute', name: 'BootstrapMethods' },
      { kind: 'attribute', name: 'InnerClasses' },
    ],
  },
  {
    id: 'main',
    spec: ['4.3.3'],
    line: 14,
    match: 'public static void main(String[] args)',
    title: 'main メソッド',
    note: '記述子 `([Ljava/lang/String;)V` の `[` は配列を表します。',
    origins: [{ kind: 'member', member: 'method', name: 'main' }],
  },
  {
    id: 'new',
    spec: ['3.8', '3.4'],
    line: 15,
    match: 'new Greeter("JVM")',
    title: 'オブジェクトの生成',
    note: '`new` で領域を確保し、`invokespecial` でコンストラクタを呼びます。文字列 "JVM" は String と Utf8 の 2 つ。Class エントリはクラス宣言のものをそのまま使います。',
    origins: [{ kind: 'insn', line: 15 }],
  },
  {
    id: 'out1',
    spec: ['4.4.2', '6.5.getstatic'],
    line: 16,
    match: 'System.out',
    title: 'static フィールドの読み出し',
    note: '`System.out` は static フィールドなので `getstatic`。Fieldref、Class、NameAndType と、3 つの Utf8 が必要です。',
    origins: [{ kind: 'insn', line: 16, ops: ['getstatic'] }],
  },
  {
    id: 'println1',
    spec: ['3.7'],
    line: 16,
    match: 'println',
    title: 'インスタンスメソッドの呼び出し',
    note: '記述子 `(Ljava/lang/String;)V` は、コンストラクタの記述子とまったく同じ文字列です。だから**同じ Utf8 を共有**します。',
    origins: [{ kind: 'insn', line: 16, ops: ['invokevirtual'], member: 'println' }],
  },
  {
    id: 'greet1',
    spec: ['3.7'],
    line: 16,
    match: 'g.greet()',
    title: '自分のクラスのメソッド呼び出し',
    note: '変数 g の読み出しは `aload_1` で、定数プールは使いません。呼び出しの `invokevirtual` が Methodref を 1 つ使います。',
    origins: [{ kind: 'insn', line: 16, ops: ['aload_1', 'invokevirtual'], member: 'greet' }],
  },
  {
    id: 'out2',
    spec: ['4.4.2', '6.5.getstatic'],
    line: 17,
    match: 'System.out',
    title: '2 回目の System.out',
    note: '16 行目とまったく同じ参照です。命令は増えますが、**定数プールのエントリは 1 つも増えません**。',
    origins: [{ kind: 'insn', line: 17, ops: ['getstatic'] }],
  },
  {
    id: 'println2',
    spec: ['3.7'],
    line: 17,
    match: 'println',
    title: '2 回目の println',
    note: '命令 `invokevirtual` は 2 つ目ですが、指している番号は 16 行目と同じです。',
    origins: [{ kind: 'insn', line: 17, ops: ['invokevirtual'], member: 'println' }],
  },
  {
    id: 'greet2',
    spec: ['3.7'],
    line: 17,
    match: 'g.greet()',
    title: '2 回目の greet()',
    note: '同じ Methodref を指すだけなので、新しいエントリはありません。',
    origins: [{ kind: 'insn', line: 17, ops: ['aload_1', 'invokevirtual'], member: 'greet' }],
  },
  {
    id: 'hidden',
    spec: ['4.7.3', '4.7.12', '4.7.10'],
    label: 'ソースに書いていないもの',
    title: 'ソースに書いていないもの',
    note: '属性の名前も Utf8 です。`Code` や `LineNumberTable` はすべてのメソッドで同じエントリを共有します。SourceFile 属性はファイル名を残します。',
    origins: [
      { kind: 'utf8', value: 'Code', label: 'Code 属性の名前' },
      { kind: 'utf8', value: 'LineNumberTable', label: 'LineNumberTable 属性の名前' },
      { kind: 'attribute', name: 'SourceFile' },
    ],
  },
];

interface Effect {
  entries: Set<number>;
  insns: { method: Member; insn: Instruction }[];
  structs: { label: string; cp: number }[];
}

function closure(cf: ClassFile, index: number, out: Set<number>): void {
  if (!index || out.has(index)) return;
  const entry = cf.pool[index];
  if (!entry) return;
  out.add(index);
  for (const ref of entry.refs) closure(cf, ref.index, out);
  if (entry.bootstrapIndex !== undefined) {
    const bm = cf.attributes.find((a) => a.name === 'BootstrapMethods')?.bootstrapMethods?.[entry.bootstrapIndex];
    if (bm) {
      closure(cf, bm.ref, out);
      bm.args.forEach((a) => closure(cf, a, out));
    }
  }
}

function instructionsOnLine(cf: ClassFile, line: number): { method: Member; insn: Instruction }[] {
  const out: { method: Member; insn: Instruction }[] = [];
  for (const method of cf.methods) {
    const code = method.attributes.find((a) => a.name === 'Code')?.code;
    const table = code?.attributes.find((a) => a.name === 'LineNumberTable')?.lineNumbers;
    if (!code || !table) continue;
    const sorted = [...table].sort((a, b) => a.pc - b.pc);
    for (const insn of code.instructions) {
      let current: number | undefined;
      for (const row of sorted) if (row.pc <= insn.pc) current = row.line;
      if (current === line) out.push({ method, insn });
    }
  }
  return out;
}

function resolveSpot(cf: ClassFile, spot: Spot): Effect {
  const effect: Effect = { entries: new Set(), insns: [], structs: [] };
  const struct = (label: string, cp: number) => {
    if (!cp) return;
    effect.structs.push({ label, cp });
    closure(cf, cp, effect.entries);
  };
  for (const origin of spot.origins) {
    switch (origin.kind) {
      case 'thisClass':
        struct('this_class', cf.thisClass);
        break;
      case 'superClass':
        struct('super_class', cf.superClass);
        break;
      case 'member': {
        const list = origin.member === 'field' ? cf.fields : cf.methods;
        const m = list.find((x) => x.name === origin.name);
        if (!m) break;
        const path = `${origin.member === 'field' ? 'fields' : 'methods'}[${m.index}]`;
        struct(`${path}.name_index`, m.nameIndex);
        struct(`${path}.descriptor_index`, m.descriptorIndex);
        if (origin.attributes) {
          m.attributes.forEach((a, i) => {
            for (const p of a.parts) if (p.cp) struct(`${path}.attributes[${i}].${p.name}`, p.cp);
          });
        }
        break;
      }
      case 'insn': {
        for (const item of instructionsOnLine(cf, origin.line)) {
          if (origin.ops && !origin.ops.includes(item.insn.mnemonic)) continue;
          if (origin.member && item.insn.cp) {
            const entry = cf.pool[item.insn.cp];
            const nat = entry?.refs.find((r) => r.field === 'name_and_type_index');
            const name = nat ? cpText(cf, cf.pool[nat.index]?.refs[0]?.index ?? 0) : '';
            if (name !== origin.member) continue;
          }
          effect.insns.push(item);
          if (item.insn.cp) closure(cf, item.insn.cp, effect.entries);
        }
        break;
      }
      case 'attribute': {
        const i = cf.attributes.findIndex((a) => a.name === origin.name);
        if (i < 0) break;
        for (const p of cf.attributes[i].parts) if (p.cp) struct(`attributes[${i}].${p.name}`, p.cp);
        break;
      }
      case 'utf8': {
        const entry = cf.pool.find((e) => e?.kind === 'Utf8' && e.utf8 === origin.value);
        if (entry) struct(origin.label, entry.index);
        break;
      }
    }
  }
  return effect;
}

const KEYWORDS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'class', 'return', 'new', 'void', 'long',
  'int', 'this', 'extends', 'implements', 'boolean', 'double', 'float', 'char', 'byte', 'short',
]);

export function tokenize(line: string): string[] {
  const classes = new Array<string>(line.length).fill('tok-plain');
  const re = /(\/\/.*$)|("(?:\\.|[^"\\])*")|(\b0x[\dA-Fa-f_]+L?\b|\b\d[\d_]*L?\b)|([A-Za-z_][A-Za-z0-9_]*)|([{}()[\];.,=+])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    let cls = 'tok-plain';
    if (m[1]) cls = 'tok-punc';
    else if (m[2]) cls = 'tok-str';
    else if (m[3]) cls = 'tok-num';
    else if (m[4]) cls = KEYWORDS.has(m[4]) ? 'tok-kw' : /^[A-Z]/.test(m[4]) ? 'tok-type' : 'tok-plain';
    else if (m[5]) cls = 'tok-punc';
    for (let i = m.index; i < m.index + m[0].length; i++) classes[i] = cls;
  }
  return classes;
}

export function mountSource(
  root: HTMLElement,
  cf: ClassFile,
  source: string,
  openInPool: (index: number) => void,
): void {
  const lines = source.replace(/\n$/, '').split('\n');
  const spots = SPOTS.filter((s) => !s.line || lines[s.line - 1]?.includes(s.match!));
  const effects = new Map(spots.map((s) => [s.id, resolveSpot(cf, s)]));

  const owner = new Map<number, Spot>();
  for (const spot of spots) {
    for (const index of effects.get(spot.id)!.entries) if (!owner.has(index)) owner.set(index, spot);
  }

  const hotEls = new Map<string, HTMLElement[]>();
  const lineEls: HTMLElement[] = [];

  const codeInner = h(
    'div',
    { class: 'code-inner' },
    lines.map((text, i) => {
      const lineNo = i + 1;
      const classes = tokenize(text);
      const hot = new Array<string>(text.length).fill('');
      for (const spot of spots) {
        if (spot.line !== lineNo) continue;
        const at = text.indexOf(spot.match!);
        for (let k = at; k < at + spot.match!.length; k++) hot[k] = spot.id;
      }
      const tx = h('span', { class: 'tx' });
      let k = 0;
      while (k < text.length) {
        const spotId = hot[k];
        let end = k;
        while (end < text.length && hot[end] === spotId) end++;
        const container = spotId
          ? h('span', { class: 'hot', 'data-hot': spotId, role: 'button', tabindex: 0 })
          : tx;
        let j = k;
        while (j < end) {
          let e = j;
          while (e < end && classes[e] === classes[j]) e++;
          container.append(h('span', { class: classes[j] }, text.slice(j, e)));
          j = e;
        }
        if (spotId) {
          tx.append(container);
          const list = hotEls.get(spotId) ?? [];
          list.push(container);
          hotEls.set(spotId, list);
        }
        k = end;
      }
      const el = h('span', { class: 'code-line' }, h('span', { class: 'ln' }, String(lineNo)), tx);
      lineEls.push(el);
      return el;
    }),
  );
  const code = h('pre', { class: 'code', 'aria-label': 'Greeter.java' }, codeInner);

  code.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-hot]');
    if (target) activate(target.dataset.hot!);
  });
  code.addEventListener('keydown', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-hot]');
    if (target && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      activate(target.dataset.hot!);
    }
  });
  code.addEventListener('pointerover', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-hot]')?.dataset.hot;
    hotEls.forEach((els, key) => els.forEach((el) => el.classList.toggle('hover', key === id)));
  });
  code.addEventListener('pointerleave', () => hotEls.forEach((els) => els.forEach((el) => el.classList.remove('hover'))));

  const extras = spots.filter((s) => !s.line);
  const extraButtons = new Map<string, HTMLButtonElement>();
  const extraBar = h(
    'div',
    { class: 'source-extras' },
    h('span', { class: 'label' }, 'ほかにも'),
    extras.map((s) => {
      const btn = h('button', { class: 'pick', type: 'button', onclick: () => activate(s.id) }, s.label!);
      extraButtons.set(s.id, btn);
      return btn;
    }),
  );

  const effectsInner = h('div', { class: 'effects-inner' });
  const effectsPanel = h('div', { class: 'panel effects', 'aria-live': 'polite' }, effectsInner);

  root.append(
    h(
      'div',
      { class: 'card fit source-card' },
      h(
        'div',
        { class: 'source' },
        h(
          'div',
          { class: 'panel code-panel', style: 'padding:0;overflow:hidden' },
          h('h3', { class: 'panel-title', style: 'padding:16px 20px 0' }, 'Greeter.java', h('span', { class: 'aside' }, '下線の部分を選べます')),
          code,
          extraBar,
        ),
        effectsPanel,
      ),
    ),
  );
  const codeFit = fitter(code, codeInner);
  const effectsFit = fitter(effectsPanel, effectsInner);

  const ownerLabel = (label: string): string => {
    const head = label.split('.')[0];
    const m = head.match(/^(fields|methods|attributes)\[(\d+)\]$/);
    if (!m) return head;
    const i = Number(m[2]);
    const name = m[1] === 'fields' ? cf.fields[i]?.name : m[1] === 'methods' ? cf.methods[i]?.name : cf.attributes[i]?.name;
    return `${head} ${showable(name ?? '')}`;
  };

  function activate(id: string): void {
    const spot = spots.find((s) => s.id === id)!;
    const effect = effects.get(id)!;
    hotEls.forEach((els, key) => els.forEach((el) => el.classList.toggle('active', key === id)));
    extraButtons.forEach((btn, key) => btn.classList.toggle('on', key === id));
    lineEls.forEach((el, i) => el.classList.toggle('lit', i + 1 === spot.line));

    const entries = [...effect.entries].sort((a, b) => a - b);
    const fresh = entries.filter((i) => owner.get(i)?.id === id);
    const spotOrder = spots.indexOf(spot);

    const hint = 'エントリにカーソルを合わせると中身を表示します。選ぶと 02 で開きます。';
    const detail = h('p', { class: 'entry-detail' }, hint);
    const chips = entries.map((index, k) => {
      const entry = cf.pool[index]!;
      const first = owner.get(index)!;
      const isNew = first.id === id;
      const note = isNew
        ? '新規'
        : spots.indexOf(first) < spotOrder
          ? first.line
            ? `${first.line} 行目と共有`
            : `${first.title}と共有`
          : '共有';
      const chip = h(
        'button',
        { class: `echip k-${entry.kind}${isNew ? ' new' : ''}`, type: 'button', style: `animation-delay:${k * 18}ms` },
        `#${index}`,
      );
      const show = () =>
        fill(
          detail,
          h('span', { class: `kd k-${entry.kind}` }, `#${index} ${entry.kind}`),
          h('span', { class: 'raw' }, cpRaw(cf, index)),
          holdsValue(entry) ? null : h('span', { class: 'tx' }, `→ ${nodeText(cf, index)}`),
          h('span', { class: `badge ${isNew ? 'new' : 'shared'}` }, note),
        );
      chip.addEventListener('pointerenter', show);
      chip.addEventListener('focus', show);
      chip.addEventListener('pointerleave', () => fill(detail, hint));
      chip.addEventListener('click', () => openInPool(index));
      return chip;
    });

    const tiles: HTMLElement[] = [];
    for (let i = 0; i < cf.poolCount; i++) {
      const entry = cf.pool[i];
      const on = effect.entries.has(i);
      const cls = !entry ? 'void' : on ? (owner.get(i)?.id === id ? 'on' : 'old') : '';
      tiles.push(h('span', { class: `tile ${entry ? `k-${entry.kind}` : ''} ${cls}` }));
    }

    const groups = new Map<string, { label: string; cp: number }[]>();
    for (const st of effect.structs) {
      const key = ownerLabel(st.label);
      const list = groups.get(key) ?? [];
      list.push(st);
      groups.set(key, list);
    }

    fill(
      effectsInner,
      h(
        'div',
        { class: 'effects-head' },
        h('h3', {}, spot.title),
        h('p', { class: 'sub' }, spot.line ? `${spot.line} 行目 · ${showable(spot.match!)}` : 'javac が付け足すもの'),
        h(
          'div',
          { class: 'spec-row' },
          spot.spec.map((sec) => {
            const name = sec.split('.')[2];
            return specLink(sec, name && Number.isNaN(Number(name)) ? `§6.5 ${name}` : `§${sec}`);
          }),
        ),
      ),
      h(
        'div',
        { class: 'stats-line' },
        h('span', { class: 'stat fresh' }, h('b', {}, String(fresh.length)), '新規'),
        h('span', { class: 'stat' }, h('b', {}, String(entries.length - fresh.length)), '共有'),
        h('span', { class: 'stat' }, h('b', {}, String(effect.insns.length)), '命令'),
      ),
      h('div', { class: 'callout', style: '--c: var(--orange)' }, h('div', {}, rich(spot.note))),
      h('div', { class: 'strip mini-strip', style: `--n:${cf.poolCount}` }, tiles),
      effect.insns.length
        ? h(
            'div',
            { class: 'insp-section' },
            h('h4', {}, 'バイトコード'),
            h(
              'ul',
              { class: 'insn-list' },
              effect.insns.map(({ method, insn }, k) =>
                h(
                  'li',
                  { style: `animation-delay:${k * 40}ms` },
                  h('span', { class: 'm' }, showable(method.name)),
                  h('span', { class: 'pc' }, String(insn.pc)),
                  h('span', { class: 'op' }, insn.mnemonic),
                  insn.cp
                    ? h('span', { class: 'ref' }, h('span', { class: `cp-ref k-${cf.pool[insn.cp]?.kind}` }, `#${insn.cp}`), h('span', { class: 'tx' }, nodeText(cf, insn.cp)))
                    : h('span', { class: 'm' }, '定数プールは使わない'),
                ),
              ),
            ),
          )
        : null,
      groups.size
        ? h(
            'div',
            { class: 'insp-section' },
            h('h4', {}, 'class ファイルの構造から'),
            h(
              'ul',
              { class: 'struct-groups' },
              [...groups].map(([key, list], k) =>
                h(
                  'li',
                  { style: `animation-delay:${k * 40}ms` },
                  h('span', { class: 'owner' }, key),
                  h(
                    'span',
                    { class: 'refs' },
                    list.map((st) =>
                      h('span', { class: `cp-ref k-${cf.pool[st.cp]?.kind}`, title: `${st.label} → ${nodeText(cf, st.cp)}` }, `#${st.cp}`),
                    ),
                  ),
                ),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'insp-section' },
        h('h4', {}, `使うエントリ · ${entries.length}`),
        entries.length ? h('div', { class: 'echips' }, chips) : h('p', { class: 'insp-desc' }, 'ありません。'),
        entries.length ? detail : null,
      ),
    );
    effectsFit.update();
    codeFit.update();
  }

  activate(spots.find((s) => s.id === 'greet1')?.id ?? spots[0].id);
}
