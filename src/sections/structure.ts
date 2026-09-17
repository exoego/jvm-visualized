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
      return `コンパイル元のファイル名 \`${p?.cp ? cpText(cf, p.cp) : '?'}\` を残します。スタックトレースの表示などに使われます。`;
    }
    case 'BootstrapMethods': {
      const bms = a.bootstrapMethods ?? [];
      const first = bms[0];
      return `invokedynamic が使う**ブートストラップメソッド**の表です。${bms.length} 件あり、0 番はメソッドハンドル \`#${first?.ref}\` と静的引数 ${first?.args.length ?? 0} 個の組です。`;
    }
    case 'InnerClasses': {
      const names = a.parts
        .filter((p) => p.name.endsWith('inner_class_info_index') && p.cp)
        .map((p) => `\`${cpText(cf, p.cp!)}\``);
      return `入れ子のクラスどうしの関係を記録します。定数プールに入れ子クラス ${names.join('、')} の Class エントリがあるので、この属性が必要になります。`;
    }
    case 'NestHost':
    case 'NestMembers':
      return `同じネストに属するクラスどうしが private メンバーにアクセスするための情報です (Java 11〜)。`;
    case 'Record':
      return `record クラスの構成要素を記録します (Java 16〜)。`;
    case 'PermittedSubclasses':
      return `sealed クラスを継承できるクラスの一覧です (Java 17〜)。`;
    case 'Signature':
      return `ジェネリクスの型情報を残します。記述子には現れない型引数がここに入ります。`;
    default:
      return `${a.name} 属性。${size} バイトあります。知らない名前の属性は、JVM は読み飛ばします。`;
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
      return scalar(
        `0x${hex(cf.magic, 8)}`,
        'class ファイルは必ずこの 4 バイトで始まります。JVM はまずここを見て、読もうとしているのが class ファイルかどうかを確かめます。',
      );
    case 'minor_version':
      return scalar(
        String(cf.minor),
        cf.minor === 65535
          ? '65535 は、プレビュー機能を使ったクラスの印です。'
          : 'マイナーバージョン。Java SE 12 以降は、プレビュー機能を使うクラスだけが 65535 を使い、それ以外は 0 です。',
      );
    case 'major_version':
      return scalar(
        `${cf.major} · ${javaVersion(cf.major)}`,
        `${cf.major} は ${javaVersion(cf.major)} の形式です。JVM は、自分が対応していない新しいバージョンのファイルを \`UnsupportedClassVersionError\` で拒否します。`,
        '4.1',
        `${cf.major} (${javaVersion(cf.major)})`,
      );
    case 'constant_pool_count': {
      const slots = cf.poolCount - 1;
      const entries = cf.pool.filter(Boolean).length;
      return scalar(
        `${cf.poolCount} · 番号は #1〜#${slots}`,
        `このファイルの定数プールには、**#1〜#${slots} の ${slots} 個**の番号があります。${cf.poolCount} − 1 なのは、番号が 0 ではなく 1 から始まるからです。0 番は使わない決まりで、super_class などで「何も指していない」印に使われます。` +
          (entries !== slots
            ? `なお Long と Double は 1 つで番号を 2 つ使うので、実際に入っているエントリは ${entries} 個です。`
            : ''),
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
          `ファイルの **${pct}%** を占める表です。エントリの長さはまちまちで、先頭 1 バイトの tag を読むまで、そのエントリが何バイトあるかはわかりません。` +
          (skipped.length
            ? `Long と Double は番号を 2 つ使うので、${skipped.map((i) => `\`#${i}\``).join('、')} は欠番です。`
            : ''),
        spec: '4.4',
        summary: `${entries} エントリ`,
        groups: [],
      };
    }
    case 'access_flags':
      return scalar(
        `0x${hex(cf.accessFlags, 4)}`,
        `${accessFlagNames(cf.accessFlags, 'class').map((n) => `\`${n}\``).join(' | ')}。` +
          (cf.accessFlags & 0x20
            ? 'ACC_SUPER は古い互換性のためのフラグで、Java SE 8 以降の JVM は常に立っているものとして扱います。'
            : ''),
      );
    case 'this_class': {
      const entry = cf.pool[cf.thisClass];
      const nameRef = entry?.refs[0]?.index;
      return scalar(
        `#${cf.thisClass}`,
        `このクラス自身。ここにあるのは名前の文字列ではなく、定数プールの**番号**です。\`#${cf.thisClass}\` は Class エントリで、その name_index \`#${nameRef}\` の Utf8 に \`${cpText(cf, cf.thisClass)}\` が入っています。`,
        '4.1',
        `#${cf.thisClass} ${cpText(cf, cf.thisClass)}`,
      );
    }
    case 'super_class': {
      if (cf.superClass === 0) {
        return scalar('0', '0 は親クラスがないことを表します。java/lang/Object と module-info だけがこうなります。');
      }
      const name = cpText(cf, cf.superClass);
      return scalar(
        `#${cf.superClass}`,
        `親クラス。\`#${cf.superClass}\` → \`${name}\`。` +
          (name === 'java/lang/Object' ? 'extends を書かないクラスでは java/lang/Object になります。' : ''),
        '4.1',
        `#${cf.superClass} ${name}`,
      );
    }
    case 'interfaces_count': {
      const n = cf.interfaces.length;
      return scalar(
        String(n),
        n === 0
          ? '実装しているインターフェースの数。このクラスにはないので、続く interfaces 配列は 0 バイトです。'
          : `実装しているインターフェースの数。続く ${n} 個の u2 が、それぞれ Class エントリを指します。`,
      );
    }
    case 'interfaces':
      return scalar(
        cf.interfaces.map((i) => `#${i}`).join(' '),
        cf.interfaces.map((i) => `\`${cpText(cf, i)}\``).join('、'),
        '4.1',
        cf.interfaces.map((i) => cpText(cf, i).split('/').pop()).join(', '),
      );
    case 'fields_count':
      return scalar(String(cf.fields.length), 'このクラスが宣言しているフィールドの数です。継承したフィールドは含みません。');
    case 'methods_count':
      return scalar(
        String(cf.methods.length),
        'このクラスが宣言しているメソッドの数です。' +
          (cf.methods.some((m) => m.name === '<init>') ? 'コンストラクタも `<init>` という名前のメソッドとして数えます。' : ''),
      );
    case 'attributes_count':
      return scalar(String(cf.attributes.length), 'クラス全体に付く属性の数です。');
  }

  if (item.member) {
    const m = item.member;
    const code = m.attributes.find((a) => a.name === 'Code')?.code;
    const cv = m.attributes.find((a) => a.name === 'ConstantValue');
    let body =
      `名前も型も、定数プールの番号で持ちます。name_index \`#${m.nameIndex}\` → \`${showable(m.name)}\`、descriptor_index \`#${m.descriptorIndex}\` → \`${m.descriptor}\`。`;
    if (m.name === '<init>') body = `コンストラクタ。${body}`;
    if (m.name === '<clinit>') body = `クラスの初期化メソッド。${body}`;
    if (cv?.constantValue) {
      body += `ConstantValue 属性が \`#${cv.constantValue}\` (${cf.pool[cv.constantValue]?.kind} ${cpText(cf, cv.constantValue)}) を指しています。`;
    }
    if (code) {
      body += `Code 属性に ${code.codeSpan.end - code.codeSpan.start} バイトのバイトコードがあり、max_stack = ${code.maxStack}、max_locals = ${code.maxLocals} です。`;
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
      const t = Math.min(1, (now - start) / duration);
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
