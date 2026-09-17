import { cpText } from '../classfile/describe';
import type { ClassFile, CpKind } from '../classfile/types';
import { showable } from '../ui/dom';

export interface GraphNode {
  id: string;
  index?: number;
  bootstrap?: number;
  kind: CpKind | 'Bootstrap';
  text: string;
  depth: number;
  ghost?: boolean;
  x: number;
  y: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  ghost?: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export const NODE_W = 188;
export const NODE_H = 52;
const GAP_X = 14;
const GAP_Y = 44;
const MAX_GHOSTS = 4;

function bootstrapTable(cf: ClassFile) {
  return cf.attributes.find((a) => a.name === 'BootstrapMethods')?.bootstrapMethods ?? [];
}

export function nodeText(cf: ClassFile, index: number): string {
  const entry = cf.pool[index];
  if (!entry) return '';
  const text = showable(cpText(cf, index));
  return entry.kind === 'Utf8' || entry.kind === 'String' ? `"${text}"` : text;
}

export function buildGraph(cf: ClassFile, root: number): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const children = new Map<string, string[]>();
  const bsms = bootstrapTable(cf);

  const cpNode = (index: number): string => {
    const id = `cp:${index}`;
    if (!nodes.has(id)) {
      const entry = cf.pool[index];
      nodes.set(id, {
        id,
        index,
        kind: entry?.kind ?? 'Utf8',
        text: entry ? nodeText(cf, index) : '(不正な番号)',
        depth: 0,
        x: 0,
        y: 0,
      });
    }
    return id;
  };

  const link = (from: string, to: string, label: string) => {
    edges.push({ from, to, label });
    const list = children.get(from) ?? [];
    list.push(to);
    children.set(from, list);
  };

  const expanded = new Set<string>();
  const expand = (id: string) => {
    if (expanded.has(id)) return;
    expanded.add(id);
    const node = nodes.get(id)!;
    if (node.bootstrap !== undefined) {
      const bm = bsms[node.bootstrap];
      if (!bm) return;
      link(id, cpNode(bm.ref), 'bootstrap_method_ref');
      bm.args.forEach((arg, j) => link(id, cpNode(arg), `bootstrap_arguments[${j}]`));
    } else if (node.index !== undefined) {
      const entry = cf.pool[node.index];
      if (!entry) return;
      if (entry.bootstrapIndex !== undefined && bsms[entry.bootstrapIndex]) {
        const bid = `bsm:${entry.bootstrapIndex}`;
        if (!nodes.has(bid)) {
          const bm = bsms[entry.bootstrapIndex];
          nodes.set(bid, {
            id: bid,
            bootstrap: entry.bootstrapIndex,
            kind: 'Bootstrap',
            text: `#${bm.ref} と引数 ${bm.args.length} 個`,
            depth: 0,
            x: 0,
            y: 0,
          });
        }
        link(id, bid, 'bootstrap_method_attr_index');
      }
      for (const ref of entry.refs) {
        if (ref.index > 0) link(id, cpNode(ref.index), ref.field);
      }
    }
    for (const child of children.get(id) ?? []) expand(child);
  };

  const rootId = cpNode(root);
  expand(rootId);

  const depth = new Map<string, number>([[rootId, 0]]);
  const visiting = new Set<string>();
  const assign = (id: string, d: number) => {
    if (visiting.has(id) || d > 16) return;
    if ((depth.get(id) ?? -1) > d) return;
    depth.set(id, Math.max(depth.get(id) ?? 0, d));
    visiting.add(id);
    for (const child of children.get(id) ?? []) assign(child, d + 1);
    visiting.delete(id);
  };
  assign(rootId, 0);
  for (const [id, d] of depth) nodes.get(id)!.depth = d;

  const parents = (cf.usages.get(root) ?? []).filter((u) => u.from !== undefined);
  const ghostIds: string[] = [];
  for (const usage of parents.slice(0, MAX_GHOSTS)) {
    const id = `ghost:${usage.from}`;
    const entry = cf.pool[usage.from!];
    nodes.set(id, {
      id,
      index: usage.from,
      kind: entry?.kind ?? 'Utf8',
      text: nodeText(cf, usage.from!),
      depth: -1,
      ghost: true,
      x: 0,
      y: 0,
    });
    const field = entry?.refs.find((r) => r.index === root)?.field ?? '';
    edges.push({ from: id, to: rootId, label: field, ghost: true });
    ghostIds.push(id);
  }

  const rows = new Map<number, GraphNode[]>();
  for (const node of nodes.values()) {
    const list = rows.get(node.depth) ?? [];
    list.push(node);
    rows.set(node.depth, list);
  }
  const depths = [...rows.keys()].sort((a, b) => a - b);
  const width = Math.max(...[...rows.values()].map((r) => r.length * NODE_W + (r.length - 1) * GAP_X));

  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (e.ghost) continue;
    const list = incoming.get(e.to) ?? [];
    list.push(e.from);
    incoming.set(e.to, list);
  }

  depths.forEach((d, row) => {
    const list = rows.get(d)!;
    if (d > 0) {
      const order = new Map(list.map((n, i) => [n.id, i]));
      const center = (n: GraphNode) => {
        const xs = (incoming.get(n.id) ?? []).map((p) => nodes.get(p)!.x);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      };
      list.sort((a, b) => center(a) - center(b) || order.get(a.id)! - order.get(b.id)!);
    }
    const rowWidth = list.length * NODE_W + (list.length - 1) * GAP_X;
    list.forEach((n, i) => {
      n.x = (width - rowWidth) / 2 + i * (NODE_W + GAP_X);
      n.y = row * (NODE_H + GAP_Y);
    });
  });

  return {
    nodes: [...nodes.values()],
    edges,
    width,
    height: depths.length * (NODE_H + GAP_Y) - GAP_Y,
  };
}

export function edgePath(from: GraphNode, to: GraphNode): { d: string; mid: [number, number] } {
  const x0 = from.x + NODE_W / 2;
  const y0 = from.y + NODE_H;
  const x1 = to.x + NODE_W / 2;
  const y1 = to.y;
  const k = Math.max(24, (y1 - y0) * 0.5);
  const d = `M${x0},${y0} C${x0},${y0 + k} ${x1},${y1 - k} ${x1},${y1}`;
  const mid: [number, number] = [(x0 + 3 * x0 + 3 * x1 + x1) / 8, (y0 + 3 * (y0 + k) + 3 * (y1 - k) + y1) / 8];
  return { d, mid };
}
