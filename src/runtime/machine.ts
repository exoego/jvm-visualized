import { cpText, prettyDescriptor } from '../classfile/describe';
import type { ClassFile, CodeInfo, CpKind, Instruction, Member } from '../classfile/types';

export type Value = { t: 'ref'; id: number } | { t: 'null' };

export interface Frame {
  method: string;
  display: string;
  pc: number;
  locals: (Value | null)[];
  stack: Value[];
  maxStack: number;
}

export type ObjectType = 'Greeter' | 'String' | 'PrintStream' | 'array' | 'CallSite' | 'Object';

export interface HeapObject {
  id: number;
  type: ObjectType;
  className: string;
  text?: string;
  fields?: { name: string; value: Value }[];
  tag?: string;
  pre?: boolean;
}

export interface ClassState {
  name: string;
  loader: string;
  phase: 1 | 2 | 3;
  jdk?: boolean;
  statics?: { name: string; value: string }[];
}

export interface RcpRow {
  index: number;
  kind: CpKind;
  text: string;
  state: 'unresolved' | 'resolved' | 'static';
  result?: string;
  parent?: number;
}

export type Tone = 'load' | 'resolve' | 'cache' | 'exec' | 'invoke' | 'static' | 'done';

export interface ChainItem {
  text: string;
  state: 'done' | 'active' | 'todo';
}

export interface Link {
  from: string;
  to: string;
}

export interface Snapshot {
  frames: Frame[];
  heap: HeapObject[];
  classes: ClassState[];
  rcp: RcpRow[];
  console: string[];
  resolutions: number;
  hits: number;
  title: string;
  body: string;
  tone: Tone;
  specs: string[];
  method?: string;
  pc?: number;
  focusCp?: number;
  chainCp?: number;
  chain?: ChainItem[];
  focusHeap?: number[];
  focusClasses?: string[];
  links: Link[];
}

type Emit = Omit<Snapshot, 'frames' | 'heap' | 'classes' | 'rcp' | 'console' | 'resolutions' | 'hits' | 'links' | 'specs'> & {
  links?: Link[];
  specs?: string[];
};

const simple = (name: string) => name.split('/').pop() ?? name;

const paramCount = (descriptor: string) => {
  const params = prettyDescriptor(descriptor).split(' → ')[0];
  return params === '()' ? 0 : params.split(', ').length;
};

class Machine {
  readonly snapshots: Snapshot[] = [];
  private frames: Frame[] = [];
  private heap: HeapObject[] = [];
  private classes: ClassState[] = [];
  private rcp: RcpRow[] = [];
  private console: string[] = [];
  private resolutions = 0;
  private hits = 0;
  private nextId = 1;
  private readonly self: string;
  private readonly bsms;
  private readonly methods = new Map<string, { member: Member; code: CodeInfo }>();

  constructor(private readonly cf: ClassFile) {
    this.self = cpText(cf, cf.thisClass);
    this.bsms = cf.attributes.find((a) => a.name === 'BootstrapMethods')?.bootstrapMethods ?? [];
    for (const member of cf.methods) {
      const code = member.attributes.find((a) => a.name === 'Code')?.code;
      if (code) this.methods.set(member.name, { member, code });
    }
  }

  private emit(s: Emit): void {
    this.snapshots.push(
      structuredClone({
        frames: this.frames,
        heap: this.heap,
        classes: this.classes,
        rcp: this.rcp,
        console: this.console,
        resolutions: this.resolutions,
        hits: this.hits,
        links: [],
        specs: [],
        ...s,
      }),
    );
  }

  private row(index: number): RcpRow {
    return this.rcp.find((r) => r.index === index)!;
  }

  private cls(name: string): ClassState | undefined {
    return this.classes.find((c) => c.name === name);
  }

  private alloc(o: Omit<HeapObject, 'id'>): number {
    const id = this.nextId++;
    this.heap.push({ id, ...o });
    return id;
  }

  private obj(v: Value | undefined): HeapObject | undefined {
    return v?.t === 'ref' ? this.heap.find((o) => o.id === v.id) : undefined;
  }

  private show(v: Value | undefined): string {
    const o = this.obj(v);
    if (!o) return 'null';
    if (o.type === 'String') return `"${o.text}"`;
    return `${simple(o.className)}@${o.id}`;
  }

  private get top(): Frame {
    return this.frames[this.frames.length - 1];
  }

  private refParts(index: number) {
    const entry = this.cf.pool[index]!;
    const classIndex = entry.refs.find((r) => r.field === 'class_index')?.index ?? 0;
    const natIndex = entry.refs.find((r) => r.field === 'name_and_type_index')?.index ?? 0;
    const nat = this.cf.pool[natIndex];
    return {
      entry,
      classIndex,
      natIndex,
      className: cpText(this.cf, classIndex),
      name: nat ? cpText(this.cf, nat.refs[0].index) : '?',
      descriptor: nat ? cpText(this.cf, nat.refs[1].index) : '?',
    };
  }

  private buildRcp(): void {
    const top = new Set<number>();
    for (const { code } of this.methods.values()) {
      for (const insn of code.instructions) if (insn.cp && this.cf.pool[insn.cp]) top.add(insn.cp);
    }
    const parent = new Map<number, number>();
    const adopt = (child: number, owner: number) => {
      if (this.cf.pool[child] && !top.has(child) && !parent.has(child)) parent.set(child, owner);
    };
    for (const index of [...top].sort((a, b) => a - b)) {
      const entry = this.cf.pool[index]!;
      const classRef = entry.refs.find((r) => r.field === 'class_index');
      if (classRef) adopt(classRef.index, index);
      const bm = entry.bootstrapIndex !== undefined ? this.bsms[entry.bootstrapIndex] : undefined;
      if (bm) {
        adopt(bm.ref, index);
        const target = this.cf.pool[bm.ref]?.refs[0]?.index;
        const targetClass = target ? this.cf.pool[target]?.refs.find((r) => r.field === 'class_index') : undefined;
        if (targetClass) adopt(targetClass.index, index);
        bm.args.forEach((a) => adopt(a, index));
      }
    }
    const isStatic = (k: CpKind) => ['String', 'Integer', 'Float', 'Long', 'Double'].includes(k);
    this.rcp = [...top, ...parent.keys()]
      .sort((a, b) => a - b)
      .map((index) => {
        const entry = this.cf.pool[index]!;
        const text = cpText(this.cf, index);
        return {
          index,
          kind: entry.kind,
          text: entry.kind === 'String' ? `"${text}"` : text,
          state: isStatic(entry.kind) ? 'static' : 'unresolved',
          parent: parent.get(index),
        } satisfies RcpRow;
      });
  }

  run(): Snapshot[] {
    this.startup();
    let guard = 0;
    while (this.frames.length && guard++ < 500) this.execute();
    this.finish();
    return this.snapshots;
  }

  private startup(): void {
    const jdk = (name: string, statics?: ClassState['statics']): ClassState => ({
      name,
      loader: 'ブートストラップ',
      phase: 3,
      jdk: true,
      statics,
    });
    const out = this.alloc({ type: 'PrintStream', className: 'java/io/PrintStream', tag: 'System.out', pre: true });
    this.classes = [
      jdk('java/lang/Object'),
      jdk('java/lang/String'),
      jdk('java/lang/System', [{ name: 'out', value: `PrintStream@${out}` }]),
      jdk('java/io/PrintStream'),
    ];
    this.console = [];

    this.classes.push({ name: this.self, loader: 'アプリケーション', phase: 1 });
    this.emit({
      title: 'JVM を起動し、Greeter をロード',
      body: '`java Greeter` を実行すると、JVM は最初のクラスとして Greeter を作ります。クラスローダーが Greeter.class のバイト列を読み、クラスを作ります。Object や System などの JDK のクラスは、起動の途中ですでに用意されています。',
      tone: 'load',
      specs: ['5.2', '5.3'],
      focusClasses: [this.self],
    });

    this.buildRcp();
    this.emit({
      title: '実行時定数プールを作る',
      body: 'class ファイルの定数プールから、クラスごとの**実行時定数プール**ができます。ここに並ぶのは、命令が使うエントリです。クラスやメソッドへの参照は名前の文字列でできた**記号参照**のままで、まだ何にも結びついていません。',
      tone: 'load',
      specs: ['5.1'],
      focusClasses: [this.self],
    });

    const seedField = this.cf.fields.find((f) => f.attributes.some((a) => a.name === 'ConstantValue'));
    const self = this.cls(this.self)!;
    self.phase = 2;
    self.statics = this.cf.fields
      .filter((f) => f.accessFlags & 0x0008)
      .map((f) => ({ name: f.name, value: '0' }));
    this.emit({
      title: 'リンク — 検証と準備',
      body: 'バイトコードが安全に実行できるかを**検証**します。続く**準備**では static フィールドの領域を作り、既定値を入れます。' +
        (seedField ? `\`${seedField.name}\` はまだ 0 です。` : ''),
      tone: 'load',
      specs: ['5.4.1', '5.4.2'],
      focusClasses: [this.self],
    });

    self.phase = 3;
    let cvIndex: number | undefined;
    if (seedField) {
      cvIndex = seedField.attributes.find((a) => a.name === 'ConstantValue')!.constantValue!;
      const value = this.cf.pool[cvIndex]!.number;
      const shown = typeof value === 'bigint' ? `0x${value.toString(16).toUpperCase()}` : String(value);
      self.statics = self.statics?.map((s) => (s.name === seedField.name ? { ...s, value: shown } : s));
    }
    const clinit = this.methods.has('<clinit>');
    this.emit({
      title: '初期化',
      body:
        (seedField
          ? `ConstantValue 属性を持つ final static フィールドには、ここで定数プールの値が入ります。\`${seedField.name}\` ← \`#${cvIndex}\`。`
          : '') +
        (clinit ? '続いて `<clinit>` を実行します。' : 'Greeter には `<clinit>` がないので、実行するコードはありません。'),
      tone: 'static',
      specs: ['5.5'],
      focusClasses: [this.self],
    });

    const args = this.alloc({ type: 'array', className: 'java/lang/String[]', text: 'length = 0', tag: 'args' });
    const main = this.methods.get('main')!;
    this.frames.push(this.frame(main, [{ t: 'ref', id: args }]));
    this.emit({
      title: 'main を呼び出す',
      body: '`public static void main(String[])` を呼びます。**フレーム**が 1 つ積まれ、ローカル変数 0 番に引数の配列が入ります。オペランドスタックの枠の数は、Code 属性の max_stack で決まっています。',
      tone: 'invoke',
      specs: ['5.2', '2.6'],
      method: 'main',
      pc: 0,
      focusHeap: [args],
      links: [{ from: `heap:${args}`, to: 'frame:0' }],
    });
  }

  private frame(m: { member: Member; code: CodeInfo }, args: Value[]): Frame {
    const locals: (Value | null)[] = new Array(m.code.maxLocals).fill(null);
    args.forEach((a, i) => (locals[i] = a));
    const [params] = prettyDescriptor(m.member.descriptor).split(' → ');
    return {
      method: m.member.name,
      display: `${simple(this.self)}.${m.member.name}${params}`,
      pc: 0,
      locals,
      stack: [],
      maxStack: m.code.maxStack,
    };
  }

  private resolveClass(index: number): { cached: boolean; name: string } {
    const row = this.row(index);
    const name = cpText(this.cf, index);
    if (row.state === 'resolved') return { cached: true, name };
    row.state = 'resolved';
    row.result = `class ${simple(name)}`;
    this.resolutions++;
    if (!this.cls(name)) this.classes.push({ name, loader: 'ブートストラップ', phase: 2, jdk: true });
    return { cached: false, name };
  }

  private resolveMember(insn: Instruction, method: string): boolean {
    const index = insn.cp!;
    const row = this.row(index);
    const key = `insn:${method}:${insn.pc}`;
    if (row.state === 'resolved') {
      this.hits++;
      return true;
    }
    const p = this.refParts(index);
    const isField = p.entry.kind === 'Fieldref';
    const what = isField ? 'フィールド' : 'メソッド';
    const classRow = this.row(p.classIndex);
    const classWasResolved = classRow.state === 'resolved';
    const chain: ChainItem[] = [
      {
        text: classWasResolved
          ? `class_index \`#${p.classIndex}\` は解決済み → \`${simple(p.className)}\``
          : `class_index \`#${p.classIndex}\` → クラス \`${p.className}\` を解決`,
        state: 'done',
      },
      { text: `name_and_type_index \`#${p.natIndex}\` → \`${p.name}\` \`${p.descriptor}\``, state: 'done' },
      { text: `\`${simple(p.className)}\` とその親クラスから${what}を探す`, state: 'active' },
      { text: `見つけた${what}への参照を \`#${index}\` に記録`, state: 'todo' },
    ];
    this.resolveClass(p.classIndex);
    const jdkNote = this.cls(p.className)?.jdk && !classWasResolved
      ? `\`${p.className}\` は JDK のクラスで、すでにロードされています。`
      : '';
    this.emit({
      title: `\`${insn.mnemonic} #${index}\` — 記号参照を解決する`,
      body:
        `\`${insn.mnemonic}\` は \`#${index}\` の ${p.entry.kind} を使います。まだ解決されていないので、ここで解決します。` +
        (classWasResolved
          ? `まずクラスを解決しますが、\`#${p.classIndex}\` は前の命令がすでに解決しているので、その結果を使います。`
          : `まず class_index が指すクラスを解決し (§5.4.3.1)、次に NameAndType から名前と記述子を取り出します。${jdkNote}`),
      tone: 'resolve',
      specs: [isField ? '5.4.3.2' : '5.4.3.3'],
      method,
      pc: insn.pc,
      focusCp: index,
      chain,
      focusClasses: [p.className],
      links: [
        { from: key, to: `cp:${index}` },
        { from: `cp:${index}`, to: `class:${p.className}` },
      ],
    });

    chain.forEach((c) => (c.state = 'done'));
    row.state = 'resolved';
    row.result = isField
      ? `${simple(p.className)}.${p.name} (${prettyDescriptor(p.descriptor)})`
      : `${simple(p.className)}.${p.name}${prettyDescriptor(p.descriptor).split(' → ')[0]} の本体`;
    this.resolutions++;
    this.emit({
      title: `\`#${index}\` を解決しました`,
      body: `${simple(p.className)} に${what} \`${p.name}\` が見つかりました。その参照が \`#${index}\` に記録されます。この先 \`#${index}\` を使う命令は、どれも解決の手順を繰り返しません (§5.4.3)。`,
      tone: 'resolve',
      specs: ['5.4.3'],
      method,
      pc: insn.pc,
      focusCp: index,
      chain,
      focusClasses: [p.className],
      links: [{ from: `cp:${index}`, to: `class:${p.className}` }],
    });
    return false;
  }

  private cacheNote(insn: Instruction, cached: boolean): string {
    return cached ? `\`#${insn.cp}\` は解決済みなので、記録された結果をそのまま使います。` : '';
  }

  private execute(): void {
    const frame = this.top;
    const m = this.methods.get(frame.method)!;
    const insn = m.code.instructions.find((i) => i.pc === frame.pc)!;
    const method = frame.method;
    const key = `insn:${method}:${insn.pc}`;
    const next = insn.pc + insn.length;
    const base = { method, pc: insn.pc, specs: [`6.5.${insn.mnemonic.replace(/_\d$/, '_n')}`] };

    switch (insn.mnemonic) {
      case 'aload_0':
      case 'aload_1':
      case 'aload_2':
      case 'aload_3': {
        const n = Number(insn.mnemonic.slice(-1));
        frame.stack.push(frame.locals[n] ?? { t: 'null' });
        this.emit({
          ...base,
          title: `\`${insn.mnemonic}\` — ローカル変数を積む`,
          body: `ローカル変数 ${n} 番の参照 ${this.show(frame.locals[n] ?? undefined)} を、オペランドスタックに積みます。定数プールは使いません。`,
          tone: 'exec',
          specs: ['6.5.aload_n'],
          links: [],
        });
        frame.pc = next;
        return;
      }
      case 'astore_1': {
        const v = frame.stack.pop()!;
        frame.locals[1] = v;
        this.emit({
          ...base,
          title: '`astore_1` — ローカル変数に保存',
          body: `スタックの一番上の参照 ${this.show(v)} を取り出し、ローカル変数 1 番に保存します。`,
          tone: 'exec',
          specs: ['6.5.astore_n'],
        });
        frame.pc = next;
        return;
      }
      case 'dup': {
        const v = frame.stack[frame.stack.length - 1];
        frame.stack.push(v);
        this.emit({
          ...base,
          title: '`dup` — 一番上を複製',
          body: 'スタックの一番上の参照を複製します。1 つはこのあとの `<init>` の呼び出しで使われ、もう 1 つがスタックに残ります。',
          tone: 'exec',
        });
        frame.pc = next;
        return;
      }
      case 'new': {
        const index = insn.cp!;
        const row = this.row(index);
        const name = cpText(this.cf, index);
        const cached = row.state === 'resolved';
        if (!cached) {
          const nameIndex = this.cf.pool[index]!.refs[0].index;
          this.emit({
            ...base,
            title: `\`new #${index}\` — クラスを解決する`,
            body: `\`new\` は記号参照 \`#${index}\` を使います。まだ解決されていません。Class エントリの name_index \`#${nameIndex}\` をたどると、名前は \`${name}\` です。`,
            tone: 'resolve',
            specs: ['5.4.3.1'],
            focusCp: index,
            chain: [
              { text: `name_index \`#${nameIndex}\` → \`${name}\``, state: 'done' },
              { text: `Greeter を定義したクラスローダーで \`${name}\` を探す`, state: 'active' },
              { text: `アクセスできるかを確かめ、結果を \`#${index}\` に記録`, state: 'todo' },
            ],
            links: [{ from: key, to: `cp:${index}` }],
          });
          this.resolveClass(index);
          this.emit({
            ...base,
            title: `\`#${index}\` を解決しました`,
            body: `\`${name}\` はすでにロードされているクラスです。新しくロードはせず、そのクラスへの参照を \`#${index}\` に記録します。`,
            tone: 'resolve',
            specs: ['5.4.3.1'],
            focusCp: index,
            focusClasses: [name],
            chain: [
              { text: `name_index \`#${nameIndex}\` → \`${name}\``, state: 'done' },
              { text: `Greeter を定義したクラスローダーで \`${name}\` を探す`, state: 'done' },
              { text: `アクセスできるかを確かめ、結果を \`#${index}\` に記録`, state: 'done' },
            ],
            links: [{ from: `cp:${index}`, to: `class:${name}` }],
          });
        } else {
          this.hits++;
        }
        const fields = this.cf.fields
          .filter((f) => !(f.accessFlags & 0x0008))
          .map((f) => ({ name: f.name, value: { t: 'null' } as Value }));
        const id = this.alloc({ type: 'Greeter', className: name, fields });
        frame.stack.push({ t: 'ref', id });
        this.emit({
          ...base,
          title: `\`new\` — インスタンスを確保`,
          body: `${this.cacheNote(insn, cached)}\`${name}\` は初期化済みなので、そのままヒープに領域を確保します。フィールドは既定値 (${fields.map((f) => `${f.name} = null`).join(', ')}) で、参照がスタックに積まれます。コンストラクタはまだ呼ばれていません。`,
          tone: cached ? 'cache' : 'exec',
          focusCp: index,
          focusHeap: [id],
          links: [{ from: `cp:${index}`, to: `heap:${id}` }],
        });
        frame.pc = next;
        return;
      }
      case 'ldc': {
        const index = insn.cp!;
        const entry = this.cf.pool[index]!;
        const row = this.row(index);
        if (entry.kind === 'String') {
          const text = cpText(this.cf, index);
          let target = this.heap.find((o) => o.type === 'String' && o.text === text && o.tag === 'intern 済み');
          const first = !target;
          if (!target) {
            const id = this.alloc({ type: 'String', className: 'java/lang/String', text, tag: 'intern 済み' });
            target = this.heap.find((o) => o.id === id)!;
            row.result = `String@${id}`;
          }
          frame.stack.push({ t: 'ref', id: target.id });
          this.emit({
            ...base,
            title: `\`ldc #${index}\` — 文字列定数を積む`,
            body: first
              ? `String エントリは記号参照ではなく**静的定数**で、解決は要りません (§5.1)。同じ内容の String が intern 済みならそれを、なければ新しく作って intern したものを使います (いつ作るかは実装しだいです)。その参照をスタックに積みます。`
              : `同じ内容の String がすでに intern されているので、その参照を積みます。`,
            tone: 'static',
            specs: ['5.1', '6.5.ldc'],
            focusCp: index,
            focusHeap: [target.id],
            links: [
              { from: key, to: `cp:${index}` },
              { from: `cp:${index}`, to: `heap:${target.id}` },
            ],
          });
        }
        frame.pc = next;
        return;
      }
      case 'invokespecial': {
        const cached = this.resolveMember(insn, method);
        const p = this.refParts(insn.cp!);
        const argc = paramCount(p.descriptor);
        const args = frame.stack.splice(frame.stack.length - argc - 1, argc + 1);
        const local = p.className === this.self ? this.methods.get(p.name) : undefined;
        if (local) {
          frame.pc = next;
          this.frames.push(this.frame(local, args));
          this.emit({
            ...base,
            title: `\`invokespecial\` — \`${p.name}\` を呼ぶ`,
            body: `${this.cacheNote(insn, cached)}\`invokespecial\` は、解決したメソッドをそのまま呼びます。スタックから ${args.map((a) => this.show(a)).join(' と ')} を取り出し、新しいフレームのローカル変数 0 番 (this) と 1 番に入れます。`,
            tone: cached ? 'cache' : 'invoke',
            focusCp: insn.cp,
            links: [{ from: key, to: `frame:${this.frames.length - 1}` }],
          });
        } else {
          this.emit({
            ...base,
            title: `\`invokespecial\` — \`${simple(p.className)}.${p.name}\` を呼ぶ`,
            body: `${this.cacheNote(insn, cached)}スタックから this (${this.show(args[0])}) を取り出し、\`${p.className}.${p.name}${p.descriptor}\` を呼んで戻ってきます (中身は省略)。`,
            tone: cached ? 'cache' : 'invoke',
            focusCp: insn.cp,
            links: [{ from: key, to: `class:${p.className}` }],
          });
          frame.pc = next;
        }
        return;
      }
      case 'putfield': {
        const cached = this.resolveMember(insn, method);
        const p = this.refParts(insn.cp!);
        const value = frame.stack.pop()!;
        const target = this.obj(frame.stack.pop());
        const field = target?.fields?.find((f) => f.name === p.name);
        if (field) field.value = value;
        this.emit({
          ...base,
          title: '`putfield` — フィールドに書き込む',
          body: `${this.cacheNote(insn, cached)}スタックから値 ${this.show(value)} とオブジェクト参照を取り出し、${target ? `${simple(target.className)}@${target.id}` : ''} の \`${p.name}\` に入れます。`,
          tone: cached ? 'cache' : 'exec',
          focusCp: insn.cp,
          focusHeap: target ? [target.id] : [],
          links: target ? [{ from: key, to: `heap:${target.id}` }] : [],
        });
        frame.pc = next;
        return;
      }
      case 'getfield': {
        const cached = this.resolveMember(insn, method);
        const p = this.refParts(insn.cp!);
        const target = this.obj(frame.stack.pop());
        const value = target?.fields?.find((f) => f.name === p.name)?.value ?? { t: 'null' };
        frame.stack.push(value);
        this.emit({
          ...base,
          title: `\`getfield #${insn.cp}\` — ${cached ? '解決済みの結果を使う' : 'フィールドを読む'}`,
          body: cached
            ? `\`#${insn.cp}\` は、\`<init>\` の \`putfield\` がすでに解決しています。命令が違っても、指す番号が同じなら解決は 1 回で済みます。${target ? `${simple(target.className)}@${target.id}` : ''} の \`${p.name}\` の値 ${this.show(value)} を積みます。`
            : `\`${p.name}\` の値 ${this.show(value)} を積みます。`,
          tone: cached ? 'cache' : 'exec',
          focusCp: insn.cp,
          focusHeap: target ? [target.id] : [],
          links: [{ from: key, to: `cp:${insn.cp}` }],
        });
        frame.pc = next;
        return;
      }
      case 'getstatic': {
        const cached = this.resolveMember(insn, method);
        const p = this.refParts(insn.cp!);
        const owner = this.cls(p.className);
        const stat = owner?.statics?.find((s) => s.name === p.name);
        const id = Number(stat?.value.split('@')[1]);
        frame.stack.push({ t: 'ref', id });
        this.emit({
          ...base,
          title: `\`getstatic #${insn.cp}\` — ${cached ? '解決済みの結果を使う' : 'static フィールドを読む'}`,
          body: cached
            ? `\`#${insn.cp}\` は解決済み。クラスを探す手順も、フィールドを探す手順もなく、記録された参照から \`${simple(p.className)}.${p.name}\` の値を読んで積みます。`
            : `フィールドを宣言している \`${p.className}\` は、JVM の起動時に初期化済みです (§5.5)。\`${p.name}\` の値 PrintStream@${id} をスタックに積みます。`,
          tone: cached ? 'cache' : 'exec',
          specs: cached ? ['5.4.3'] : ['6.5.getstatic', '5.5'],
          focusCp: insn.cp,
          focusHeap: [id],
          focusClasses: [p.className],
          links: [
            { from: key, to: `cp:${insn.cp}` },
            { from: `class:${p.className}`, to: `heap:${id}` },
          ],
        });
        frame.pc = next;
        return;
      }
      case 'invokevirtual': {
        const cached = this.resolveMember(insn, method);
        const p = this.refParts(insn.cp!);
        const argc = paramCount(p.descriptor);
        const args = frame.stack.splice(frame.stack.length - argc - 1, argc + 1);
        const receiver = this.obj(args[0]);
        const local = receiver?.className === this.self ? this.methods.get(p.name) : undefined;
        if (local) {
          frame.pc = next;
          this.frames.push(this.frame(local, args));
          this.emit({
            ...base,
            title: `\`invokevirtual #${insn.cp}\` — ${cached ? '解決済みの結果で呼ぶ' : `\`${p.name}\` を呼ぶ`}`,
            body: cached
              ? `\`#${insn.cp}\` は解決済み。レシーバ ${this.show(args[0])} のクラスから \`${p.name}\` を選び、新しいフレームで実行を始めます。`
              : `\`invokevirtual\` は、レシーバの実際のクラスから呼ぶメソッドを選びます (§5.4.6)。${this.show(args[0])} のクラスは ${simple(receiver!.className)} なので、\`${simple(receiver!.className)}.${p.name}\` が選ばれます。新しいフレームのローカル変数 0 番に this を入れて、実行を始めます。`,
            tone: cached ? 'cache' : 'invoke',
            specs: cached ? ['5.4.3'] : ['5.4.6', '6.5.invokevirtual'],
            focusCp: insn.cp,
            focusHeap: receiver ? [receiver.id] : [],
            links: [{ from: key, to: `frame:${this.frames.length - 1}` }],
          });
          return;
        }
        const arg = this.obj(args[1]);
        const printed = arg?.type === 'String' ? arg.text ?? '' : this.show(args[1]);
        this.console.push(printed);
        this.emit({
          ...base,
          title: `\`invokevirtual #${insn.cp}\` — ${cached ? '解決済みの結果で呼ぶ' : `\`${p.name}\` を呼ぶ`}`,
          body: `${this.cacheNote(insn, cached)}レシーバ ${this.show(args[0])} のクラスから \`${p.name}${prettyDescriptor(p.descriptor).split(' → ')[0]}\` を選んで呼びます (中身は省略)。コンソールに ${printed} が出力されます。`,
          tone: cached ? 'cache' : 'invoke',
          specs: cached ? ['5.4.3'] : ['5.4.6', '6.5.invokevirtual'],
          focusCp: insn.cp,
          focusHeap: arg ? [arg.id] : [],
          links: [{ from: key, to: 'console' }],
        });
        frame.pc = next;
        return;
      }
      case 'invokedynamic':
        this.invokedynamic(insn, frame, method, key, next);
        return;
      case 'areturn':
      case 'return': {
        const value = insn.mnemonic === 'areturn' ? frame.stack.pop() : undefined;
        this.frames.pop();
        const caller = this.frames[this.frames.length - 1];
        if (caller && value) caller.stack.push(value);
        this.emit({
          ...base,
          title: `\`${insn.mnemonic}\` — ${frame.method} から戻る`,
          body: caller
            ? `\`${frame.method}\` が終わりました。フレームを捨てて、\`${caller.method}\` の続き (pc ${caller.pc}) に戻ります。` +
              (value ? `戻り値 ${this.show(value)} は呼び出し元のスタックに積まれます。` : '')
            : '`main` が終わり、フレームがなくなりました。',
          tone: 'exec',
          specs: [`6.5.${insn.mnemonic}`],
          focusHeap: value?.t === 'ref' ? [value.id] : [],
          links: caller ? [{ from: key, to: `frame:${this.frames.length - 1}` }] : [],
        });
        return;
      }
      default:
        this.emit({ ...base, title: `\`${insn.mnemonic}\``, body: 'この命令の動きは省略します。', tone: 'exec' });
        frame.pc = next;
    }
  }

  private invokedynamic(insn: Instruction, frame: Frame, method: string, key: string, next: number): void {
    const index = insn.cp!;
    const row = this.row(index);
    const entry = this.cf.pool[index]!;
    const bm = this.bsms[entry.bootstrapIndex ?? 0];
    const natIndex = entry.refs[0].index;
    const nat = this.cf.pool[natIndex]!;
    const name = cpText(this.cf, nat.refs[0].index);
    const descriptor = cpText(this.cf, nat.refs[1].index);
    const site = `${method} pc ${insn.pc}`;
    const base = { method, pc: insn.pc };
    const arg = frame.stack[frame.stack.length - 1];
    const argObj = this.obj(arg);
    const recipeIndex = bm.args[0];
    const recipe = recipeIndex ? cpText(this.cf, recipeIndex) : '';
    const shownRecipe = recipe.replace(//g, '\\u0001');
    const concat = () => recipe.replace(//g, argObj?.text ?? '');

    const existing = row.result?.startsWith(site) ? this.heap.find((o) => o.type === 'CallSite' && o.tag === site) : undefined;
    if (existing) {
      this.hits++;
      frame.stack.pop();
      const id = this.alloc({ type: 'String', className: 'java/lang/String', text: concat() });
      frame.stack.push({ t: 'ref', id });
      this.emit({
        ...base,
        title: `\`invokedynamic #${index}\` — 結びついた CallSite を使う`,
        body: `この命令はすでに CallSite@${existing.id} に結びついています。ブートストラップメソッドは**呼ばれません**。同じ CallSite のメソッドハンドルを ${this.show(arg)} で呼び、新しい String "${concat()}" を積みます。`,
        tone: 'cache',
        specs: ['5.4.3', '6.5.invokedynamic'],
        focusCp: index,
        focusHeap: [existing.id, id],
        links: [
          { from: key, to: `heap:${existing.id}` },
          { from: `heap:${existing.id}`, to: `heap:${id}` },
        ],
      });
      frame.pc = next;
      return;
    }

    const mh = this.cf.pool[bm.ref]!;
    const target = this.refParts(mh.refs[0].index);
    const steps = [
      `bootstrap_method_attr_index → BootstrapMethods[${entry.bootstrapIndex}]`,
      `メソッドハンドル \`#${bm.ref}\` を解決`,
      `記述子から MethodType を作り、静的引数を用意`,
      `ブートストラップメソッドを呼ぶ`,
      `返ってきた CallSite をこの命令に結びつける`,
    ];
    const chain = (done: number): ChainItem[] =>
      steps.map((text, i) => ({ text, state: i < done ? 'done' : i === done ? 'active' : 'todo' }));

    this.emit({
      ...base,
      title: `\`invokedynamic #${index}\` — 呼び出し地点を解決する`,
      body: `\`#${index}\` は InvokeDynamic。bootstrap_method_attr_index が BootstrapMethods 属性の ${entry.bootstrapIndex} 番を指し、名前と型は \`${name}\` \`${descriptor}\` です。これから、**この命令のための**呼び出し先を作ります。`,
      tone: 'resolve',
      specs: ['5.4.3.6', '4.7.23'],
      focusCp: index,
      chainCp: index,
      chain: chain(1),
      links: [{ from: key, to: `cp:${index}` }],
    });

    const classRow = this.row(target.classIndex);
    if (classRow.state !== 'resolved') {
      classRow.state = 'resolved';
      classRow.result = `class ${simple(target.className)}`;
      this.resolutions++;
    }
    if (!this.cls(target.className)) {
      this.classes.push({ name: target.className, loader: 'ブートストラップ', phase: 2, jdk: true });
    }
    const mhRow = this.row(bm.ref);
    mhRow.state = 'resolved';
    mhRow.result = `MethodHandle → ${simple(target.className)}.${target.name}`;
    this.resolutions++;
    this.emit({
      ...base,
      title: `\`#${bm.ref}\` MethodHandle を解決する`,
      body: `\`#${bm.ref}\` は ${mh.parts.find((x) => x.name === 'reference_kind')?.value.split(' ')[1].slice(1, -1)} のメソッドハンドルで、\`#${mh.refs[0].index}\` の Methodref を指します。その class_index \`#${target.classIndex}\` から \`${target.className}\` を解決し (ロードされていなければ、ここでロードします)、\`${target.name}\` を探します。`,
      tone: 'resolve',
      specs: ['5.4.3.5'],
      focusCp: bm.ref,
      chainCp: index,
      chain: chain(2),
      focusClasses: [target.className],
      links: [
        { from: `cp:${index}`, to: `cp:${bm.ref}` },
        { from: `cp:${bm.ref}`, to: `class:${target.className}` },
      ],
    });

    let recipeId: number | undefined;
    if (recipeIndex) {
      recipeId = this.alloc({ type: 'String', className: 'java/lang/String', text: shownRecipe, tag: 'intern 済み' });
      const recipeRow = this.row(recipeIndex);
      recipeRow.result = `String@${recipeId}`;
    }
    const [params, ret] = prettyDescriptor(descriptor).split(' → ');
    this.emit({
      ...base,
      title: 'MethodType と静的引数を用意する',
      body: `\`#${index}\` の記述子から MethodType \`${params}${ret}\` を作ります。静的引数 \`#${recipeIndex}\` は文字列定数なので、レシピ \`"${shownRecipe}"\` の String を用意します。\`\\u0001\` の位置に、実行時の引数が入ります。`,
      tone: 'static',
      specs: ['5.4.3.6'],
      focusCp: recipeIndex,
      chainCp: index,
      chain: chain(3),
      focusHeap: recipeId ? [recipeId] : [],
      links: recipeId ? [{ from: `cp:${recipeIndex}`, to: `heap:${recipeId}` }] : [],
    });

    const factory = this.cls(target.className)!;
    factory.phase = 3;
    const siteId = this.alloc({ type: 'CallSite', className: 'java/lang/invoke/CallSite', tag: site });
    this.emit({
      ...base,
      title: 'ブートストラップメソッドを呼ぶ',
      body: `\`${simple(target.className)}.${target.name}\` に、Lookup、名前 \`"${name}"\`、MethodType、レシピを渡して呼びます。REF_invokeStatic のハンドルを初めて呼ぶので、\`${simple(target.className)}\` がまだ初期化されていなければ、ここで初期化されます (§5.5)。戻り値は **CallSite** です。`,
      tone: 'invoke',
      specs: ['5.4.3.6', '5.5'],
      focusCp: index,
      chainCp: index,
      chain: chain(4),
      focusClasses: [target.className],
      focusHeap: [siteId],
      links: [{ from: `class:${target.className}`, to: `heap:${siteId}` }],
    });

    row.state = 'resolved';
    row.result = `${site} → CallSite@${siteId}`;
    this.resolutions++;
    frame.stack.pop();
    const id = this.alloc({ type: 'String', className: 'java/lang/String', text: concat() });
    frame.stack.push({ t: 'ref', id });
    this.emit({
      ...base,
      title: 'CallSite を結びつけて呼ぶ',
      body: `CallSite@${siteId} は **この invokedynamic 命令 (${site}) だけ**に結びつきます。同じ \`#${index}\` を指す別の命令があっても、そちらは未解決のままです (§5.4.3)。CallSite のメソッドハンドルを ${this.show(arg)} で呼び、"${concat()}" をスタックに積みます。`,
      tone: 'resolve',
      specs: ['5.4.3', '6.5.invokedynamic'],
      focusCp: index,
      chainCp: index,
      chain: chain(5),
      focusHeap: [siteId, id],
      links: [
        { from: `cp:${index}`, to: `heap:${siteId}` },
        { from: `heap:${siteId}`, to: `heap:${id}` },
      ],
    });
    frame.pc = next;
  }

  private finish(): void {
    this.emit({
      title: '実行が終わりました',
      body: `記号参照の解決は **${this.resolutions} 回**、解決済みの結果の再利用は **${this.hits} 回**でした。2 回目の \`System.out.println(g.greet())\` では、どの命令も解決の手順を踏まず、記録された結果をそのまま使っています。`,
      tone: 'done',
      specs: ['5.4.3', '5.7'],
    });
  }
}

export function simulate(cf: ClassFile): Snapshot[] {
  return new Machine(cf).run();
}
