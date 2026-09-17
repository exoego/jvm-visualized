import type { ClassFile, CpEntry, CpKind } from './types';

export const REF_KINDS = [
  '',
  'REF_getField',
  'REF_getStatic',
  'REF_putField',
  'REF_putStatic',
  'REF_invokeVirtual',
  'REF_invokeStatic',
  'REF_invokeSpecial',
  'REF_newInvokeSpecial',
  'REF_invokeInterface',
];

export const CP_SECTION: Record<CpKind, string> = {
  Class: '4.4.1',
  Fieldref: '4.4.2',
  Methodref: '4.4.2',
  InterfaceMethodref: '4.4.2',
  String: '4.4.3',
  Integer: '4.4.4',
  Float: '4.4.4',
  Long: '4.4.5',
  Double: '4.4.5',
  NameAndType: '4.4.6',
  Utf8: '4.4.7',
  MethodHandle: '4.4.8',
  MethodType: '4.4.9',
  Dynamic: '4.4.10',
  InvokeDynamic: '4.4.10',
  Module: '4.4.11',
  Package: '4.4.12',
};

export const ATTRIBUTE_SECTION: Record<string, string> = {
  ConstantValue: '4.7.2',
  Code: '4.7.3',
  StackMapTable: '4.7.4',
  Exceptions: '4.7.5',
  InnerClasses: '4.7.6',
  EnclosingMethod: '4.7.7',
  Synthetic: '4.7.8',
  Signature: '4.7.9',
  SourceFile: '4.7.10',
  SourceDebugExtension: '4.7.11',
  LineNumberTable: '4.7.12',
  LocalVariableTable: '4.7.13',
  LocalVariableTypeTable: '4.7.14',
  Deprecated: '4.7.15',
  RuntimeVisibleAnnotations: '4.7.16',
  RuntimeInvisibleAnnotations: '4.7.17',
  RuntimeVisibleParameterAnnotations: '4.7.18',
  RuntimeInvisibleParameterAnnotations: '4.7.19',
  RuntimeVisibleTypeAnnotations: '4.7.20',
  RuntimeInvisibleTypeAnnotations: '4.7.21',
  AnnotationDefault: '4.7.22',
  BootstrapMethods: '4.7.23',
  MethodParameters: '4.7.24',
  Module: '4.7.25',
  ModulePackages: '4.7.26',
  ModuleMainClass: '4.7.27',
  NestHost: '4.7.28',
  NestMembers: '4.7.29',
  Record: '4.7.30',
  PermittedSubclasses: '4.7.31',
};

export function specUrl(section: string): string {
  const chapter = section.split('.')[0];
  return `https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-${chapter}.html#jvms-${section}`;
}

export function utf8At(pool: (CpEntry | undefined)[], index: number): string | undefined {
  const entry = pool[index];
  return entry?.kind === 'Utf8' ? entry.utf8 : undefined;
}

export function cpText(cf: ClassFile, index: number, depth = 0): string {
  const entry = cf.pool[index];
  if (!entry || depth > 6) return `#${index}?`;
  const at = (field: string) => {
    const ref = entry.refs.find((r) => r.field === field);
    return ref ? cpText(cf, ref.index, depth + 1) : '?';
  };
  switch (entry.kind) {
    case 'Utf8':
      return entry.utf8 ?? '';
    case 'Integer':
    case 'Float':
    case 'Double':
      return String(entry.number);
    case 'Long':
      return `${entry.number}L`;
    case 'Class':
    case 'Module':
    case 'Package':
      return at('name_index');
    case 'String':
      return at('string_index');
    case 'Fieldref':
    case 'Methodref':
    case 'InterfaceMethodref':
      return `${at('class_index')}.${at('name_and_type_index')}`;
    case 'NameAndType':
      return `${at('name_index')}:${at('descriptor_index')}`;
    case 'MethodHandle':
      return `${REF_KINDS[entry.referenceKind ?? 0] ?? '?'} ${at('reference_index')}`;
    case 'MethodType':
      return at('descriptor_index');
    case 'Dynamic':
    case 'InvokeDynamic':
      return `#${entry.bootstrapIndex}:${at('name_and_type_index')}`;
  }
}

const FLAGS: Record<'class' | 'field' | 'method', [number, string][]> = {
  class: [
    [0x0001, 'ACC_PUBLIC'],
    [0x0010, 'ACC_FINAL'],
    [0x0020, 'ACC_SUPER'],
    [0x0200, 'ACC_INTERFACE'],
    [0x0400, 'ACC_ABSTRACT'],
    [0x1000, 'ACC_SYNTHETIC'],
    [0x2000, 'ACC_ANNOTATION'],
    [0x4000, 'ACC_ENUM'],
    [0x8000, 'ACC_MODULE'],
  ],
  field: [
    [0x0001, 'ACC_PUBLIC'],
    [0x0002, 'ACC_PRIVATE'],
    [0x0004, 'ACC_PROTECTED'],
    [0x0008, 'ACC_STATIC'],
    [0x0010, 'ACC_FINAL'],
    [0x0040, 'ACC_VOLATILE'],
    [0x0080, 'ACC_TRANSIENT'],
    [0x1000, 'ACC_SYNTHETIC'],
    [0x4000, 'ACC_ENUM'],
  ],
  method: [
    [0x0001, 'ACC_PUBLIC'],
    [0x0002, 'ACC_PRIVATE'],
    [0x0004, 'ACC_PROTECTED'],
    [0x0008, 'ACC_STATIC'],
    [0x0010, 'ACC_FINAL'],
    [0x0020, 'ACC_SYNCHRONIZED'],
    [0x0040, 'ACC_BRIDGE'],
    [0x0080, 'ACC_VARARGS'],
    [0x0100, 'ACC_NATIVE'],
    [0x0400, 'ACC_ABSTRACT'],
    [0x0800, 'ACC_STRICT'],
    [0x1000, 'ACC_SYNTHETIC'],
  ],
};

export function accessFlagNames(flags: number, target: 'class' | 'field' | 'method'): string[] {
  return FLAGS[target].filter(([bit]) => (flags & bit) !== 0).map(([, name]) => name);
}

export function javaVersion(major: number): string {
  if (major >= 49) return `Java SE ${major - 44}`;
  const old: Record<number, string> = { 45: 'JDK 1.1', 46: 'J2SE 1.2', 47: 'J2SE 1.3', 48: 'J2SE 1.4' };
  return old[major] ?? `不明 (${major})`;
}

const PRIMITIVES: Record<string, string> = {
  B: 'byte',
  C: 'char',
  D: 'double',
  F: 'float',
  I: 'int',
  J: 'long',
  S: 'short',
  Z: 'boolean',
  V: 'void',
};

function parseType(desc: string, pos: number): [string, number] {
  let dims = 0;
  while (desc[pos] === '[') {
    dims++;
    pos++;
  }
  let name: string;
  if (desc[pos] === 'L') {
    const end = desc.indexOf(';', pos);
    if (end < 0) return [desc, desc.length];
    name = desc.slice(pos + 1, end).split('/').pop() ?? '';
    pos = end + 1;
  } else {
    name = PRIMITIVES[desc[pos]] ?? '?';
    pos++;
  }
  return [name + '[]'.repeat(dims), pos];
}

export function prettyDescriptor(desc: string): string {
  if (!desc.startsWith('(')) return parseType(desc, 0)[0];
  const params: string[] = [];
  let pos = 1;
  while (pos < desc.length && desc[pos] !== ')') {
    const [t, next] = parseType(desc, pos);
    params.push(t);
    pos = next;
  }
  const [ret] = parseType(desc, pos + 1);
  return `(${params.join(', ')}) → ${ret}`;
}

export function hex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

export function hexBytes(bytes: Uint8Array, start: number, end: number): string {
  const out: string[] = [];
  for (let i = start; i < end; i++) out.push(hex(bytes[i]));
  return out.join(' ');
}

export function holdsValue(entry: CpEntry): boolean {
  return ['Utf8', 'Integer', 'Float', 'Long', 'Double'].includes(entry.kind);
}

const escapeControls = (text: string) =>
  text.replace(/[\x00-\x1f]/g, (c) => '\\' + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export function cpRaw(cf: ClassFile, index: number, labeled = false): string {
  const entry = cf.pool[index];
  if (!entry) return '';
  if (holdsValue(entry)) {
    const text = escapeControls(cpText(cf, index));
    return entry.kind === 'Utf8' ? `"${text}"` : text;
  }
  return entry.parts
    .filter((p) => p.name !== 'tag')
    .map((p) => {
      const value = p.cp
        ? `#${p.cp}`
        : p.name === 'reference_kind'
          ? (REF_KINDS[entry.referenceKind ?? 0] ?? p.value)
          : p.name === 'bootstrap_method_attr_index'
            ? `BootstrapMethods[${p.value}]`
            : p.value;
      return labeled ? `${p.name} ${value}` : value;
    })
    .join(' · ');
}
