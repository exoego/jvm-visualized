export interface Span {
  start: number;
  end: number;
}

export type Section =
  | 'header'
  | 'pool'
  | 'class'
  | 'interfaces'
  | 'fields'
  | 'methods'
  | 'attributes';

export interface Part {
  name: string;
  type: string;
  span: Span;
  value: string;
  cp?: number;
}

export type CpKind =
  | 'Utf8'
  | 'Integer'
  | 'Float'
  | 'Long'
  | 'Double'
  | 'Class'
  | 'String'
  | 'Fieldref'
  | 'Methodref'
  | 'InterfaceMethodref'
  | 'NameAndType'
  | 'MethodHandle'
  | 'MethodType'
  | 'Dynamic'
  | 'InvokeDynamic'
  | 'Module'
  | 'Package';

export interface CpRef {
  field: string;
  index: number;
}

export interface CpEntry {
  index: number;
  tag: number;
  kind: CpKind;
  span: Span;
  parts: Part[];
  refs: CpRef[];
  utf8?: string;
  number?: number | bigint;
  referenceKind?: number;
  bootstrapIndex?: number;
}

export interface Operand {
  name: string;
  value: number;
  cp?: boolean;
}

export interface Instruction {
  pc: number;
  offset: number;
  opcode: number;
  mnemonic: string;
  length: number;
  operands: Operand[];
  cp?: number;
}

export interface CodeInfo {
  maxStack: number;
  maxLocals: number;
  codeSpan: Span;
  instructions: Instruction[];
  attributes: Attribute[];
}

export interface BootstrapMethod {
  ref: number;
  args: number[];
  span: Span;
}

export interface Attribute {
  name: string;
  nameIndex: number;
  span: Span;
  parts: Part[];
  code?: CodeInfo;
  bootstrapMethods?: BootstrapMethod[];
  constantValue?: number;
  lineNumbers?: { pc: number; line: number }[];
}

export interface Member {
  kind: 'field' | 'method';
  index: number;
  accessFlags: number;
  nameIndex: number;
  descriptorIndex: number;
  name: string;
  descriptor: string;
  span: Span;
  parts: Part[];
  attributes: Attribute[];
}

export interface TopItem {
  name: string;
  line: string;
  type: string;
  section: Section;
  span: Span;
  member?: Member;
  attribute?: Attribute;
}

export interface Usage {
  label: string;
  from?: number;
  method?: string;
  pc?: number;
}

export interface ClassFile {
  bytes: Uint8Array;
  magic: number;
  minor: number;
  major: number;
  poolCount: number;
  pool: (CpEntry | undefined)[];
  poolSpan: Span;
  accessFlags: number;
  thisClass: number;
  superClass: number;
  interfaces: number[];
  fields: Member[];
  methods: Member[];
  attributes: Attribute[];
  items: TopItem[];
  usages: Map<number, Usage[]>;
}
