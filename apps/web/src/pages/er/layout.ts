import dagre from 'dagre';
import type { Edge, Node } from 'reactflow';

/** 用 dagre 把节点自动分层布局。方向：LR = 左到右。 */
export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  opts: { direction?: 'LR' | 'TB'; nodeWidth?: number; nodeHeight?: (id: string) => number } = {},
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: opts.direction ?? 'LR',
    // ER 图 fan-out 大，间距给宽一点，避免边挤成一团；
    // tight-tree ranker 比默认 network-simplex 产生更紧凑的层数，
    // 对"很多小表指向同一中心表"的形态视觉上更友好。
    nodesep: 80,
    ranksep: 200,
    edgesep: 24,
    marginx: 32,
    marginy: 32,
    ranker: 'tight-tree',
    align: 'UL',
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, {
      width: opts.nodeWidth ?? 260,
      height: opts.nodeHeight ? opts.nodeHeight(n.id) : 100,
    });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const pos = g.node(n.id);
      return {
        ...n,
        position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
      };
    }),
    edges,
  };
}
