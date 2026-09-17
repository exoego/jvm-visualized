import { cpText } from '../classfile/describe';
import type { ClassFile, Instruction } from '../classfile/types';
import {
  simulate,
  type Frame,
  type HeapObject,
  type RcpRow,
  type Snapshot,
  type Tone,
  type Value,
} from '../runtime/machine';
import { fill, fitter, h, rich, showable, specLink, svg, type Fitter } from '../ui/dom';
import { Player } from '../ui/player';

const TONE_LABEL: Record<Tone, string> = {
  load: 'ロード',
  resolve: '解決',
  cache: '解決済みを再利用',
  exec: '実行',
  invoke: '呼び出し',
  static: '静的定数',
  done: '完了',
};

const PHASE = ['', 'ロード済み', 'リンク済み', '初期化済み'];

const simple = (name: string) => name.split('/').pop() ?? name;

function operandText(cf: ClassFile, insn: Instruction): string {
  if (!insn.cp) return '';
  const entry = cf.pool[insn.cp];
  if (!entry) return '';
  const text = cpText(cf, insn.cp);
  switch (entry.kind) {
    case 'Class':
      return simple(text);
    case 'String':
      return `"${text}"`;
    case 'Fieldref':
    case 'Methodref':
    case 'InterfaceMethodref': {
      const [owner, rest] = text.split('.');
      return `${simple(owner)}.${rest.split(':')[0]}`;
    }
    case 'InvokeDynamic':
      return text.split(':')[1] ?? text;
    default:
      return text;
  }
}

function sameValue(a: Value | null | undefined, b: Value | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.t !== b.t) return false;
  return a.t === 'null' || (b.t === 'ref' && a.id === b.id);
}

export function mountRuntime(root: HTMLElement, cf: ClassFile): void {
  const snapshots = simulate(cf);
  const methodOrder = cf.methods
    .filter((m) => m.attributes.some((a) => a.name === 'Code'))
    .map((m) => m.name)
    .sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : 0));
  const code = new Map(
    cf.methods.map((m) => [m.name, m.attributes.find((a) => a.name === 'Code')?.code?.instructions ?? []]),
  );

  let viewMethod = 'main';
  let current = 0;
  let previous = -1;

  const captionTitle = h('h3', { class: 'caption-title' });
  const captionBody = h('p', { class: 'caption-body' });
  const captionSpecs = h('div', { class: 'caption-specs' });
  const caption = h('div', { class: 'panel caption', 'aria-live': 'polite' }, captionTitle, captionSpecs, captionBody);

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'メソッド' });
  const segButtons = new Map<string, HTMLButtonElement>();
  for (const name of methodOrder) {
    const btn = h('button', { type: 'button', 'aria-pressed': 'false' }, showable(name));
    btn.addEventListener('click', () => {
      viewMethod = name;
      renderBytecode(snapshots[current]);
      fitters.forEach((f) => f.update());
      drawLinks(snapshots[current], false);
    });
    segButtons.set(name, btn);
    seg.append(btn);
  }

  const bcList = h('ul', { class: 'bc-list' });
  const framesEl = h('div', { class: 'frames' });
  const rcpList = h('ul', { class: 'rcp-list' });
  const stats = h('span', { class: 'rt-legend' });
  const classesEl = h('div', { class: 'classes' });
  const heapEl = h('div', { class: 'heap' });
  const consoleEl = h('pre', { class: 'console' });
  const fitters: Fitter[] = [];

  const panel = (cls: string, title: string, spec: string | null, aside: Node | string | null, body: HTMLElement) => {
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
                  title: `JVMS §${spec}`,
                },
                `§${spec}`,
              )
            : null,
        ),
        aside ? h('span', { class: `aside${aside === seg ? ' keep' : ''}` }, aside) : null,
      ),
      box,
    );
  };

  const links = svg('svg', { class: 'links', 'aria-hidden': 'true' });
  const grid = h(
    'div',
    { class: 'runtime' },
    h('div', { class: 'rt-col' }, panel('grow bc-panel', 'バイトコード', null, seg, bcList)),
    h(
      'div',
      { class: 'rt-col' },
      panel('grow', 'Java スタック · フレーム', '2.6', '上が実行中', framesEl),
      panel('classes-panel', 'メソッド領域 · クラス', '2.5.4', null, classesEl),
    ),
    h(
      'div',
      { class: 'rt-col' },
      panel('grow', 'ヒープ', '2.5.3', null, heapEl),
      panel('console-panel', '標準出力', null, null, consoleEl),
    ),
    h('div', { class: 'rt-col' }, panel('grow', '実行時定数プール', '2.5.5', stats, rcpList)),
  );

  const player = new Player({
    count: snapshots.length,
    dwell: (i) => (snapshots[i].tone === 'resolve' || snapshots[i].tone === 'invoke' ? 4200 : 3000),
    onStep: (i, prev) => {
      previous = prev;
      current = i;
      render();
    },
    tick: (i) => (snapshots[i].tone === 'resolve' ? 'tone-resolve' : snapshots[i].tone === 'cache' ? 'tone-cache' : undefined),
    label: (i) => snapshots[i].title.replace(/[`*]/g, ''),
    speeds: [1, 2, 0.5],
  });

  const wrap = h('div', { class: 'rt-wrap' }, caption, grid, links);
  root.append(h('div', { class: 'card fit runtime-card', tabindex: -1 }, wrap, player.el));
  player.bindKeys(root);

  function valueChip(v: Value | null | undefined, heap: HeapObject[], enter: boolean): HTMLElement {
    if (!v || v.t === 'null') return h('span', { class: `value v-null${enter ? ' enter' : ''}` }, 'null');
    const o = heap.find((x) => x.id === v.id);
    const type = o?.type ?? 'Object';
    const label = o?.type === 'String' ? `"${o.text}"` : `${simple(o?.className ?? '?')}@${v.id}`;
    return h('span', { class: `value v-${type}${enter ? ' enter' : ''}`, title: label }, label);
  }

  function renderCaption(s: Snapshot): void {
    captionTitle.replaceChildren(
      h('span', { class: `chip tone-${s.tone}` }, h('i', { class: 'dot' }), TONE_LABEL[s.tone]),
      h('span', {}, rich(s.title)),
    );
    captionBody.replaceChildren(rich(s.body));
    captionSpecs.replaceChildren(
      ...s.specs.map((sec) => {
        const name = sec.split('.')[2];
        return specLink(sec, name && Number.isNaN(Number(name)) ? `§6.5 ${name.replace('_n', '_<n>')}` : `§${sec}`);
      }),
    );
  }

  function renderBytecode(s: Snapshot): void {
    segButtons.forEach((btn, name) => btn.setAttribute('aria-pressed', String(name === viewMethod)));
    const insns = code.get(viewMethod) ?? [];
    bcList.replaceChildren(
      ...insns.map((insn) => {
        const here = s.method === viewMethod && s.pc === insn.pc;
        const done = s.method === viewMethod && s.pc !== undefined && insn.pc < s.pc;
        return h(
          'li',
          { class: here ? 'cur' : done ? 'done' : '', 'data-key': `insn:${viewMethod}:${insn.pc}` },
          h('span', { class: 'pc' }, String(insn.pc)),
          h('span', { class: 'op' }, insn.mnemonic),
          h(
            'span',
            { class: 'cm' },
            insn.cp ? h('span', { class: `cp-ref k-${cf.pool[insn.cp]?.kind}` }, `#${insn.cp}`) : null,
            h('span', { class: 'txt' }, showable(operandText(cf, insn))),
          ),
        );
      }),
    );
  }

  function renderFrames(s: Snapshot, prev?: Snapshot): void {
    const frames = s.frames.map((f, i) => ({ f, i })).reverse();
    if (!frames.length) {
      framesEl.replaceChildren(h('p', { class: 'empty-note' }, 'フレームはありません。'));
      return;
    }
    framesEl.replaceChildren(
      ...frames.map(({ f, i }) => {
        const top = i === s.frames.length - 1;
        const before: Frame | undefined = prev?.frames[i]?.method === f.method ? prev.frames[i] : undefined;
        const slots: HTMLElement[] = [];
        for (let k = f.maxStack - 1; k >= 0; k--) {
          const v = f.stack[k];
          slots.push(
            v
              ? h('div', { class: 'slot' }, valueChip(v, s.heap, !sameValue(v, before?.stack[k])))
              : h('div', { class: 'slot empty' }),
          );
        }
        return h(
          'div',
          { class: `frame${top ? ' top' : ''}`, 'data-key': `frame:${i}` },
          h(
            'div',
            { class: 'frame-head' },
            h('span', { class: 'fm' }, showable(f.display)),
            h('span', { class: 'fp' }, top ? `pc ${s.method === f.method && s.pc !== undefined ? s.pc : f.pc}` : `戻り先 pc ${f.pc}`),
          ),
          h(
            'div',
            { class: 'frame-body' },
            h(
              'div',
              {},
              h('h5', {}, 'ローカル変数'),
              h(
                'div',
                { class: 'slots' },
                f.locals.map((v, k) =>
                  h(
                    'div',
                    { class: `slot${v ? '' : ' empty'}` },
                    h('span', { class: 'si' }, String(k)),
                    v ? valueChip(v, s.heap, !sameValue(v, before?.locals[k])) : '',
                  ),
                ),
              ),
            ),
            h('div', {}, h('h5', {}, `オペランドスタック · ${f.maxStack}`), h('div', { class: 'slots' }, slots)),
          ),
        );
      }),
    );
  }

  function stateLabel(row: RcpRow): string {
    return row.state === 'resolved' ? '解決済み' : row.state === 'static' ? '静的定数' : '未解決';
  }

  function renderRcp(s: Snapshot, prev?: Snapshot): void {
    fill(
      stats,
      h('span', { class: 'tone-resolve', title: '解決した回数' }, h('i', { class: 'dot' }), '解決 ', h('b', {}, String(s.resolutions))),
      h('span', { class: 'tone-cache', title: '解決済みの結果を再利用した回数' }, h('i', { class: 'dot' }), '再利用 ', h('b', {}, String(s.hits))),
    );
    if (!s.rcp.length) {
      rcpList.replaceChildren(h('li', { class: 'empty-note' }, 'クラスがロードされると、ここにできます。'));
      return;
    }
    const focusRow = s.rcp.find((r) => r.index === s.focusCp);
    const host = s.chainCp ?? focusRow?.parent ?? s.focusCp;
    const tint = `var(--${s.tone === 'cache' ? 'green' : s.tone === 'static' ? 'yellow' : 'blue'})`;
    const changed = (row: RcpRow) => {
      const was = prev?.rcp.find((r) => r.index === row.index);
      return !!was && was.state !== 'resolved' && row.state === 'resolved';
    };

    rcpList.replaceChildren(
      ...s.rcp
        .filter((row) => row.parent === undefined)
        .map((row) => {
          const children = s.rcp.filter((c) => c.parent === row.index);
          const open = host === row.index;
          const focus = s.focusCp === row.index;
          const resolvedText = row.state !== 'unresolved' && row.result ? row.result : undefined;
          return h(
            'li',
            {
              class: `rcp k-${row.kind} ${row.state}${focus ? ' focus' : ''}${open && !focus ? ' host' : ''}${changed(row) ? ' flash' : ''}${open ? ' open' : ''}`,
              style: `--fc: ${tint}`,
              'data-key': `cp:${row.index}`,
            },
            h(
              'div',
              { class: 'rcp-row' },
              h('span', { class: 'rcp-ix' }, `#${row.index}`),
              h(
                'span',
                { class: `rt${resolvedText && !open ? ' result' : ''}`, title: `${row.kind} ${showable(row.text)}` },
                showable(resolvedText && !open ? `→ ${resolvedText}` : row.text),
              ),
              children.length
                ? h(
                    'span',
                    { class: 'rcp-kids' },
                    children.map((c) =>
                      h(
                        'span',
                        {
                          class: `kid k-${c.kind} ${c.state}${s.focusCp === c.index ? ' focus' : ''}${changed(c) ? ' flash' : ''}`,
                          'data-key': `cp:${c.index}`,
                          title: `#${c.index} ${c.kind} ${showable(c.text)} · ${stateLabel(c)}`,
                        },
                        `#${c.index}`,
                      ),
                    ),
                  )
                : null,
              h('span', { class: 'state' }, stateLabel(row)),
            ),
            open && resolvedText ? h('div', { class: 'rcp-result' }, `→ ${showable(resolvedText)}`) : null,
            open && s.chain
              ? h(
                  'ol',
                  { class: 'chain' },
                  s.chain.map((c, k) => h('li', { class: c.state, style: `animation-delay:${k * 60}ms` }, h('span', {}, rich(c.text)))),
                )
              : null,
          );
        }),
    );
  }

  function renderClasses(s: Snapshot, prev?: Snapshot): void {
    const grouped = s.classes.filter((c) => c.jdk && c.phase === 3 && !s.focusClasses?.includes(c.name));
    const rows: HTMLElement[] = [];
    if (grouped.length) {
      rows.push(
        h(
          'div',
          { class: 'cls jdk group', style: 'animation:none', title: 'ブートストラップ・ローダーでロード済み · 初期化済み' },
          h(
            'div',
            { class: 'cls-head' },
            h(
              'span',
              { class: 'cls-name' },
              h('span', { class: 'group-label' }, 'JDK'),
              grouped.map((c) => h('span', { class: 'group-name', 'data-key': `class:${c.name}` }, simple(c.name))),
            ),
            h('span', { class: 'phases' }, [1, 2, 3].map(() => h('i', { class: 'on' }))),
          ),
        ),
      );
    }
    for (const c of s.classes) {
      if (grouped.includes(c)) continue;
      const was = prev?.classes.find((x) => x.name === c.name);
      const focus = s.focusClasses?.includes(c.name);
      rows.push(
        h(
          'div',
          {
            class: `cls${c.jdk ? ' jdk' : ''}${focus ? ' focus' : ''}`,
            'data-key': `class:${c.name}`,
            style: was ? 'animation:none' : '',
            title: `${c.name} · ${c.loader}・ローダー · ${PHASE[c.phase]}`,
          },
          h(
            'div',
            { class: 'cls-head' },
            h('span', { class: 'cls-name' }, c.jdk ? c.name : simple(c.name)),
            h('span', { class: 'phases' }, [1, 2, 3].map((p) => h('i', { class: c.phase >= p ? 'on' : '' }))),
          ),
          h(
            'div',
            { class: 'cls-meta' },
            `${c.loader}・ローダー · ${PHASE[c.phase]}`,
            c.statics?.map((st) => {
              const old = was?.statics?.find((x) => x.name === st.name);
              return h(
                'span',
                { class: 'statics' },
                `${st.name} = `,
                h('span', { class: `sv${old && old.value !== st.value ? ' changed' : ''}` }, st.value),
              );
            }),
          ),
        ),
      );
    }
    classesEl.replaceChildren(...rows);
  }

  function renderHeap(s: Snapshot, prev?: Snapshot): void {
    heapEl.replaceChildren(
      ...s.heap.map((o) => {
        const isNew = !prev?.heap.some((x) => x.id === o.id);
        const focus = s.focusHeap?.includes(o.id);
        let body = '';
        if (o.type === 'String') body = `"${o.text}"`;
        else if (o.fields) body = o.fields.map((f) => `${f.name} = ${f.value.t === 'null' ? 'null' : labelOf(s.heap, f.value.id)}`).join(', ');
        else if (o.text) body = o.text;
        return h(
          'div',
          {
            class: `obj v-${o.type}${o.pre ? ' pre' : ''}${isNew && prev ? ' enter' : ''}${focus ? ' focus' : ''}`,
            'data-key': `heap:${o.id}`,
            title: [simple(o.className), `@${o.id}`, body, o.tag].filter(Boolean).join(' '),
          },
          h('span', { class: 'obj-type' }, simple(o.className)),
          h('span', { class: 'oid' }, `@${o.id}`),
          h('span', { class: 'obj-body' }, body),
          o.tag ? h('span', { class: 'obj-tag' }, o.tag) : null,
        );
      }),
    );
  }

  function labelOf(heap: HeapObject[], id: number): string {
    const o = heap.find((x) => x.id === id);
    return o?.type === 'String' ? `"${o.text}"` : `${simple(o?.className ?? '?')}@${id}`;
  }

  function renderConsole(s: Snapshot, prev?: Snapshot): void {
    const before = prev?.console.length ?? 0;
    fill(
      consoleEl,
      h('span', { class: 'line' }, h('span', { class: 'prompt' }, '$ '), 'java Greeter'),
      ...s.console.map((line, i) => h('span', { class: `line${i >= before && prev ? ' enter' : ''}` }, line)),
      s.frames.length ? h('span', { class: 'cursor' }) : null,
    );
    consoleEl.setAttribute('data-key', 'console');
  }

  function drawLinks(s: Snapshot, animate: boolean): void {
    links.replaceChildren();
    links.classList.toggle('static', !animate);
    const box = wrap.getBoundingClientRect();
    links.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    for (const link of s.links) {
      const a = wrap.querySelector<HTMLElement>(`[data-key="${link.from}"]`);
      const b = wrap.querySelector<HTMLElement>(`[data-key="${link.to}"]`);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const ax = ra.left - box.left;
      const ay = ra.top - box.top;
      const bx = rb.left - box.left;
      const by = rb.top - box.top;
      const ha = Math.min(ra.height, 30);
      const hb = Math.min(rb.height, 30);
      let x0: number, y0: number, x1: number, y1: number, d: string;
      if (ra.right <= rb.left) {
        x0 = ax + ra.width;
        y0 = ay + ha / 2;
        x1 = bx;
        y1 = by + hb / 2;
        const k = Math.max(30, (x1 - x0) / 2);
        d = `M${x0},${y0} C${x0 + k},${y0} ${x1 - k},${y1} ${x1},${y1}`;
      } else if (rb.right <= ra.left) {
        x0 = ax;
        y0 = ay + ha / 2;
        x1 = bx + rb.width;
        y1 = by + hb / 2;
        const k = Math.max(30, (x0 - x1) / 2);
        d = `M${x0},${y0} C${x0 - k},${y0} ${x1 + k},${y1} ${x1},${y1}`;
      } else {
        const down = rb.top >= ra.bottom;
        x0 = ax + Math.min(ra.width - 12, 28);
        y0 = down ? ay + ra.height : ay;
        x1 = bx + Math.min(rb.width - 12, 28);
        y1 = down ? by : by + rb.height;
        const k = Math.max(24, Math.abs(y1 - y0) / 2);
        d = `M${x0},${y0} C${x0 - k},${y0 + (down ? k : -k)} ${x1 - k},${y1 - (down ? k : -k)} ${x1},${y1}`;
      }
      const tone = `var(--${s.tone === 'cache' ? 'green' : s.tone === 'static' ? 'yellow' : s.tone === 'invoke' ? 'orange' : s.tone === 'load' ? 'purple' : 'blue'})`;
      links.append(
        svg('path', { d, pathLength: 1, style: `--c:${tone}` }),
        svg('circle', { cx: x1, cy: y1, r: 3, style: `--c:${tone}` }),
      );
    }
  }

  let token = 0;

  function render(): void {
    const s = snapshots[current];
    const prev = previous >= 0 && Math.abs(previous - current) === 1 ? snapshots[previous] : undefined;
    if (s.method) viewMethod = s.method;
    renderCaption(s);
    renderBytecode(s);
    renderFrames(s, prev);
    renderRcp(s, prev);
    renderClasses(s, prev);
    renderHeap(s, prev);
    renderConsole(s, prev);
    fitters.forEach((f) => f.update());
    links.replaceChildren();
    const mine = ++token;
    requestAnimationFrame(() => {
      if (mine === token) drawLinks(s, true);
    });
  }

  let lastSize = '';
  new ResizeObserver(() => {
    const size = `${wrap.clientWidth}x${wrap.clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    fitters.forEach((f) => f.update());
    drawLinks(snapshots[current], false);
  }).observe(wrap);
  render();
}
