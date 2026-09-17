import { cpRaw, cpText, CP_SECTION, hexBytes, holdsValue, prettyDescriptor } from '../classfile/describe';
import type { ClassFile, CpEntry, CpKind, Part } from '../classfile/types';
import { fitMode, fitter, h, rich, showable, specLink, svg } from '../ui/dom';
import { hideTooltip, showTooltip } from '../ui/tooltip';
import { buildGraph, edgePath, NODE_H, NODE_W, nodeText } from './graph';

const KIND_DESC: Record<CpKind, string> = {
  Utf8: '文字列そのもの。クラス名、メソッド名、記述子、属性名。名前はすべて、最後はここにたどり着きます。長さ u2 のあとに Modified UTF-8 のバイト列が続きます。',
  Class: 'クラスまたはインターフェースへの参照。中身は名前 (Utf8) の番号だけです。',
  String: '`java.lang.String` の定数。文字そのものは持たず、Utf8 の番号を持ちます。',
  Integer: '4 バイトの int 定数。-32768〜32767 に収まる値は、ふつう命令 (bipush, sipush) に直接埋め込まれるので、ここには入りません。',
  Float: '4 バイトの float 定数 (IEEE 754)。',
  Long: '8 バイトの long 定数。**定数プールの番号を 2 つ使う**ので、次の番号は欠番になります。',
  Double: '8 バイトの double 定数。Long と同じく番号を 2 つ使います。',
  Fieldref: 'フィールドへの参照。「どのクラスの」(class_index) と「どの名前と型の」(name_and_type_index) の 2 つの番号の組です。',
  Methodref: 'クラスのメソッドへの参照。「どのクラスの」と「どの名前と記述子の」の 2 つの番号の組です。',
  InterfaceMethodref: 'インターフェースのメソッドへの参照。形は Methodref と同じです。',
  NameAndType: '名前と記述子の組。どのクラスのものかは持たないので、別々のクラスへの参照からも共有できます。',
  MethodHandle: 'メソッドハンドル。reference_kind が「static メソッドを呼ぶ」「フィールドを読む」などの使い方を表します。',
  MethodType: 'メソッドの型 (記述子) だけを表す定数です。',
  Dynamic: 'ブートストラップメソッドで値を計算する定数 (Java 11〜)。',
  InvokeDynamic: 'invokedynamic 命令の呼び出し地点。呼び出し先を決めるブートストラップメソッドを、BootstrapMethods 属性の番号で指します。',
  Module: 'モジュール名。module-info.class だけで使われます。',
  Package: 'パッケージ名。module-info.class だけで使われます。',
};

const PICKS: { label: string; find: (cf: ClassFile) => number | undefined }[] = [
  { label: 'メソッド呼び出し', find: (cf) => firstInsn(cf, 'invokevirtual') },
  { label: 'System.out', find: (cf) => firstInsn(cf, 'getstatic') },
  { label: '文字列 "JVM"', find: (cf) => firstInsn(cf, 'ldc') },
  { label: 'invokedynamic', find: (cf) => firstInsn(cf, 'invokedynamic') },
  { label: 'Long (2 枠)', find: (cf) => cf.pool.find((e) => e?.kind === 'Long' || e?.kind === 'Double')?.index },
  { label: 'Utf8 "<init>"', find: (cf) => cf.pool.find((e) => e?.kind === 'Utf8' && e.utf8 === '<init>')?.index },
];

function firstInsn(cf: ClassFile, mnemonic: string): number | undefined {
  for (const m of cf.methods) {
    for (const a of m.attributes) {
      const insn = a.code?.instructions.find((i) => i.mnemonic === mnemonic);
      if (insn?.cp) return insn.cp;
    }
  }
  return undefined;
}

function javaForm(cf: ClassFile, entry: CpEntry): string | undefined {
  if (entry.kind !== 'Methodref' && entry.kind !== 'InterfaceMethodref' && entry.kind !== 'Fieldref') return undefined;
  const owner = cpText(cf, entry.refs[0].index).split('/').pop();
  const nat = cf.pool[entry.refs[1].index];
  if (!nat) return undefined;
  const name = cpText(cf, nat.refs[0].index);
  const desc = cpText(cf, nat.refs[1].index);
  if (entry.kind === 'Fieldref') return `${prettyDescriptor(desc)} ${owner}.${name}`;
  const [params, ret] = prettyDescriptor(desc).split(' → ');
  return `${ret} ${owner}.${name}${params}`;
}

function partHex(cf: ClassFile, part: Part): string {
  const n = part.span.end - part.span.start;
  if (n <= 6) return hexBytes(cf.bytes, part.span.start, part.span.end);
  return `${hexBytes(cf.bytes, part.span.start, part.span.start + 5)} … (${n} B)`;
}

export function mountPool(root: HTMLElement, cf: ClassFile, initial?: number): { select: (index: number) => void } {
  const count = cf.poolCount;
  const tiles: HTMLButtonElement[] = [];
  let selected = 0;
  let trail: number[] = [];

  const strip = h('div', { class: 'strip', style: `--n:${count}`, role: 'listbox', 'aria-label': '定数プール' });
  for (let i = 0; i < count; i++) {
    const entry = cf.pool[i];
    const tile = h('button', {
      class: `tile ${entry ? `k-${entry.kind}` : 'void'}`,
      type: 'button',
      'aria-label': entry ? `#${i} ${entry.kind}` : `#${i} 使われない番号`,
    });
    tile.addEventListener('pointerenter', () => {
      const rect = tile.getBoundingClientRect();
      const prev = cf.pool[i - 1];
      const title = entry
        ? `#${i} ${entry.kind}`
        : i === 0
          ? '#0 · 使われない番号'
          : `#${i} · ${prev?.kind} #${i - 1} の 2 枠目`;
      showTooltip(
        rect.left + rect.width / 2,
        rect.top,
        h('div', {}, title),
        entry ? h('div', { class: 'tt-dim' }, cpRaw(cf, i, true).slice(0, 90)) : '',
        entry && !holdsValue(entry) ? h('div', { class: 'tt-dim' }, `たどると ${showable(cpText(cf, i)).slice(0, 80)}`) : '',
      );
    });
    tile.addEventListener('pointerleave', hideTooltip);
    if (entry) tile.addEventListener('click', () => select(i));
    tiles.push(tile);
  }
  strip.append(...tiles);

  const kinds = new Map<CpKind, number>();
  cf.pool.forEach((e) => e && kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1));
  const legend = h(
    'div',
    { class: 'kind-legend' },
    [...kinds].map(([kind, n]) => {
      const chip = h('span', { class: `chip k-${kind}` }, h('i', { class: 'dot' }), kind, h('span', { class: 'mono', style: 'opacity:.7' }, String(n)));
      chip.addEventListener('pointerenter', () => tiles.forEach((t, i) => t.classList.toggle('dim', cf.pool[i]?.kind !== kind)));
      chip.addEventListener('pointerleave', () => tiles.forEach((t) => t.classList.remove('dim')));
      return chip;
    }),
  );

  const pickButtons: { btn: HTMLButtonElement; index?: number }[] = [];
  const picks = h(
    'div',
    { class: 'picks' },
    h('span', { class: 'label' }, 'たどってみる'),
    PICKS.map((p) => {
      const index = p.find(cf);
      if (!index) return null;
      const btn = h('button', { class: 'pick', type: 'button', onclick: () => select(index) }, p.label);
      pickButtons.push({ btn, index });
      return btn;
    }),
  );

  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'たどった経路' });
  const graphWrap = h('div', { class: 'graph-wrap' });
  const inspectorInner = h('div', { class: 'insp-inner' });
  const inspector = h('div', { class: 'panel inspector', 'aria-live': 'polite' }, inspectorInner);
  const inspectorFit = fitter(inspector, inspectorInner);

  root.append(
    h(
      'div',
      { class: 'card fit pool-card' },
      h(
        'div',
        { class: 'pool-top' },
        h('div', { class: 'strip-axis' }, h('span', {}, '#0'), h('span', {}, `constant_pool_count = ${count}`), h('span', {}, `#${count - 1}`)),
        strip,
        legend,
      ),
      h(
        'div',
        { class: 'pool-main' },
        h(
          'div',
          { class: 'panel graph-panel' },
          h('h3', { class: 'panel-title' }, '参照のつながり', crumbs),
          picks,
          graphWrap,
          h('p', { class: 'graph-hint' }, '点線は、このエントリを指している側です。ノードを選ぶと、その先をたどれます。'),
        ),
        inspector,
      ),
    ),
  );

  let graphNodes = new Map<string, HTMLElement>();
  let graphEdges: { el: SVGPathElement; from: string; to: string }[] = [];

  const highlight = (index: number | undefined, on: boolean) => {
    if (index === undefined) return;
    graphNodes.forEach((el, id) => {
      if (id === `cp:${index}`) el.classList.toggle('hot', on);
    });
    graphEdges.forEach((e) => {
      if (e.to === `cp:${index}`) e.el.classList.toggle('hot', on);
    });
  };

  function renderGraph(index: number): void {
    const g = buildGraph(cf, index);
    const nodeById = new Map(g.nodes.map((n) => [n.id, n]));
    const minDepth = Math.min(...g.nodes.map((n) => n.depth));
    const stage = h('div', { class: 'graph', style: `width:${g.width}px;height:${g.height}px` });
    const paths = svg('svg', { width: g.width, height: g.height, viewBox: `0 0 ${g.width} ${g.height}` });
    stage.append(paths);
    graphNodes = new Map();
    graphEdges = [];

    for (const e of g.edges) {
      const a = nodeById.get(e.from)!;
      const b = nodeById.get(e.to)!;
      const { d, mid } = edgePath(a, b);
      const delay = e.ghost ? 0 : (b.depth - minDepth) * 90;
      const path = svg('path', {
        class: `edge${e.ghost ? ' ghost' : ''}`,
        d,
        pathLength: 1,
        style: `animation-delay:${delay}ms`,
      });
      paths.append(path);
      graphEdges.push({ el: path, from: e.from, to: e.to });
      if (e.label) {
        stage.append(
          h('span', { class: 'edge-label', style: `left:${mid[0]}px;top:${mid[1]}px;animation-delay:${delay + 200}ms` }, e.label),
        );
      }
    }

    for (const n of g.nodes) {
      const isRoot = n.id === `cp:${index}`;
      const el = h(
        'button',
        {
          class: `gnode k-${n.kind}${isRoot ? ' root' : ''}${n.ghost ? ' ghost' : ''}`,
          type: 'button',
          style: `left:${n.x}px;top:${n.y}px;width:${NODE_W}px;height:${NODE_H}px;animation-delay:${(n.depth - minDepth) * 90}ms`,
          title: n.resolved ? `${n.raw} → ${n.resolved}` : n.raw,
        },
        h(
          'span',
          { class: 'g1' },
          n.index !== undefined ? h('span', { class: 'ix' }, `#${n.index}`) : null,
          n.kind === 'Bootstrap' ? `BootstrapMethods[${n.bootstrap}]` : n.kind,
        ),
        h('span', { class: 'g2' }, n.raw),
        n.resolved ? h('span', { class: 'g3' }, `→ ${n.resolved}`) : null,
      );
      if (!isRoot && n.index !== undefined) {
        const target = n.index;
        el.addEventListener('click', () => {
          if (n.ghost) select(target);
          else {
            const at = trail.indexOf(index);
            trail = [...trail.slice(0, at + 1), target];
            select(target, false);
          }
        });
      } else if (n.kind === 'Bootstrap') {
        el.style.cursor = 'default';
      }
      graphNodes.set(n.id, el);
      stage.append(el);
    }

    graphWrap.replaceChildren(stage);
    fit(stage);
  }

  function fit(stage: HTMLElement): void {
    const width = parseFloat(stage.style.width);
    const height = parseFloat(stage.style.height);
    const fitting = fitMode();
    const availableW = graphWrap.clientWidth || width;
    const pad = getComputedStyle(graphWrap);
    const availableH = graphWrap.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom);
    const scale = Math.min(1, availableW / width, fitting && availableH > 0 ? availableH / height : 1);
    stage.style.transform = `scale(${scale})`;
    stage.style.marginBottom = `${-(1 - scale) * height}px`;
    stage.style.marginTop = fitting ? `${Math.max(0, (availableH - height * scale) / 2)}px` : '0';
  }

  new ResizeObserver(() => {
    const stage = graphWrap.firstElementChild as HTMLElement | null;
    if (stage) fit(stage);
  }).observe(graphWrap);

  function renderCrumbs(): void {
    crumbs.replaceChildren(
      ...trail.flatMap((index, i) => {
        const entry = cf.pool[index];
        const btn = h(
          'button',
          { type: 'button', 'aria-current': String(index === selected) },
          `#${index} ${entry?.kind ?? ''}`,
        );
        btn.addEventListener('click', () => {
          trail = trail.slice(0, i + 1);
          select(index, false);
        });
        return i === 0 ? [btn] : [h('span', {}, '›'), btn];
      }),
    );
  }

  function renderInspector(entry: CpEntry): void {
    const java = javaForm(cf, entry);
    const text = nodeText(cf, entry.index);
    const raw = holdsValue(entry)
      ? [h('span', { class: 'sum-value' }, cpRaw(cf, entry.index))]
      : entry.parts
          .filter((p) => p.name !== 'tag')
          .flatMap((p, k) => [
            k ? h('span', { class: 'sum-sep' }, '·') : null,
            p.cp
              ? h('button', { class: `cp-ref k-${cf.pool[p.cp]?.kind}`, type: 'button', title: p.name, onclick: () => select(p.cp!) }, `#${p.cp}`)
              : h('span', { class: 'sum-value', title: p.name }, cpRaw(cf, entry.index).split(' · ')[k]),
          ])
          .filter((x): x is HTMLElement => x !== null);
    const nodes: Node[] = [
      h(
        'div',
        { class: 'insp-head' },
        h('span', { class: 'insp-index' }, `#${entry.index}`),
        h('span', { class: `chip k-${entry.kind}` }, h('i', { class: 'dot' }), entry.kind),
        specLink(CP_SECTION[entry.kind]),
      ),
      h(
        'dl',
        { class: 'insp-summary' },
        h('dt', {}, '中身'),
        h('dd', { class: 'sum-raw' }, raw),
        holdsValue(entry) ? null : h('dt', {}, 'たどると'),
        holdsValue(entry) ? null : h('dd', { class: 'insp-text', title: text }, text),
        java ? h('dt', {}, 'Java では') : null,
        java ? h('dd', { class: 'insp-java' }, java) : null,
      ),
      h('p', { class: 'insp-desc' }, rich(KIND_DESC[entry.kind])),
    ];

    const groups = entry.parts.map((part) => {
      const size = part.span.end - part.span.start;
      const group = h(
        'div',
        { class: 'bgroup' },
        h('span', { class: 'hx' }, partHex(cf, part)),
        h('span', { class: 'lb' }, part.name),
        part.cp
          ? h('button', { class: `cp-ref k-${cf.pool[part.cp]?.kind}`, type: 'button', onclick: () => select(part.cp!) }, `#${part.cp}`)
          : h('span', { class: 'vv' }, part.name === 'bytes' && entry.kind === 'Utf8' ? `${size} バイト` : part.value || `${size} バイト`),
      );
      if (part.cp) {
        group.addEventListener('pointerenter', () => highlight(part.cp, true));
        group.addEventListener('pointerleave', () => highlight(part.cp, false));
      }
      return group;
    });
    const bytesSection = h(
      'div',
      { class: 'insp-section' },
      h('h4', {}, `バイト列 · offset ${entry.span.start} · ${entry.span.end - entry.span.start} B`),
      h('div', { class: 'bgroups' }, groups),
    );
    if (entry.kind === 'Utf8') {
      const part = entry.parts.find((p) => p.name === 'bytes')!;
      const str = entry.utf8 ?? '';
      const plain = [...str].every((c) => c.charCodeAt(0) > 0 && c.charCodeAt(0) < 0x80);
      if (plain && str.length) {
        const max = 22;
        const cells: Node[] = [];
        for (let k = 0; k < Math.min(str.length, max); k++) {
          const code = str.charCodeAt(k);
          const special = code < 0x20;
          cells.push(
            h(
              'span',
              { class: `utf8-cell${special ? ' special' : ''}`, style: `animation-delay:${k * 15}ms` },
              h('b', {}, special ? `\\u${code.toString(16).padStart(4, '0')}` : str[k]),
              h('i', {}, cf.bytes[part.span.start + k].toString(16).toUpperCase().padStart(2, '0')),
            ),
          );
        }
        if (str.length > max) cells.push(h('span', { class: 'utf8-cell more' }, h('b', {}, '…'), h('i', {}, `+${str.length - max}`)));
        bytesSection.append(h('div', { class: 'utf8-cells' }, cells));
      }
    }
    nodes.push(bytesSection);

    if (entry.kind === 'Utf8' && entry.utf8?.includes('\u0001')) {
      nodes.push(
        h(
          'div',
          { class: 'callout', style: '--c: var(--pink)' },
          h('div', {}, rich('`\\u0001` は文字列連結のレシピで「ここに引数が入る」という印です。StringConcatFactory がこのレシピを読んで、連結の方法を決めます。')),
        ),
      );
    }
    if (entry.kind === 'Long' || entry.kind === 'Double') {
      nodes.push(
        h(
          'div',
          { class: 'callout', style: '--c: var(--mint)' },
          h('div', {}, rich(`次の \`#${entry.index + 1}\` は番号としては有効ですが、使えない扱いです。仕様書にも「振り返れば、8 バイトの定数に 2 つのエントリを使わせたのはまずい選択だった」とあります (§4.4.5)。`)),
        ),
      );
    }

    const usages = cf.usages.get(entry.index) ?? [];
    const shown = usages.slice(0, 8);
    const rest = usages.slice(8);
    nodes.push(
      h(
        'div',
        { class: 'insp-section' },
        h('h4', {}, `このエントリを使っている場所 · ${usages.length}`),
        usages.length
          ? h(
              'div',
              { class: 'uchips' },
              shown.map((u) => {
                const kind = u.from !== undefined ? '定数プール' : u.pc !== undefined ? 'バイトコード' : 'class ファイルの構造';
                if (u.from === undefined) return h('span', { class: 'uchip', title: kind }, showable(u.label));
                return h('button', { class: 'uchip link', type: 'button', title: kind, onclick: () => select(u.from!) }, showable(u.label));
              }),
              rest.length ? h('span', { class: 'uchip more', title: rest.map((u) => u.label).join('\n') }, `ほか ${rest.length}`) : null,
            )
          : h('p', { class: 'insp-desc' }, 'どこからも参照されていません。'),
      ),
    );

    inspectorInner.replaceChildren(...nodes);
    inspectorFit.update();
  }

  function select(index: number, resetTrail = true): void {
    const entry = cf.pool[index];
    if (!entry) return;
    selected = index;
    if (resetTrail || !trail.includes(index)) {
      if (resetTrail) trail = [index];
    }
    const path = new Set(trail);
    tiles.forEach((t, i) => {
      t.classList.toggle('sel', i === index);
      t.classList.toggle('path', i !== index && path.has(i));
    });
    pickButtons.forEach(({ btn, index: i }) => btn.classList.toggle('on', i === index && trail.length === 1));
    renderCrumbs();
    renderGraph(index);
    renderInspector(entry);
  }

  const start = initial ?? PICKS[0].find(cf) ?? 1;
  select(start);
  return { select };
}
