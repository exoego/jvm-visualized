import { OPCODES } from './opcodes';
import { REF_KINDS, utf8At } from './describe';
import type {
  Attribute,
  BootstrapMethod,
  ClassFile,
  CodeInfo,
  CpEntry,
  CpKind,
  CpRef,
  Instruction,
  Member,
  Operand,
  Part,
  Span,
  TopItem,
  Usage,
} from './types';

export class ClassFormatError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

const CP_KINDS: Record<number, CpKind> = {
  1: 'Utf8',
  3: 'Integer',
  4: 'Float',
  5: 'Long',
  6: 'Double',
  7: 'Class',
  8: 'String',
  9: 'Fieldref',
  10: 'Methodref',
  11: 'InterfaceMethodref',
  12: 'NameAndType',
  15: 'MethodHandle',
  16: 'MethodType',
  17: 'Dynamic',
  18: 'InvokeDynamic',
  19: 'Module',
  20: 'Package',
};

class Reader {
  pos = 0;
  private view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  need(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new ClassFormatError(`${this.pos} バイト目でファイルが途切れています`, this.pos);
    }
  }

  u1(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  u2(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }

  u4(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }

  get dataView(): DataView {
    return this.view;
  }
}

export function decodeModifiedUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const a = bytes[i];
    if (a > 0 && a < 0x80) {
      out += String.fromCharCode(a);
      i += 1;
    } else if ((a & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((a & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((a & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      out += String.fromCharCode(
        ((a & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      out += '\uFFFD';
      i += 1;
    }
  }
  return out;
}

const span = (start: number, end: number): Span => ({ start, end });

function u2Part(r: Reader, parts: Part[], name: string, asCp: boolean): number {
  const start = r.pos;
  const v = r.u2();
  const part: Part = { name, type: 'u2', span: span(start, start + 2), value: String(v) };
  if (asCp && v !== 0) {
    part.value = `#${v}`;
    part.cp = v;
  }
  parts.push(part);
  return v;
}

function parsePool(r: Reader, count: number): (CpEntry | undefined)[] {
  const pool: (CpEntry | undefined)[] = [undefined];
  for (let index = 1; index < count; index++) {
    const start = r.pos;
    const tag = r.u1();
    const kind = CP_KINDS[tag];
    if (!kind) {
      throw new ClassFormatError(`定数プール #${index} の tag ${tag} は仕様にありません`, start);
    }
    const parts: Part[] = [
      { name: 'tag', type: 'u1', span: span(start, start + 1), value: `${tag} (${kind})` },
    ];
    const refs: CpRef[] = [];
    const entry: CpEntry = { index, tag, kind, span: span(start, start), parts, refs };
    const ref = (field: string) => {
      const v = u2Part(r, parts, field, true);
      refs.push({ field, index: v });
    };

    switch (kind) {
      case 'Utf8': {
        const length = u2Part(r, parts, 'length', false);
        const bytesStart = r.pos;
        r.skip(length);
        entry.utf8 = decodeModifiedUtf8(r.bytes.subarray(bytesStart, bytesStart + length));
        parts.push({
          name: 'bytes',
          type: `u1[${length}]`,
          span: span(bytesStart, bytesStart + length),
          value: JSON.stringify(entry.utf8),
        });
        break;
      }
      case 'Integer':
      case 'Float': {
        const s = r.pos;
        r.skip(4);
        entry.number =
          kind === 'Integer' ? r.dataView.getInt32(s) : r.dataView.getFloat32(s);
        parts.push({ name: 'bytes', type: 'u4', span: span(s, s + 4), value: String(entry.number) });
        break;
      }
      case 'Long':
      case 'Double': {
        const s = r.pos;
        r.skip(8);
        entry.number =
          kind === 'Long' ? r.dataView.getBigInt64(s) : r.dataView.getFloat64(s);
        parts.push({ name: 'high_bytes', type: 'u4', span: span(s, s + 4), value: '' });
        parts.push({ name: 'low_bytes', type: 'u4', span: span(s + 4, s + 8), value: '' });
        break;
      }
      case 'Class':
      case 'Module':
      case 'Package':
        ref('name_index');
        break;
      case 'String':
        ref('string_index');
        break;
      case 'Fieldref':
      case 'Methodref':
      case 'InterfaceMethodref':
        ref('class_index');
        ref('name_and_type_index');
        break;
      case 'NameAndType':
        ref('name_index');
        ref('descriptor_index');
        break;
      case 'MethodHandle': {
        const s = r.pos;
        const k = r.u1();
        entry.referenceKind = k;
        parts.push({
          name: 'reference_kind',
          type: 'u1',
          span: span(s, s + 1),
          value: `${k} (${REF_KINDS[k] ?? '?'})`,
        });
        ref('reference_index');
        break;
      }
      case 'MethodType':
        ref('descriptor_index');
        break;
      case 'Dynamic':
      case 'InvokeDynamic':
        entry.bootstrapIndex = u2Part(r, parts, 'bootstrap_method_attr_index', false);
        ref('name_and_type_index');
        break;
    }

    entry.span.end = r.pos;
    pool[index] = entry;
    if (kind === 'Long' || kind === 'Double') {
      index++;
      pool[index] = undefined;
    }
  }
  return pool;
}

function decodeCode(bytes: Uint8Array, offset: number, length: number): Instruction[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, length);
  const out: Instruction[] = [];
  let pc = 0;
  while (pc < length) {
    const opcode = view.getUint8(pc);
    const info = OPCODES[opcode];
    if (!info) {
      throw new ClassFormatError(
        `不明なオペコード 0x${opcode.toString(16)} (pc ${pc})`,
        offset + pc,
      );
    }
    let mnemonic = info.mnemonic;
    const operands: Operand[] = [];
    let cp: number | undefined;
    let len = 1;
    const guard = (n: number) => {
      if (pc + n > length) {
        throw new ClassFormatError(`pc ${pc} の ${mnemonic} が Code の外にはみ出しています`, offset + pc);
      }
    };

    switch (info.format) {
      case 'c1':
        guard(2);
        cp = view.getUint8(pc + 1);
        operands.push({ name: 'index', value: cp, cp: true });
        len = 2;
        break;
      case 'c2':
        guard(3);
        cp = view.getUint16(pc + 1);
        operands.push({ name: 'index', value: cp, cp: true });
        len = 3;
        break;
      case 'l1':
        guard(2);
        operands.push({ name: 'index', value: view.getUint8(pc + 1) });
        len = 2;
        break;
      case 'b1':
        guard(2);
        operands.push({ name: 'byte', value: view.getInt8(pc + 1) });
        len = 2;
        break;
      case 's2':
        guard(3);
        operands.push({ name: 'short', value: view.getInt16(pc + 1) });
        len = 3;
        break;
      case 'j2':
        guard(3);
        operands.push({ name: 'target', value: pc + view.getInt16(pc + 1) });
        len = 3;
        break;
      case 'j4':
        guard(5);
        operands.push({ name: 'target', value: pc + view.getInt32(pc + 1) });
        len = 5;
        break;
      case 'i':
        guard(3);
        operands.push({ name: 'index', value: view.getUint8(pc + 1) });
        operands.push({ name: 'const', value: view.getInt8(pc + 2) });
        len = 3;
        break;
      case 'I':
        guard(5);
        cp = view.getUint16(pc + 1);
        operands.push({ name: 'index', value: cp, cp: true });
        operands.push({ name: 'count', value: view.getUint8(pc + 3) });
        len = 5;
        break;
      case 'D':
        guard(5);
        cp = view.getUint16(pc + 1);
        operands.push({ name: 'index', value: cp, cp: true });
        len = 5;
        break;
      case 'n':
        guard(2);
        operands.push({ name: 'atype', value: view.getUint8(pc + 1) });
        len = 2;
        break;
      case 'M':
        guard(4);
        cp = view.getUint16(pc + 1);
        operands.push({ name: 'index', value: cp, cp: true });
        operands.push({ name: 'dimensions', value: view.getUint8(pc + 3) });
        len = 4;
        break;
      case 'W': {
        guard(2);
        const inner = view.getUint8(pc + 1);
        mnemonic = `wide ${OPCODES[inner]?.mnemonic ?? '?'}`;
        len = inner === 0x84 ? 6 : 4;
        guard(len);
        operands.push({ name: 'index', value: view.getUint16(pc + 2) });
        if (inner === 0x84) operands.push({ name: 'const', value: view.getInt16(pc + 4) });
        break;
      }
      case 'T': {
        const pad = (4 - ((pc + 1) % 4)) % 4;
        guard(1 + pad + 12);
        const base = pc + 1 + pad;
        const low = view.getInt32(base + 4);
        const high = view.getInt32(base + 8);
        len = 1 + pad + 12 + (high - low + 1) * 4;
        guard(len);
        operands.push({ name: 'default', value: pc + view.getInt32(base) });
        operands.push({ name: 'low', value: low });
        operands.push({ name: 'high', value: high });
        break;
      }
      case 'L': {
        const pad = (4 - ((pc + 1) % 4)) % 4;
        guard(1 + pad + 8);
        const base = pc + 1 + pad;
        const npairs = view.getInt32(base + 4);
        len = 1 + pad + 8 + npairs * 8;
        guard(len);
        operands.push({ name: 'default', value: pc + view.getInt32(base) });
        operands.push({ name: 'npairs', value: npairs });
        break;
      }
    }

    out.push({ pc, offset: offset + pc, opcode, mnemonic, length: len, operands, cp });
    pc += len;
  }
  return out;
}

function parseAttributes(
  r: Reader,
  parts: Part[],
  pool: (CpEntry | undefined)[],
): Attribute[] {
  const count = u2Part(r, parts, 'attributes_count', false);
  const attributes: Attribute[] = [];
  for (let i = 0; i < count; i++) {
    const attribute = parseAttribute(r, pool);
    attributes.push(attribute);
    parts.push({
      name: `attributes[${i}]`,
      type: attribute.name,
      span: attribute.span,
      value: `${attribute.span.end - attribute.span.start} バイト`,
    });
  }
  return attributes;
}

function parseAttribute(r: Reader, pool: (CpEntry | undefined)[]): Attribute {
  const start = r.pos;
  const parts: Part[] = [];
  const nameIndex = u2Part(r, parts, 'attribute_name_index', true);
  const lengthStart = r.pos;
  const length = r.u4();
  parts.push({
    name: 'attribute_length',
    type: 'u4',
    span: span(lengthStart, lengthStart + 4),
    value: String(length),
  });
  const infoStart = r.pos;
  r.need(length);
  const end = infoStart + length;
  const name = utf8At(pool, nameIndex) ?? `#${nameIndex}`;
  const attribute: Attribute = { name, nameIndex, span: span(start, end), parts };

  const headerParts = parts.length;
  try {
    decodeAttributeInfo(r, attribute, pool);
    if (r.pos !== end) throw new Error('length mismatch');
  } catch {
    parts.length = headerParts;
    delete attribute.code;
    delete attribute.bootstrapMethods;
    delete attribute.constantValue;
    delete attribute.lineNumbers;
    if (length > 0) {
      parts.push({ name: 'info', type: `u1[${length}]`, span: span(infoStart, end), value: '' });
    }
  }
  r.pos = end;
  return attribute;
}

function decodeAttributeInfo(
  r: Reader,
  attribute: Attribute,
  pool: (CpEntry | undefined)[],
): void {
  const parts = attribute.parts;
  const table = (countName: string, rowName: string, fields: [string, boolean][]) => {
    const n = u2Part(r, parts, countName, false);
    for (let i = 0; i < n; i++) {
      for (const [field, asCp] of fields) {
        u2Part(r, parts, field ? `${rowName}[${i}].${field}` : `${rowName}[${i}]`, asCp);
      }
    }
  };

  switch (attribute.name) {
    case 'ConstantValue':
      attribute.constantValue = u2Part(r, parts, 'constantvalue_index', true);
      return;
    case 'SourceFile':
      u2Part(r, parts, 'sourcefile_index', true);
      return;
    case 'Signature':
      u2Part(r, parts, 'signature_index', true);
      return;
    case 'NestHost':
      u2Part(r, parts, 'host_class_index', true);
      return;
    case 'Exceptions':
      table('number_of_exceptions', 'exception_index_table', [['', true]]);
      return;
    case 'NestMembers':
    case 'PermittedSubclasses':
      table('number_of_classes', 'classes', [['', true]]);
      return;
    case 'EnclosingMethod':
      u2Part(r, parts, 'class_index', true);
      u2Part(r, parts, 'method_index', true);
      return;
    case 'InnerClasses':
      table('number_of_classes', 'classes', [
        ['inner_class_info_index', true],
        ['outer_class_info_index', true],
        ['inner_name_index', true],
        ['inner_class_access_flags', false],
      ]);
      return;
    case 'LineNumberTable': {
      const n = u2Part(r, parts, 'line_number_table_length', false);
      attribute.lineNumbers = [];
      for (let i = 0; i < n; i++) {
        const pc = u2Part(r, parts, `line_number_table[${i}].start_pc`, false);
        const line = u2Part(r, parts, `line_number_table[${i}].line_number`, false);
        attribute.lineNumbers.push({ pc, line });
      }
      return;
    }
    case 'LocalVariableTable':
    case 'LocalVariableTypeTable':
      table(`${attribute.name === 'LocalVariableTable' ? 'local_variable' : 'local_variable_type'}_table_length`, 'table', [
        ['start_pc', false],
        ['length', false],
        ['name_index', true],
        [attribute.name === 'LocalVariableTable' ? 'descriptor_index' : 'signature_index', true],
        ['index', false],
      ]);
      return;
    case 'BootstrapMethods': {
      const n = u2Part(r, parts, 'num_bootstrap_methods', false);
      attribute.bootstrapMethods = [];
      for (let i = 0; i < n; i++) {
        const s = r.pos;
        const ref = u2Part(r, parts, `bootstrap_methods[${i}].bootstrap_method_ref`, true);
        const argc = u2Part(r, parts, `bootstrap_methods[${i}].num_bootstrap_arguments`, false);
        const args: number[] = [];
        for (let j = 0; j < argc; j++) {
          args.push(u2Part(r, parts, `bootstrap_methods[${i}].bootstrap_arguments[${j}]`, true));
        }
        const bm: BootstrapMethod = { ref, args, span: span(s, r.pos) };
        attribute.bootstrapMethods.push(bm);
      }
      return;
    }
    case 'Code': {
      const maxStack = u2Part(r, parts, 'max_stack', false);
      const maxLocals = u2Part(r, parts, 'max_locals', false);
      const lenStart = r.pos;
      const codeLength = r.u4();
      parts.push({ name: 'code_length', type: 'u4', span: span(lenStart, lenStart + 4), value: String(codeLength) });
      const codeStart = r.pos;
      r.skip(codeLength);
      const instructions = decodeCode(r.bytes, codeStart, codeLength);
      parts.push({
        name: 'code',
        type: `u1[${codeLength}]`,
        span: span(codeStart, codeStart + codeLength),
        value: `${instructions.length} 命令`,
      });
      table('exception_table_length', 'exception_table', [
        ['start_pc', false],
        ['end_pc', false],
        ['handler_pc', false],
        ['catch_type', true],
      ]);
      const code: CodeInfo = {
        maxStack,
        maxLocals,
        codeSpan: span(codeStart, codeStart + codeLength),
        instructions,
        attributes: [],
      };
      code.attributes = parseAttributes(r, parts, pool);
      attribute.code = code;
      return;
    }
    default:
      if (attribute.span.end > r.pos) {
        parts.push({
          name: 'info',
          type: `u1[${attribute.span.end - r.pos}]`,
          span: span(r.pos, attribute.span.end),
          value: '',
        });
        r.pos = attribute.span.end;
      }
  }
}

function parseMember(
  r: Reader,
  kind: 'field' | 'method',
  index: number,
  pool: (CpEntry | undefined)[],
): Member {
  const start = r.pos;
  const parts: Part[] = [];
  const flagsStart = r.pos;
  const accessFlags = r.u2();
  parts.push({
    name: 'access_flags',
    type: 'u2',
    span: span(flagsStart, flagsStart + 2),
    value: `0x${accessFlags.toString(16).padStart(4, '0')}`,
  });
  const nameIndex = u2Part(r, parts, 'name_index', true);
  const descriptorIndex = u2Part(r, parts, 'descriptor_index', true);
  const attributes = parseAttributes(r, parts, pool);
  return {
    kind,
    index,
    accessFlags,
    nameIndex,
    descriptorIndex,
    name: utf8At(pool, nameIndex) ?? `#${nameIndex}`,
    descriptor: utf8At(pool, descriptorIndex) ?? `#${descriptorIndex}`,
    span: span(start, r.pos),
    parts,
    attributes,
  };
}

function collectUsages(cf: ClassFile): Map<number, Usage[]> {
  const usages = new Map<number, Usage[]>();
  const add = (index: number | undefined, usage: Usage) => {
    if (!index) return;
    const list = usages.get(index) ?? [];
    list.push(usage);
    usages.set(index, list);
  };

  for (const entry of cf.pool) {
    if (!entry) continue;
    for (const ref of entry.refs) {
      add(ref.index, { label: `#${entry.index} ${entry.kind} の ${ref.field}`, from: entry.index });
    }
  }
  add(cf.thisClass, { label: 'this_class' });
  add(cf.superClass, { label: 'super_class' });
  cf.interfaces.forEach((v, i) => add(v, { label: `interfaces[${i}]` }));

  const walkAttributes = (attributes: Attribute[], path: string, method?: string) => {
    attributes.forEach((attribute, i) => {
      const here = `${path}attributes[${i}]`;
      for (const part of attribute.parts) {
        add(part.cp, { label: `${here} ${attribute.name}.${part.name}` });
      }
      if (attribute.code) {
        for (const insn of attribute.code.instructions) {
          add(insn.cp, { label: `${method} pc ${insn.pc} ${insn.mnemonic}`, method, pc: insn.pc });
        }
        walkAttributes(attribute.code.attributes, `${here}.`, method);
      }
    });
  };

  const walkMembers = (members: Member[], path: string) => {
    members.forEach((m) => {
      const here = `${path}[${m.index}]`;
      add(m.nameIndex, { label: `${here}.name_index` });
      add(m.descriptorIndex, { label: `${here}.descriptor_index` });
      walkAttributes(m.attributes, `${here}.`, m.name);
    });
  };
  walkMembers(cf.fields, 'fields');
  walkMembers(cf.methods, 'methods');
  walkAttributes(cf.attributes, '');
  return usages;
}

export function parseClassFile(bytes: Uint8Array): ClassFile {
  const r = new Reader(bytes);
  const items: TopItem[] = [];
  const item = (
    name: string,
    line: string,
    type: string,
    section: TopItem['section'],
    start: number,
    extra: Partial<TopItem> = {},
  ) => {
    if (r.pos > start) items.push({ name, line, type, section, span: span(start, r.pos), ...extra });
  };

  let s = r.pos;
  const magic = r.u4();
  if (magic !== 0xcafebabe) {
    throw new ClassFormatError(
      `先頭が 0xCAFEBABE ではありません (0x${magic.toString(16).toUpperCase().padStart(8, '0')})`,
      0,
    );
  }
  item('magic', 'magic', 'u4', 'header', s);
  s = r.pos;
  const minor = r.u2();
  item('minor_version', 'minor_version', 'u2', 'header', s);
  s = r.pos;
  const major = r.u2();
  item('major_version', 'major_version', 'u2', 'header', s);
  s = r.pos;
  const poolCount = r.u2();
  item('constant_pool_count', 'constant_pool_count', 'u2', 'pool', s);
  s = r.pos;
  const pool = parsePool(r, poolCount);
  const poolSpan = span(s, r.pos);
  item('constant_pool', 'constant_pool', 'cp_info[]', 'pool', s);
  s = r.pos;
  const accessFlags = r.u2();
  item('access_flags', 'access_flags', 'u2', 'class', s);
  s = r.pos;
  const thisClass = r.u2();
  item('this_class', 'this_class', 'u2', 'class', s);
  s = r.pos;
  const superClass = r.u2();
  item('super_class', 'super_class', 'u2', 'class', s);
  s = r.pos;
  const interfacesCount = r.u2();
  item('interfaces_count', 'interfaces_count', 'u2', 'interfaces', s);
  s = r.pos;
  const interfaces: number[] = [];
  for (let i = 0; i < interfacesCount; i++) interfaces.push(r.u2());
  item('interfaces', 'interfaces', 'u2[]', 'interfaces', s);

  const members = (kind: 'field' | 'method', line: 'fields' | 'methods') => {
    let start = r.pos;
    const count = r.u2();
    item(`${line}_count`, `${line}_count`, 'u2', line, start);
    const list: Member[] = [];
    for (let i = 0; i < count; i++) {
      start = r.pos;
      const m = parseMember(r, kind, i, pool);
      list.push(m);
      item(`${line}[${i}]`, line, `${kind}_info`, line, start, { member: m });
    }
    return list;
  };
  const fields = members('field', 'fields');
  const methods = members('method', 'methods');

  s = r.pos;
  const attributesCount = r.u2();
  item('attributes_count', 'attributes_count', 'u2', 'attributes', s);
  const attributes: Attribute[] = [];
  for (let i = 0; i < attributesCount; i++) {
    s = r.pos;
    const a = parseAttribute(r, pool);
    attributes.push(a);
    item(`attributes[${i}]`, 'attributes', 'attribute_info', 'attributes', s, { attribute: a });
  }

  if (r.pos !== bytes.length) {
    throw new ClassFormatError(
      `構造の終わり (${r.pos} バイト目) の後ろに ${bytes.length - r.pos} バイト余っています`,
      r.pos,
    );
  }

  const cf: ClassFile = {
    bytes,
    magic,
    minor,
    major,
    poolCount,
    pool,
    poolSpan,
    accessFlags,
    thisClass,
    superClass,
    interfaces,
    fields,
    methods,
    attributes,
    items,
    usages: new Map(),
  };
  cf.usages = collectUsages(cf);
  return cf;
}

