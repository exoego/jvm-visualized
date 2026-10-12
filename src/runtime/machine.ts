import { cpText, prettyDescriptor } from '../classfile/describe';
import type { ClassFile, CodeInfo, CpKind, Instruction, Member } from '../classfile/types';
import copyText from '../copy/machine.md?raw';
import { loadCopy } from '../ui/copy';

const copy = loadCopy(copyText, 'machine');

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

const defaultValue = (descriptor: string) =>
  ({ Z: 'false', F: '0.0', D: '0.0', L: 'null', '[': 'null' } as Record<string, string>)[descriptor[0]] ?? '0';

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
      ...copy.step('boot'),
      tone: 'load',
      specs: ['5.2', '5.3'],
      focusClasses: [this.self],
    });

    this.buildRcp();
    this.emit({
      ...copy.step('rcp'),
      tone: 'load',
      specs: ['5.1'],
      focusClasses: [this.self],
    });

    const constants = this.cf.fields.filter(
      (f) => (f.accessFlags & 0x0018) === 0x0018 && f.attributes.some((a) => a.name === 'ConstantValue'),
    );
    const self = this.cls(this.self)!;
    self.phase = 2;
    self.statics = this.cf.fields
      .filter((f) => f.accessFlags & 0x0008)
      .map((f) => ({ name: f.name, value: defaultValue(f.descriptor) }));
    this.emit({
      title: copy.title('link'),
      body:
        copy.body('link') +
        (constants.length ? copy.body('link-default', { name: constants[0].name, value: defaultValue(constants[0].descriptor) }) : ''),
      tone: 'load',
      specs: ['5.4.1', '5.4.2'],
      focusClasses: [this.self],
    });

    self.phase = 3;
    const assigned: string[] = [];
    const focusHeap: number[] = [];
    const links: Link[] = [];
    for (const field of constants) {
      const cvIndex = field.attributes.find((a) => a.name === 'ConstantValue')!.constantValue!;
      const entry = this.cf.pool[cvIndex]!;
      let shown: string;
      if (entry.kind === 'String') {
        const text = cpText(this.cf, cvIndex);
        const id = this.alloc({ type: 'String', className: 'java/lang/String', text, tag: 'intern 済み' });
        shown = `"${text}"`;
        focusHeap.push(id);
        links.push({ from: `class:${this.self}`, to: `heap:${id}` });
      } else {
        shown = entry.kind === 'Long' ? `${entry.number}L` : String(entry.number);
      }
      self.statics = self.statics?.map((st) => (st.name === field.name ? { ...st, value: shown } : st));
      assigned.push(copy.title('init-assigned', { name: field.name, index: cvIndex, value: shown }));
    }
    const clinit = this.methods.has('<clinit>');
    this.emit({
      title: copy.title('init'),
      body:
        (assigned.length
          ? copy.body('init-constants', { assigned: assigned.join('、') }) + (focusHeap.length ? copy.body('init-intern') : '')
          : '') +
        (clinit ? copy.body('init-clinit') : copy.body('init-no-clinit', { self: simple(this.self) })),
      tone: 'static',
      specs: ['5.5', '4.7.2'],
      focusClasses: [this.self],
      focusHeap,
      links,
    });

    const args = this.alloc({ type: 'array', className: 'java/lang/String[]', text: 'length = 0', tag: 'args' });
    const main = this.methods.get('main')!;
    this.frames.push(this.frame(main, [{ t: 'ref', id: args }]));
    this.emit({
      ...copy.step('main'),
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
    const what = copy.title(isField ? 'field' : 'method');
    const classRow = this.row(p.classIndex);
    const classWasResolved = classRow.state === 'resolved';
    const chain: ChainItem[] = [
      {
        text: classWasResolved
          ? copy.title('chain-class-done', { classIndex: p.classIndex, className: simple(p.className) })
          : copy.title('chain-class-resolve', { classIndex: p.classIndex, className: p.className }),
        state: 'done',
      },
      { text: copy.title('chain-nat', { natIndex: p.natIndex, name: p.name, descriptor: p.descriptor }), state: 'done' },
      { text: copy.title('chain-lookup', { className: simple(p.className), what }), state: 'active' },
      { text: copy.title('chain-record', { what, index }), state: 'todo' },
    ];
    this.resolveClass(p.classIndex);
    const jdkNote = this.cls(p.className)?.jdk && !classWasResolved ? copy.body('resolve-jdk-note', { className: p.className }) : '';
    this.emit({
      title: copy.title('resolve', { mnemonic: insn.mnemonic, index }),
      body:
        copy.body('resolve', { mnemonic: insn.mnemonic, index, kind: p.entry.kind }) +
        (classWasResolved ? copy.body('resolve-class-cached', { classIndex: p.classIndex }) : copy.body('resolve-class-fresh') + jdkNote),
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
      title: copy.title('resolved', { index }),
      body: copy.body('resolved', { className: simple(p.className), what, name: p.name, index }),
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
    return cached ? copy.body('cache-note', { index: insn.cp! }) : '';
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
          title: copy.title('aload', { mnemonic: insn.mnemonic }),
          body: copy.body('aload', { n, value: this.show(frame.locals[n] ?? undefined) }),
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
          ...copy.step('astore', { value: this.show(v) }),
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
          ...copy.step('dup'),
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
            ...copy.step('new-resolve', { index, nameIndex, name }),
            tone: 'resolve',
            specs: ['5.4.3.1'],
            focusCp: index,
            chain: [
              { text: copy.title('new-chain-name', { nameIndex, name }), state: 'done' },
              { text: copy.title('new-chain-find', { name }), state: 'active' },
              { text: copy.title('new-chain-record', { index }), state: 'todo' },
            ],
            links: [{ from: key, to: `cp:${index}` }],
          });
          this.resolveClass(index);
          this.emit({
            ...base,
            ...copy.step('new-resolved', { index, name }),
            tone: 'resolve',
            specs: ['5.4.3.1'],
            focusCp: index,
            focusClasses: [name],
            chain: [
              { text: copy.title('new-chain-name', { nameIndex, name }), state: 'done' },
              { text: copy.title('new-chain-find', { name }), state: 'done' },
              { text: copy.title('new-chain-record', { index }), state: 'done' },
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
          title: copy.title('new-alloc'),
          body: this.cacheNote(insn, cached) + copy.body('new-alloc', { name, fields: fields.map((f) => `${f.name} = null`).join(', ') }),
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
            title: copy.title('ldc', { index }),
            body: copy.body(first ? 'ldc-first' : 'ldc-again'),
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
            title: copy.title('invokespecial-local', { name: p.name }),
            body: this.cacheNote(insn, cached) + copy.body('invokespecial-local', { args: args.map((a) => this.show(a)).join(' と ') }),
            tone: cached ? 'cache' : 'invoke',
            focusCp: insn.cp,
            links: [{ from: key, to: `frame:${this.frames.length - 1}` }],
          });
        } else {
          this.emit({
            ...base,
            title: copy.title('invokespecial-jdk', { method: `${simple(p.className)}.${p.name}` }),
            body:
              this.cacheNote(insn, cached) +
              copy.body('invokespecial-jdk', { receiver: this.show(args[0]), target: `${p.className}.${p.name}${p.descriptor}` }),
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
          title: copy.title('putfield'),
          body:
            this.cacheNote(insn, cached) +
            copy.body('putfield', { value: this.show(value), target: target ? `${simple(target.className)}@${target.id}` : '', name: p.name }),
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
          title: copy.title(cached ? 'getfield-cached' : 'getfield', { index: insn.cp! }),
          body: cached
            ? copy.body('getfield-cached', {
                index: insn.cp!,
                target: target ? `${simple(target.className)}@${target.id}` : '',
                name: p.name,
                value: this.show(value),
              })
            : copy.body('getfield', { name: p.name, value: this.show(value) }),
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
          title: copy.title(cached ? 'getstatic-cached' : 'getstatic', { index: insn.cp! }),
          body: cached
            ? copy.body('getstatic-cached', { index: insn.cp!, owner: simple(p.className), name: p.name })
            : copy.body('getstatic', { className: p.className, name: p.name, id }),
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
            title: copy.title(cached ? 'invokevirtual-cached' : 'invokevirtual', { index: insn.cp!, name: p.name }),
            body: cached
              ? copy.body('invokevirtual-local-cached', { index: insn.cp!, receiver: this.show(args[0]), name: p.name })
              : copy.body('invokevirtual-local', { receiver: this.show(args[0]), className: simple(receiver!.className), name: p.name }),
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
          title: copy.title(cached ? 'invokevirtual-cached' : 'invokevirtual', { index: insn.cp!, name: p.name }),
          body:
            this.cacheNote(insn, cached) +
            copy.body('invokevirtual-jdk', {
              receiver: this.show(args[0]),
              method: `${p.name}${prettyDescriptor(p.descriptor).split(' → ')[0]}`,
              printed,
            }),
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
          title: copy.title('return', { mnemonic: insn.mnemonic, method: frame.method }),
          body: caller
            ? copy.body('return-caller', { method: frame.method, caller: caller.method, pc: caller.pc }) +
              (value ? copy.body('return-value', { value: this.show(value) }) : '')
            : copy.body('return-main'),
          tone: 'exec',
          specs: [`6.5.${insn.mnemonic}`],
          focusHeap: value?.t === 'ref' ? [value.id] : [],
          links: caller ? [{ from: key, to: `frame:${this.frames.length - 1}` }] : [],
        });
        return;
      }
      default:
        this.emit({ ...base, ...copy.step('skip', { mnemonic: insn.mnemonic }), tone: 'exec' });
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
        ...copy.step('indy-cached', { index, site: existing.id, arg: this.show(arg), result: concat() }),
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
    const bootstrapIndex = entry.bootstrapIndex ?? 0;
    const steps = [
      copy.title('indy-step-attr', { bootstrapIndex }),
      copy.title('indy-step-handle', { ref: bm.ref }),
      copy.title('indy-step-type'),
      copy.title('indy-step-call'),
      copy.title('indy-step-bind'),
    ];
    const chain = (done: number): ChainItem[] =>
      steps.map((text, i) => ({ text, state: i < done ? 'done' : i === done ? 'active' : 'todo' }));

    this.emit({
      ...base,
      ...copy.step('indy', { index, bootstrapIndex, name, descriptor }),
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
      ...copy.step('indy-handle', {
        ref: bm.ref,
        kind: mh.parts.find((x) => x.name === 'reference_kind')?.value.split(' ')[1].slice(1, -1) ?? '',
        methodref: mh.refs[0].index,
        classIndex: target.classIndex,
        className: target.className,
        name: target.name,
      }),
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
      ...copy.step('indy-type', { index, type: `${params}${ret}`, recipeIndex: recipeIndex ?? 0, recipe: shownRecipe }),
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
      ...copy.step('indy-call', { factory: simple(target.className), method: target.name, name }),
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
      ...copy.step('indy-bind', { site: siteId, at: site, index, arg: this.show(arg), result: concat() }),
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
      ...copy.step('done', { resolutions: this.resolutions, hits: this.hits }),
      tone: 'done',
      specs: ['5.4.3', '5.7'],
    });
  }
}

export function simulate(cf: ClassFile): Snapshot[] {
  return new Machine(cf).run();
}
