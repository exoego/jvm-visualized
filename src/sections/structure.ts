import {
  accessFlagNames,
  ATTRIBUTE_SECTION,
  cpRaw,
  cpText,
  hex,
  hexBytes,
  javaVersion,
  prettyDescriptor,
} from '../classfile/describe';
import type { Attribute, ClassFile, CpEntry, Member, Part, TopItem } from '../classfile/types';
import copyText from '../copy/structure.md?raw';
import { loadCopy } from '../ui/copy';
import { FIT_QUERY, fitMode, fitter, h, reducedMotion, rich, showable, specLink } from '../ui/dom';
import { Player } from '../ui/player';
import { onceVisible } from '../ui/reveal';
import { hideTooltip, showTooltip } from '../ui/tooltip';

const LINES: { key: string; type: string; name: string; section: TopItem['section'] }[] = [
  { key: 'magic', type: 'u4', name: 'magic', section: 'header' },
  { key: 'minor_version', type: 'u2', name: 'minor_version', section: 'header' },
  { key: 'major_version', type: 'u2', name: 'major_version', section: 'header' },
  { key: 'constant_pool_count', type: 'u2', name: 'constant_pool_count', section: 'pool' },
  { key: 'constant_pool', type: 'cp_info', name: 'constant_pool[constant_pool_count-1]', section: 'pool' },
  { key: 'access_flags', type: 'u2', name: 'access_flags', section: 'class' },
  { key: 'this_class', type: 'u2', name: 'this_class', section: 'class' },
  { key: 'super_class', type: 'u2', name: 'super_class', section: 'class' },
  { key: 'interfaces_count', type: 'u2', name: 'interfaces_count', section: 'interfaces' },
  { key: 'interfaces', type: 'u2', name: 'interfaces[interfaces_count]', section: 'interfaces' },
  { key: 'fields_count', type: 'u2', name: 'fields_count', section: 'fields' },
  { key: 'fields', type: 'field_info', name: 'fields[fields_count]', section: 'fields' },
  { key: 'methods_count', type: 'u2', name: 'methods_count', section: 'methods' },
  { key: 'methods', type: 'method_info', name: 'methods[methods_count]', section: 'methods' },
  { key: 'attributes_count', type: 'u2', name: 'attributes_count', section: 'attributes' },
  { key: 'attributes', type: 'attribute_info', name: 'attributes[attributes_count]', section: 'attributes' },
];

const copy = loadCopy(copyText, 'structure');

const SECTION_LABEL: Record<TopItem['section'], string> = {
  header: 'ヘッダ',
  pool: '定数プール',
  class: 'クラス情報',
  interfaces: 'インターフェース',
  fields: 'フィールド',
  methods: 'メソッド',
  attributes: '属性',
};

interface Group {
  hex: string;
  label: string;
  value: string;
  big?: boolean;
}

interface Explanation {
  title: string;
  value: string;
  body: string;
  spec: string;
  summary: string;
  groups: Group[];
}

function shortHex(cf: ClassFile, start: number, end: number, max = 8): string {
  if (end - start <= max) return hexBytes(cf.bytes, start, end);
  return `${hexBytes(cf.bytes, start, start + max - 2)} … ${hexBytes(cf.bytes, end - 1, end)}`;
}

function partValue(cf: ClassFile, part: Part, target: 'field' | 'method' | 'class'): string {
  if (part.cp) return `#${part.cp} → ${showable(cpText(cf, part.cp))}`;
  if (part.name === 'access_flags') {
    const v = (cf.bytes[part.span.start] << 8) | cf.bytes[part.span.start + 1];
    return accessFlagNames(v, target).map((n) => n.replace('ACC_', '').toLowerCase()).join(' ') || '0';
  }
  return part.value;
}

function groupsFromParts(cf: ClassFile, parts: Part[], target: 'field' | 'method' | 'class'): Group[] {
  return parts.map((p) => ({
    hex: shortHex(cf, p.span.start, p.span.end),
    label: p.name.startsWith('attributes[') ? `${p.name} · ${p.type}` : p.name,
    value: p.name.startsWith('attributes[') ? p.value : partValue(cf, p, target),
  }));
}

function javaSignature(m: Member): string {
  const flags = accessFlagNames(m.accessFlags, m.kind)
    .filter((f) => ['ACC_PUBLIC', 'ACC_PRIVATE', 'ACC_PROTECTED', 'ACC_STATIC', 'ACC_FINAL'].includes(f))
    .map((f) => f.replace('ACC_', '').toLowerCase());
  if (m.kind === 'field') return [...flags, prettyDescriptor(m.descriptor), m.name].join(' ');
  const pretty = prettyDescriptor(m.descriptor);
  const [params, ret] = pretty.split(' → ');
  return [...flags, m.name === '<init>' ? '' : ret, `${m.name}${params}`].filter(Boolean).join(' ');
}

function explainAttribute(cf: ClassFile, a: Attribute): string {
  const size = a.span.end - a.span.start;
  switch (a.name) {
    case 'SourceFile': {
      const p = a.parts.find((x) => x.name === 'sourcefile_index');
      return copy.body('attr-sourcefile', { name: p?.cp ? cpText(cf, p.cp) : '?' });
    }
    case 'BootstrapMethods': {
      const bms = a.bootstrapMethods ?? [];
      const first = bms[0];
      return copy.body('attr-bootstrap', { count: bms.length, ref: first?.ref ?? 0, args: first?.args.length ?? 0 });
    }
    case 'InnerClasses': {
      const names = a.parts
        .filter((p) => p.name.endsWith('inner_class_info_index') && p.cp)
        .map((p) => `\`${cpText(cf, p.cp!)}\``);
      return copy.body('attr-innerclasses', { names: names.join('、') });
    }
    case 'NestHost':
    case 'NestMembers':
      return copy.body('attr-nest');
    case 'Record':
      return copy.body('attr-record');
    case 'PermittedSubclasses':
      return copy.body('attr-permitted');
    case 'Signature':
      return copy.body('attr-signature');
    default:
      return copy.body('attr-unknown', { name: a.name, size });
  }
}

function explain(cf: ClassFile, item: TopItem): Explanation {
  const bytes = item.span.end - item.span.start;
  const scalar = (value: string, body: string, spec = '4.1', summary = value): Explanation => ({
    title: item.name,
    value,
    body,
    spec,
    summary,
    groups: [{ hex: hexBytes(cf.bytes, item.span.start, item.span.end), label: item.type, value, big: true }],
  });

  switch (item.name) {
    case 'magic':
      return scalar(`0x${hex(cf.magic, 8)}`, copy.body('magic'));
    case 'minor_version':
      return scalar(String(cf.minor), copy.body(cf.minor === 65535 ? 'minor-preview' : 'minor'));
    case 'major_version':
      return scalar(
        `${cf.major} · ${javaVersion(cf.major)}`,
        copy.body('major', { major: cf.major, java: javaVersion(cf.major) }),
        '4.1',
        `${cf.major} (${javaVersion(cf.major)})`,
      );
    case 'constant_pool_count': {
      const slots = cf.poolCount - 1;
      const entries = cf.pool.filter(Boolean).length;
      return scalar(
        `${cf.poolCount} · 番号は #1〜#${slots}`,
        copy.body('pool-count', { slots, count: cf.poolCount }) + (entries !== slots ? copy.body('pool-count-long', { entries }) : ''),
        '4.1',
        String(cf.poolCount),
      );
    }
    case 'constant_pool': {
      const entries = cf.pool.filter(Boolean).length;
      const skipped: number[] = [];
      for (let i = 1; i < cf.poolCount; i++) if (!cf.pool[i]) skipped.push(i);
      const pct = Math.round((bytes / cf.bytes.length) * 100);
      return {
        title: 'constant_pool',
        value: `${entries} エントリ · ${bytes} バイト`,
        body:
          copy.body('pool', { pct }) +
          (skipped.length ? copy.body('pool-skipped', { skipped: skipped.map((i) => `\`#${i}\``).join('、') }) : ''),
        spec: '4.4',
        summary: `${entries} エントリ`,
        groups: [],
      };
    }
    case 'access_flags':
      return scalar(
        `0x${hex(cf.accessFlags, 4)}`,
        copy.body('access-flags', { flags: accessFlagNames(cf.accessFlags, 'class').map((n) => `\`${n}\``).join(' | ') }) +
          (cf.accessFlags & 0x20 ? copy.body('access-super') : ''),
      );
    case 'this_class': {
      const entry = cf.pool[cf.thisClass];
      const nameRef = entry?.refs[0]?.index ?? 0;
      return scalar(
        `#${cf.thisClass}`,
        copy.body('this-class', { index: cf.thisClass, nameRef, name: cpText(cf, cf.thisClass) }),
        '4.1',
        `#${cf.thisClass} ${cpText(cf, cf.thisClass)}`,
      );
    }
    case 'super_class': {
      if (cf.superClass === 0) return scalar('0', copy.body('super-none'));
      const name = cpText(cf, cf.superClass);
      return scalar(
        `#${cf.superClass}`,
        copy.body('super', { index: cf.superClass, name }) + (name === 'java/lang/Object' ? copy.body('super-object') : ''),
        '4.1',
        `#${cf.superClass} ${name}`,
      );
    }
    case 'interfaces_count': {
      const n = cf.interfaces.length;
      return scalar(String(n), n === 0 ? copy.body('interfaces-none') : copy.body('interfaces', { n }));
    }
    case 'interfaces':
      return scalar(
        cf.interfaces.map((i) => `#${i}`).join(' '),
        cf.interfaces.map((i) => `\`${cpText(cf, i)}\``).join('、'),
        '4.1',
        cf.interfaces.map((i) => cpText(cf, i).split('/').pop()).join(', '),
      );
    case 'fields_count':
      return scalar(String(cf.fields.length), copy.body('fields-count'));
    case 'methods_count':
      return scalar(
        String(cf.methods.length),
        copy.body('methods-count') + (cf.methods.some((m) => m.name === '<init>') ? copy.body('methods-ctor') : ''),
      );
    case 'attributes_count':
      return scalar(String(cf.attributes.length), copy.body('attributes-count'));
  }

  if (item.member) {
    const m = item.member;
    const code = m.attributes.find((a) => a.name === 'Code')?.code;
    const cv = m.attributes.find((a) => a.name === 'ConstantValue');
    let body = copy.body('member', {
      nameIndex: m.nameIndex,
      name: showable(m.name),
      descriptorIndex: m.descriptorIndex,
      descriptor: m.descriptor,
    });
    if (m.name === '<init>') body = copy.body('member-ctor') + body;
    if (m.name === '<clinit>') body = copy.body('member-clinit') + body;
    if (cv?.constantValue) {
      body += copy.body('member-constant', {
        index: cv.constantValue,
        kind: cf.pool[cv.constantValue]?.kind ?? '',
        value: cpText(cf, cv.constantValue),
      });
    }
    if (code) {
      body += copy.body('member-code', {
        bytes: code.codeSpan.end - code.codeSpan.start,
        maxStack: code.maxStack,
        maxLocals: code.maxLocals,
      });
    }
    return {
      title: `${item.name} · ${showable(m.name)}`,
      value: javaSignature(m),
      body,
      spec: m.kind === 'field' ? '4.5' : '4.6',
      summary: m.name,
      groups: groupsFromParts(cf, m.parts, m.kind),
    };
  }

  const a = item.attribute!;
  return {
    title: `${item.name} · ${a.name}`,
    value: `${bytes} バイト`,
    body: explainAttribute(cf, a),
    spec: ATTRIBUTE_SECTION[a.name] ?? '4.7',
    summary: a.name,
    groups: groupsFromParts(cf, a.parts, 'class'),
  };
}

function findPart(parts: Part[], offset: number): Part | undefined {
  return parts.find((p) => offset >= p.span.start && offset < p.span.end);
}

function locate(cf: ClassFile, item: TopItem, offset: number): string {
  if (item.name === 'constant_pool') {
    const entry = cf.pool.find((e): e is CpEntry => !!e && offset >= e.span.start && offset < e.span.end);
    if (!entry) return item.name;
    const part = findPart(entry.parts, offset);
    return `#${entry.index} ${entry.kind} · ${part?.name ?? ''}`;
  }
  const describeAttribute = (a: Attribute, prefix: string): string => {
    const part = findPart(a.parts, offset);
    if (!part) return prefix;
    if (part.name === 'code' && a.code) {
      const insn = a.code.instructions.find((i) => offset >= i.offset && offset < i.offset + i.length);
      return `${prefix} ${a.name} · pc ${insn?.pc} ${insn?.mnemonic}`;
    }
    if (part.name.startsWith('attributes[') && a.code) {
      const nested = a.code.attributes[Number(part.name.slice(11, -1))];
      if (nested) return describeAttribute(nested, `${prefix} ${a.name} ·`);
    }
    return `${prefix} ${a.name} · ${part.name}`;
  };
  if (item.member) {
    const m = item.member;
    const part = findPart(m.parts, offset);
    if (part?.name.startsWith('attributes[')) {
      const a = m.attributes[Number(part.name.slice(11, -1))];
      return describeAttribute(a, `${showable(m.name)} ·`);
    }
    return `${showable(m.name)} · ${part?.name ?? ''}`;
  }
  if (item.attribute) return describeAttribute(item.attribute, item.name);
  return item.name;
}

export function mountStructure(root: HTMLElement, cf: ClassFile): void {
  const steps = cf.items;
  const texts = steps.map((item) => explain(cf, item));
  const size = cf.bytes.length;

  const cellStep = new Int16Array(size);
  const cellAlt = new Uint8Array(size);
  const cellEntry = new Int16Array(size);
  steps.forEach((item, i) => {
    for (let b = item.span.start; b < item.span.end; b++) cellStep[b] = i;
  });
  cf.pool.forEach((entry) => {
    if (!entry) return;
    for (let b = entry.span.start; b < entry.span.end; b++) {
      cellAlt[b] = entry.index % 2;
      cellEntry[b] = entry.index;
    }
  });
  steps.forEach((item, i) => {
    if (!item.member && !item.attribute) return;
    const alt = Number(item.name.match(/\[(\d+)\]/)?.[1] ?? i) % 2;
    for (let b = item.span.start; b < item.span.end; b++) cellAlt[b] = alt;
  });

  const cells: HTMLElement[] = [];
  const bytemap = h('div', { class: 'bytemap', role: 'img', 'aria-label': `${size} バイトの配置図` });
  for (let b = 0; b < size; b++) {
    const cell = h('div', {
      class: `bm s-${steps[cellStep[b]].section}${cellAlt[b] ? ' alt' : ''}`,
    });
    cells.push(cell);
  }
  bytemap.append(...cells);
  const mapBox = h('div', { class: 'bytemap-box' }, bytemap);

  let hovered = -1;
  const cellIndex = (target: EventTarget | null) =>
    target instanceof HTMLElement && target.parentElement === bytemap ? cells.indexOf(target) : -1;
  bytemap.addEventListener('pointermove', (event) => {
    const b = cellIndex(event.target);
    if (b === hovered) return;
    if (hovered >= 0) cells[hovered].classList.remove('hover');
    hovered = b;
    if (b < 0) {
      hideTooltip();
      return;
    }
    cells[b].classList.add('hover');
    const item = steps[cellStep[b]];
    const rect = cells[b].getBoundingClientRect();
    showTooltip(
      rect.left + rect.width / 2,
      rect.top,
      h('div', {}, locate(cf, item, b)),
      h('div', { class: 'tt-dim' }, `0x${hex(b, 4)} (${b}) · ${hex(cf.bytes[b])}`),
    );
  });
  bytemap.addEventListener('pointerleave', () => {
    if (hovered >= 0) cells[hovered].classList.remove('hover');
    hovered = -1;
    hideTooltip();
  });
  bytemap.addEventListener('click', (event) => {
    const b = cellIndex(event.target);
    if (b >= 0) {
      player.pause();
      player.seek(cellStep[b]);
    }
  });

  const lineEls = new Map<string, { el: HTMLElement; val: HTMLElement }>();
  const structCode = h(
    'div',
    { class: 'struct-code' },
    h('div', { class: 'struct-brace' }, 'ClassFile {'),
    LINES.map((line) => {
      const val = h('span', { class: 'val' });
      const el = h(
        'div',
        { class: `struct-line s-${line.section}` },
        h('span', { class: 'ty' }, line.type),
        h('span', { class: 'nm' }, `${line.name};`),
        val,
      );
      el.addEventListener('click', () => {
        const target = steps.findIndex((s) => s.line === line.key);
        const fallback = steps.findIndex((s) => s.line === `${line.key}_count`);
        const idx = target >= 0 ? target : fallback;
        if (idx >= 0) {
          player.pause();
          player.seek(idx);
        }
      });
      lineEls.set(line.key, { el, val });
      return el;
    }),
    h('div', { class: 'struct-brace' }, '}'),
  );

  const sizes = new Map<TopItem['section'], number>();
  steps.forEach((s) => sizes.set(s.section, (sizes.get(s.section) ?? 0) + s.span.end - s.span.start));
  const legend = h(
    'div',
    { class: 'legend' },
    [...sizes].map(([section, n]) =>
      h('span', { class: `s-${section}` }, h('i', { class: 'dot' }), SECTION_LABEL[section], h('span', { class: 'bytes' }, `${n}`)),
    ),
  );

  const readingInner = h('div', { class: 'reading-inner' });
  const reading = h('div', { class: 'panel reading', 'aria-live': 'polite' }, readingInner);
  const readingFit = fitter(reading, readingInner);

  const player = new Player({
    count: steps.length,
    dwell: (i) => (steps[i].name === 'constant_pool' ? 6200 : steps[i].member || steps[i].attribute ? 2800 : 2200),
    onStep: (i, prev) => render(i, prev),
    tick: (i) => `s-${steps[i].section}`,
    label: (i) => showable(texts[i].title),
  });

  root.append(
    h(
      'div',
      { class: 'card fit structure-card', tabindex: -1 },
      h(
        'div',
        { class: 'structure' },
        h('div', { class: 'panel struct-panel' }, h('h3', { class: 'panel-title' }, 'JVMS §4.1 の構造体', h('span', { class: 'aside mono' }, `${size} B`)), structCode),
        h(
          'div',
          { class: 'struct-right' },
          h('div', { class: 'panel map-panel' }, h('h3', { class: 'panel-title' }, '1 マス = 1 バイト', h('span', { class: 'aside' }, 'マスを選ぶと、そこへ移動します')), mapBox, legend),
          reading,
        ),
      ),
      player.el,
    ),
  );
  const structRight = reading.parentElement!;

  const layoutMap = () => {
    if (!fitMode()) {
      bytemap.style.gridTemplateColumns = '';
      return;
    }
    const width = mapBox.clientWidth;
    const height = mapBox.clientHeight;
    if (width <= 0 || height <= 0) return;
    const gap = 2;
    const rendered = (cols: number) => {
      const cell = (width - (cols - 1) * gap) / cols;
      const rows = Math.ceil(size / cols);
      return rows * cell + (rows - 1) * gap;
    };
    let cols = Math.max(16, Math.ceil(Math.sqrt((size * width) / height)));
    while (cols < 200 && rendered(cols) > height) cols++;
    bytemap.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  };
  new ResizeObserver(layoutMap).observe(mapBox);
  window.matchMedia(FIT_QUERY).addEventListener('change', layoutMap);
  player.bindKeys(root);

  let sweep = 0;

  function paint(current: number, poolProgress = -1): void {
    for (let b = 0; b < size; b++) {
      const s = cellStep[b];
      const cell = cells[b];
      let read = s < current;
      let cur = s === current;
      if (cur && poolProgress >= 0) {
        const idx = cellEntry[b];
        read = idx < poolProgress;
        cur = idx === poolProgress;
      }
      cell.classList.toggle('read', read || cur);
      cell.classList.toggle('cur', cur);
    }
  }

  function paintLines(current: number): void {
    const currentLine = steps[current].line;
    for (const line of LINES) {
      const { el, val } = lineEls.get(line.key)!;
      const done = steps
        .map((s, i) => ({ s, i }))
        .filter(({ s, i }) => s.line === line.key && i <= current);
      let read = done.length > 0;
      if (line.key === 'interfaces' && cf.interfaces.length === 0) {
        const countIdx = steps.findIndex((s) => s.line === 'interfaces_count');
        read = countIdx <= current;
        val.textContent = '空';
      } else if (done.length > 0) {
        val.textContent = done.map(({ i }) => showable(texts[i].summary)).join(', ');
      }
      el.classList.toggle('read', read);
      el.classList.toggle('current', line.key === currentLine);
    }
  }

  function readingNodes(i: number): Node[] {
    const item = steps[i];
    const t = texts[i];
    const bytes = item.span.end - item.span.start;
    const nodes: Node[] = [
      h(
        'div',
        { class: 'reading-head' },
        h('h3', { class: 'reading-title' }, showable(t.title)),
        h('span', { class: 'reading-meta' }, `offset 0x${hex(item.span.start, 4)} · ${bytes} B`),
        specLink(t.spec),
      ),
      h('div', { class: 'reading-value' }, showable(t.value)),
      h('p', { class: 'reading-body' }, rich(t.body)),
    ];
    if (t.groups.length) {
      nodes.push(
        h(
          'div',
          { class: 'hexgroups' },
          t.groups.map((g, k) =>
            h(
              'div',
              { class: `hexgroup${g.big ? ' big' : ''}`, style: `animation-delay:${k * 40}ms` },
              h('span', { class: 'hx' }, g.hex),
              h('span', { class: 'lb' }, g.label),
              g.big ? null : h('span', { class: 'vv', title: g.value }, g.value),
            ),
          ),
        ),
      );
    }
    if (item.name === 'constant_pool') nodes.push(histogram());
    return nodes;
  }

  function renderReading(i: number, extra?: Node): void {
    reading.className = `panel reading s-${steps[i].section}`;
    const nodes = readingNodes(i);
    if (extra) nodes.splice(nodes.length - (steps[i].name === 'constant_pool' ? 1 : 0), 1, extra);
    readingInner.replaceChildren(...nodes);
    readingFit.update();
  }

  function measureReading(): void {
    if (!fitMode()) {
      reading.style.flexBasis = '';
      return;
    }
    const probeInner = h('div', { class: 'reading-inner' });
    const probe = h(
      'div',
      { class: 'panel reading', style: `position:absolute;visibility:hidden;left:0;top:0;height:auto;width:${reading.clientWidth}px` },
      probeInner,
    );
    structRight.append(probe);
    let tallest = 0;
    steps.forEach((step, i) => {
      probe.className = `panel reading s-${step.section}`;
      probeInner.replaceChildren(...readingNodes(i));
      tallest = Math.max(tallest, probe.offsetHeight);
    });
    probe.remove();
    reading.style.flexBasis = `${Math.min(tallest, structRight.clientHeight * 0.64)}px`;
    readingFit.update();
  }

  function histogram(): HTMLElement {
    const counts = new Map<string, number>();
    cf.pool.forEach((e) => e && counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1));
    const max = Math.max(...counts.values());
    return h(
      'div',
      { class: 'histogram' },
      [...counts]
        .sort((a, b) => b[1] - a[1])
        .flatMap(([kind, n], k) => [
          h('span', { class: `hk k-${kind}` }, h('i', { class: 'dot' }), kind),
          h('div', {}, h('div', { class: `hb k-${kind}`, style: `width:${(n / max) * 100}%;animation-delay:${k * 50}ms` })),
          h('span', { class: 'hn' }, String(n)),
        ]),
    );
  }

  function runSweep(i: number): void {
    const entries = cf.pool.filter((e): e is CpEntry => !!e);
    const ticker = h('div', { class: 'ticker' });
    renderReading(i, ticker);
    const duration = 3600;
    const start = performance.now();
    let shown = 0;
    const token = ++sweep;
    const frame = (now: number) => {
      if (token !== sweep) return;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 2);
      const upto = Math.min(entries.length, Math.floor(eased * entries.length) + 1);
      while (shown < upto) {
        const e = entries[shown];
        ticker.append(
          h(
            'div',
            { class: `k-${e.kind}` },
            h('span', { class: 'ix' }, `#${e.index}`),
            h('span', { class: 'kd' }, e.kind),
            h('span', {}, cpRaw(cf, e.index)),
          ),
        );
        if (ticker.children.length > 7) ticker.firstElementChild?.remove();
        shown++;
      }
      paint(i, entries[upto - 1].index);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        paint(i);
        ticker.replaceWith(histogram());
      }
    };
    requestAnimationFrame(frame);
  }

  function render(i: number, prev: number): void {
    sweep++;
    paintLines(i);
    if (steps[i].name === 'constant_pool' && i === prev + 1 && !reducedMotion()) {
      runSweep(i);
      return;
    }
    paint(i);
    renderReading(i);
  }

  let lastSize = '';
  new ResizeObserver(() => {
    const sizeKey = `${structRight.clientWidth}x${structRight.clientHeight}`;
    if (sizeKey === lastSize) return;
    lastSize = sizeKey;
    measureReading();
  }).observe(structRight);
  window.matchMedia(FIT_QUERY).addEventListener('change', measureReading);

  render(0, -1);
  if (reducedMotion()) {
    player.seek(steps.length - 1);
  } else {
    onceVisible(root, () => player.play());
  }
}
