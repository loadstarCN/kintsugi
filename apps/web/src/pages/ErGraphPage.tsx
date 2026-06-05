import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Input,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Edge,
  type EdgeMarker,
  MarkerType,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api';
import { NODE_BASE_WIDTH, TableNode, nodeHeight, type TableNodeData, type TableNodeField } from './er/TableNode';
import { autoLayout } from './er/layout';

interface SnapshotColumn {
  name: string;
  nativeType: string;
  logicalType: string;
  nullable: boolean;
  primaryKeyOrder?: number;
}

interface SnapshotForeignKey {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

interface SnapshotTable {
  name: string;
  columns: SnapshotColumn[];
  foreignKeys: SnapshotForeignKey[];
  rowCount?: number;
  comment?: string;
}

interface InferredRelation {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  cardinality?: string;
  confidence?: number;
  decision: 'accept' | 'reject' | 'modify';
}

interface InferredModel {
  tables?: Array<{ tableName: string; businessName?: string }>;
  inferredRelations?: InferredRelation[];
}

interface JobResult {
  id: string;
  status: string;
  rawSnapshot: { tables: SnapshotTable[] } | null;
  inferredModel: InferredModel | null;
}

const nodeTypes = { table: TableNode };

type EdgeKind = 'declaredFk' | 'llmAccept' | 'llmModify';
// 锦缮配色：声明外键 = 墨色实线（DB 真理），LLM 推断 = 金色虚线（AI 修补），人改 = 深金粗线
const EDGE_STYLE: Record<EdgeKind, { stroke: string; label: string; dashed?: boolean; width?: number; dash?: string }> = {
  declaredFk: { stroke: '#0f172a', label: 'FK', width: 1.6 },
  llmAccept:  { stroke: '#a07b3f', label: 'LLM',  dashed: true, dash: '6 4',  width: 1.6 },
  llmModify:  { stroke: '#8a6932', label: 'LLM✎', dashed: true, dash: '2 4',  width: 2.2 },
};

export function ErGraphPage() {
  const { dsId } = useParams<{ dsId: string }>();
  const [job, setJob] = React.useState<JobResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [keyword, setKeyword] = React.useState('');
  const [showLlm, setShowLlm] = React.useState(true);
  // 初始 'LR'，job 加载后会用真实 bbox 自动改写（见下方 useEffect）。
  const [direction, setDirection] = React.useState<'LR' | 'TB'>('LR');
  const [focusTable, setFocusTable] = React.useState<string | null>(null);
  const [focusDepth, setFocusDepth] = React.useState<1 | 2>(1);

  React.useEffect(() => {
    (async () => {
      try {
        if (!dsId) return;
        const jobsResp = await api.get<{
          data: Array<{ id: string; status: string }>;
        }>(`/dbagent/datasources/${dsId}/jobs?page=1&pageSize=20`);
        const jobs = jobsResp.data ?? [];
        const latest = jobs.find((j) => j.status === 'succeeded');
        if (!latest) {
          setError('尚无成功的扫描任务。请先触发一次扫描。');
          return;
        }
        const j = await api.get<JobResult>(`/dbagent/jobs/${latest.id}`);
        setJob(j);
      } catch (err) {
        setError((err as Error).message);
      }
    })().catch(() => undefined);
  }, [dsId]);

  // ReactFlow 的 "uncontrolled-ish" 状态：我们把 dagre 布局结果灌进去，之后内部管理 drag/select。
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const rfRef = React.useRef<ReactFlowInstance | null>(null);
  const [stats, setStats] = React.useState({
    tables: 0,
    declaredFk: 0,
    llmAccept: 0,
    llmModify: 0,
  });

  // job 首次加载时：分别跑 LR / TB 两种 dagre 布局，量出 bbox 宽高比，
  // 选与视口宽高比（log 距离）更贴的那个。后续用户手动切，就不再覆盖。
  const autoPickedJobRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!job?.rawSnapshot) return;
    if (autoPickedJobRef.current === job.id) return;
    autoPickedJobRef.current = job.id;
    const measureAr = (dir: 'LR' | 'TB'): number => {
      const g = buildGraph(job, { keyword: '', showLlm, direction: dir });
      if (g.nodes.length === 0) return 1;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of g.nodes) {
        if (n.position.x < minX) minX = n.position.x;
        if (n.position.x > maxX) maxX = n.position.x;
        if (n.position.y < minY) minY = n.position.y;
        if (n.position.y > maxY) maxY = n.position.y;
      }
      const w = (maxX - minX) + NODE_BASE_WIDTH;
      const h = (maxY - minY) + 200; // 大致补一个节点高度的余量
      return w / Math.max(h, 1);
    };
    const viewportAr = window.innerWidth / Math.max(window.innerHeight * 0.78, 1);
    const distLR = Math.abs(Math.log(measureAr('LR') / viewportAr));
    const distTB = Math.abs(Math.log(measureAr('TB') / viewportAr));
    setDirection(distLR <= distTB ? 'LR' : 'TB');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  // 聚焦集合：anchor + N 跳邻居（FK + LLM 边都算邻接）。null = 未聚焦。
  const focusSet = React.useMemo(() => {
    if (!job?.rawSnapshot || !focusTable) return null;
    return computeFocusSet(job.rawSnapshot, job.inferredModel, showLlm, focusTable, focusDepth);
  }, [job, focusTable, focusDepth, showLlm]);

  // 表名下拉：避开"在图里找表"的难点 —— 用 typeahead 选锚点，图只负责显示关系。
  const tableOptions = React.useMemo(() => {
    const tables = job?.rawSnapshot?.tables ?? [];
    const aliasMap = new Map(
      job?.inferredModel?.tables?.map((t) => [t.tableName, t.businessName]) ?? [],
    );
    return [...tables]
      .map((t) => {
        const alias = aliasMap.get(t.name);
        return {
          value: t.name,
          label: alias ? `${t.name} · ${alias}` : t.name,
        };
      })
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [job]);

  // job/showLlm/direction 变 → 整图重排；同时把当前 keyword/focus 覆盖回灌。
  const relayoutDeps = [job, showLlm, direction];
  React.useEffect(() => {
    if (!job?.rawSnapshot) return;
    const g = buildGraph(job, { keyword: '', showLlm, direction });
    const kw = keyword.trim().toLowerCase();
    setNodes(applyNodeOverlay(g.nodes, kw, focusSet, focusTable));
    setEdges(applyEdgeOverlay(g.edges, focusSet));
    setStats(g.stats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, relayoutDeps);

  // keyword/focus 变 → 不重排，只 mutate 节点 data 与边 hidden，保留拖拽位置。
  React.useEffect(() => {
    const kw = keyword.trim().toLowerCase();
    setNodes((prev) => applyNodeOverlay(prev, kw, focusSet, focusTable));
    setEdges((prev) => applyEdgeOverlay(prev, focusSet));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, focusSet, focusTable]);

  // 布局变化（job/showLlm/direction）后让画布重新居中——一次性 fitView prop 在
  // setNodes 之前就跑过了，这里通过 instance ref 显式补一次。
  React.useEffect(() => {
    if (!job?.rawSnapshot) return;
    const id = requestAnimationFrame(() => {
      rfRef.current?.fitView({ padding: 0.15, duration: 250 });
    });
    return () => cancelAnimationFrame(id);
  }, [job, showLlm, direction]);

  // 聚焦变化：缩放到焦点子图（unfocus 时还原全图）。
  React.useEffect(() => {
    if (!rfRef.current) return;
    const id = requestAnimationFrame(() => {
      if (focusSet && focusSet.size > 0) {
        const ids = Array.from(focusSet).map((id) => ({ id }));
        rfRef.current?.fitView({ nodes: ids, padding: 0.2, duration: 300 });
      } else {
        rfRef.current?.fitView({ padding: 0.15, duration: 300 });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [focusSet]);

  if (error) return <Alert type="error" message="加载 ER 图失败" description={error} />;
  if (!job || !job.rawSnapshot) return <Spin tip="加载快照…"><div style={{ padding: 32 }} /></Spin>;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }} className="ker-shell">
      <Breadcrumb
        items={[
          { title: <Link to="/datasources">数据源</Link> },
          { title: 'ER 图' },
        ]}
      />

      <Card
        size="small"
        title={
          <Space wrap size={[8, 4]}>
            <Typography.Text strong>ER 图</Typography.Text>
            <Tag color="blue">{stats.tables} 表</Tag>
            <Tag color="default">{stats.declaredFk} 声明外键</Tag>
            <Tag color="green">{stats.llmAccept} LLM accept</Tag>
            <Tag color="orange">{stats.llmModify} LLM modify</Tag>
            {focusSet && <Tag color="gold">聚焦 {focusSet.size} 张</Tag>}
          </Space>
        }
        extra={
          <Space wrap size={[8, 4]}>
            <Input.Search
              size="small"
              allowClear
              placeholder="按表名/中文名 高亮"
              style={{ width: 180, maxWidth: '100%' }}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Checkbox checked={showLlm} onChange={(e) => setShowLlm(e.target.checked)}>
              显示 LLM 推断
            </Checkbox>
            <Radio.Group
              size="small"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'LR' | 'TB')}
              optionType="button"
              options={[
                { value: 'LR', label: '左→右' },
                { value: 'TB', label: '上→下' },
              ]}
            />
            <Select
              size="small"
              showSearch
              allowClear
              placeholder="聚焦某张表"
              style={{ width: 220 }}
              value={focusTable ?? undefined}
              onChange={(v) => setFocusTable(v ?? null)}
              options={tableOptions}
              optionFilterProp="label"
              filterOption={(input, opt) => {
                const s = input.toLowerCase();
                return (
                  String(opt?.label ?? '').toLowerCase().includes(s) ||
                  String(opt?.value ?? '').toLowerCase().includes(s)
                );
              }}
            />
            {focusTable && (
              <Radio.Group
                size="small"
                value={focusDepth}
                onChange={(e) => setFocusDepth(e.target.value as 1 | 2)}
                optionType="button"
                options={[
                  { value: 1, label: '1 跳' },
                  { value: 2, label: '2 跳' },
                ]}
              />
            )}
            <Button
              size="small"
              onClick={() => {
                if (!job?.rawSnapshot) return;
                const g = buildGraph(job, { keyword: '', showLlm, direction });
                const kw = keyword.trim().toLowerCase();
                setNodes(applyNodeOverlay(g.nodes, kw, focusSet, focusTable));
                setEdges(applyEdgeOverlay(g.edges, focusSet));
                setStats(g.stats);
              }}
            >
              重置布局
            </Button>
            <Button size="small" onClick={() => window.location.reload()}>
              重载
            </Button>
          </Space>
        }
      >
        <div className="ker-er-frame" style={{ width: '100%', height: '78vh', background: '#fafafa', borderRadius: 4 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onInit={(inst) => {
              rfRef.current = inst;
              // 首次拿到 instance 后立刻做一次 fitView，覆盖"layout 在 onInit 之后
              // 才完成"那种竞态。
              requestAnimationFrame(() => inst.fitView({ padding: 0.15 }));
            }}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.1}
            maxZoom={2}
            nodesDraggable
            elementsSelectable
            panOnDrag
            defaultEdgeOptions={{ type: 'default' /* bezier */ }}
          >
            <Background gap={16} />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => {
                const d = n.data as TableNodeData | undefined;
                if (d?.focusAnchor) return '#a07b3f';
                if (d?.dimmed) return '#e5e7eb';
                return '#94a3b8';
              }}
              nodeStrokeColor="#475569"
              nodeStrokeWidth={0.6}
              nodeBorderRadius={2}
              maskColor="rgba(15,23,42,0.22)"
              maskStrokeColor="#a07b3f"
              maskStrokeWidth={1.5}
              style={{
                border: '1px solid #d4c8a8',
                borderRadius: 4,
                background: '#fafaf7',
                boxShadow: '0 2px 8px rgba(15,23,42,0.12)',
              }}
            />
          </ReactFlow>
        </div>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
          拖拽节点调整；滚轮缩放；右下角框是小地图。<span style={{ color: '#0f172a', fontWeight: 600 }}>墨色实线</span> = DB 声明外键；
          <span style={{ color: '#a07b3f', fontWeight: 600 }}>金色虚线</span> = LLM 接受的推断；
          <span style={{ color: '#8a6932', fontWeight: 600 }}>深金粗虚线</span> = 人工修正。
          表多时用「<span style={{ color: '#8a6932', fontWeight: 600 }}>聚焦某张表</span>」从下拉里选锚点表，图会收敛到该表与 1/2 跳邻居。
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}

function buildGraph(
  job: JobResult,
  opts: { keyword: string; showLlm: boolean; direction: 'LR' | 'TB' },
): {
  nodes: Node<TableNodeData>[];
  edges: Edge[];
  stats: { tables: number; declaredFk: number; llmAccept: number; llmModify: number };
} {
  const snapshot = job.rawSnapshot!;
  const inferred = job.inferredModel;
  const semByTable = new Map(inferred?.tables?.map((t) => [t.tableName, t.businessName]) ?? []);

  // 索引哪些 (table, column) 是外键持有方
  const fkColsByTable = new Map<string, Set<string>>();
  for (const t of snapshot.tables) {
    const set = new Set<string>();
    for (const fk of t.foreignKeys) for (const c of fk.columns) set.add(c);
    fkColsByTable.set(t.name, set);
  }

  // 过滤节点：始终渲染所有表（关键字只做 highlight，不裁剪）。
  const nodes: Node<TableNodeData>[] = snapshot.tables.map((t) => {
    const fkCols = fkColsByTable.get(t.name) ?? new Set();
    const fields: TableNodeField[] = t.columns.map((c) => ({
      name: c.name,
      nativeType: c.nativeType,
      logicalType: c.logicalType,
      isPrimary: c.primaryKeyOrder !== undefined,
      isForeignKey: fkCols.has(c.name),
      nullable: c.nullable,
    }));
    const alias = semByTable.get(t.name);
    const kw = opts.keyword;
    const highlight = kw
      ? t.name.toLowerCase().includes(kw) || (alias ?? '').toLowerCase().includes(kw)
      : false;
    const data: TableNodeData = {
      tableName: t.name,
      columnCount: t.columns.length,
      fields,
      highlight,
      ...(alias ? { alias } : {}),
      ...(t.rowCount !== undefined ? { rowCount: t.rowCount } : {}),
    };
    return {
      id: t.name,
      type: 'table',
      data,
      position: { x: 0, y: 0 },
    };
  });

  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const edges: Edge[] = [];
  let declaredFk = 0;
  let llmAccept = 0;
  let llmModify = 0;

  // 统计每个字段参与的连接 —— 只有真正连上了的 handle 才会亮色显示
  const incomingByTable = new Map<string, Set<string>>(); // toTable → toColumn 集合
  const outgoingByTable = new Map<string, Set<string>>(); // fromTable → fromColumn 集合

  const pushEdge = (
    from: string,
    fromCols: string[],
    to: string,
    toCols: string[],
    kind: EdgeKind,
    extraLabel?: string,
  ) => {
    if (!nodesById.has(from) || !nodesById.has(to)) return;
    const fromCol = fromCols[0] ?? '';
    const toCol = toCols[0] ?? '';
    const style = EDGE_STYLE[kind];
    const marker: EdgeMarker = { type: MarkerType.ArrowClosed, color: style.stroke };
    edges.push({
      id: `${kind}:${from}.${fromCols.join(',')}->${to}.${toCols.join(',')}`,
      source: from,
      target: to,
      sourceHandle: `${fromCol}-source`,
      targetHandle: `${toCol}-target`,
      label: extraLabel ? `${style.label} ${extraLabel}` : style.label,
      labelStyle: { fontSize: 10, fill: style.stroke, fontWeight: 600 },
      labelBgStyle: { fill: '#fafaf7', fillOpacity: 0.92 },
      labelBgPadding: [4, 6],
      style: {
        stroke: style.stroke,
        strokeWidth: style.width ?? 1.5,
        strokeDasharray: style.dashed ? (style.dash ?? '5 3') : undefined,
      },
      markerEnd: marker,
    });
    if (fromCol) {
      const s = outgoingByTable.get(from) ?? new Set<string>();
      s.add(fromCol);
      outgoingByTable.set(from, s);
    }
    if (toCol) {
      const s = incomingByTable.get(to) ?? new Set<string>();
      s.add(toCol);
      incomingByTable.set(to, s);
    }
  };

  for (const t of snapshot.tables) {
    for (const fk of t.foreignKeys) {
      pushEdge(t.name, asArray(fk.columns), fk.referencedTable, asArray(fk.referencedColumns), 'declaredFk');
      declaredFk++;
    }
  }

  if (opts.showLlm) {
    for (const r of inferred?.inferredRelations ?? []) {
      if (r.decision === 'reject') continue;
      const kind: EdgeKind = r.decision === 'modify' ? 'llmModify' : 'llmAccept';
      const label = r.confidence !== undefined ? r.confidence.toFixed(2) : undefined;
      pushEdge(r.fromTable, asArray(r.fromColumns), r.toTable, asArray(r.toColumns), kind, label);
      if (kind === 'llmAccept') llmAccept++;
      else llmModify++;
    }
  }

  // 回填节点字段的 hasIncoming / hasOutgoing —— 让 handle 圆点按"真的有连线"来着色
  for (const n of nodes) {
    const inSet = incomingByTable.get(n.id);
    const outSet = outgoingByTable.get(n.id);
    if (!inSet && !outSet) continue;
    n.data = {
      ...n.data,
      fields: n.data.fields.map((f) => ({
        ...f,
        hasIncoming: inSet?.has(f.name) ?? false,
        hasOutgoing: outSet?.has(f.name) ?? false,
      })),
    };
  }

  const laid = autoLayout(nodes, edges, {
    direction: opts.direction,
    nodeWidth: NODE_BASE_WIDTH,
    nodeHeight: (id) => {
      const n = nodesById.get(id);
      return n ? nodeHeight(n.data.fields.length) : 100;
    },
  });

  return {
    nodes: laid.nodes as Node<TableNodeData>[],
    edges: laid.edges,
    stats: { tables: nodes.length, declaredFk, llmAccept, llmModify },
  };
}

function applyNodeOverlay(
  nodes: Node<TableNodeData>[],
  kw: string,
  focusSet: Set<string> | null,
  anchor: string | null,
): Node<TableNodeData>[] {
  return nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      highlight: kw
        ? n.data.tableName.toLowerCase().includes(kw) ||
          (n.data.alias ?? '').toLowerCase().includes(kw)
        : false,
      dimmed: focusSet ? !focusSet.has(n.id) : false,
      focusAnchor: anchor === n.id,
    },
  }));
}

function applyEdgeOverlay(edges: Edge[], focusSet: Set<string> | null): Edge[] {
  return edges.map((e) => ({
    ...e,
    hidden: focusSet ? !(focusSet.has(e.source) && focusSet.has(e.target)) : false,
  }));
}

/**
 * 从 anchor 出发 BFS depth 跳，把 FK 与（可选）LLM 关系都当成无向邻接。
 * 返回包含 anchor 自身在内的所有"焦点表"。
 */
function computeFocusSet(
  snapshot: { tables: SnapshotTable[] },
  inferred: InferredModel | null,
  showLlm: boolean,
  anchor: string,
  depth: number,
): Set<string> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const t of snapshot.tables) {
    for (const fk of t.foreignKeys) link(t.name, fk.referencedTable);
  }
  if (showLlm) {
    for (const r of inferred?.inferredRelations ?? []) {
      if (r.decision === 'reject') continue;
      link(r.fromTable, r.toTable);
    }
  }
  const visited = new Set<string>([anchor]);
  let frontier: Set<string> = new Set([anchor]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const t of frontier) {
      for (const n of adj.get(t) ?? []) {
        if (!visited.has(n)) {
          visited.add(n);
          next.add(n);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return visited;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
  }
  return [];
}
