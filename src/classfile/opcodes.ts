// Operand codes: c1/c2 = constant pool index, l1 = local index, b1/s2 = signed immediate,
// j2/j4 = branch offset, and single letters for instructions with irregular layouts.
const TABLE = `
nop aconst_null iconst_m1 iconst_0 iconst_1 iconst_2 iconst_3 iconst_4 iconst_5
lconst_0 lconst_1 fconst_0 fconst_1 fconst_2 dconst_0 dconst_1
bipush:b1 sipush:s2 ldc:c1 ldc_w:c2 ldc2_w:c2
iload:l1 lload:l1 fload:l1 dload:l1 aload:l1
iload_0 iload_1 iload_2 iload_3 lload_0 lload_1 lload_2 lload_3
fload_0 fload_1 fload_2 fload_3 dload_0 dload_1 dload_2 dload_3
aload_0 aload_1 aload_2 aload_3
iaload laload faload daload aaload baload caload saload
istore:l1 lstore:l1 fstore:l1 dstore:l1 astore:l1
istore_0 istore_1 istore_2 istore_3 lstore_0 lstore_1 lstore_2 lstore_3
fstore_0 fstore_1 fstore_2 fstore_3 dstore_0 dstore_1 dstore_2 dstore_3
astore_0 astore_1 astore_2 astore_3
iastore lastore fastore dastore aastore bastore castore sastore
pop pop2 dup dup_x1 dup_x2 dup2 dup2_x1 dup2_x2 swap
iadd ladd fadd dadd isub lsub fsub dsub imul lmul fmul dmul
idiv ldiv fdiv ddiv irem lrem frem drem ineg lneg fneg dneg
ishl lshl ishr lshr iushr lushr iand land ior lor ixor lxor
iinc:i
i2l i2f i2d l2i l2f l2d f2i f2l f2d d2i d2l d2f i2b i2c i2s
lcmp fcmpl fcmpg dcmpl dcmpg
ifeq:j2 ifne:j2 iflt:j2 ifge:j2 ifgt:j2 ifle:j2
if_icmpeq:j2 if_icmpne:j2 if_icmplt:j2 if_icmpge:j2 if_icmpgt:j2 if_icmple:j2
if_acmpeq:j2 if_acmpne:j2 goto:j2 jsr:j2 ret:l1
tableswitch:T lookupswitch:L
ireturn lreturn freturn dreturn areturn return
getstatic:c2 putstatic:c2 getfield:c2 putfield:c2
invokevirtual:c2 invokespecial:c2 invokestatic:c2 invokeinterface:I invokedynamic:D
new:c2 newarray:n anewarray:c2 arraylength athrow checkcast:c2 instanceof:c2
monitorenter monitorexit wide:W multianewarray:M ifnull:j2 ifnonnull:j2 goto_w:j4 jsr_w:j4
breakpoint`;

export interface OpcodeInfo {
  mnemonic: string;
  format: string;
}

export const OPCODES: OpcodeInfo[] = TABLE.trim()
  .split(/\s+/)
  .map((token) => {
    const [mnemonic, format = ''] = token.split(':');
    return { mnemonic, format };
  });

OPCODES[0xfe] = { mnemonic: 'impdep1', format: '' };
OPCODES[0xff] = { mnemonic: 'impdep2', format: '' };
