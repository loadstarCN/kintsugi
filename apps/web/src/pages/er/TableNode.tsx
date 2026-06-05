import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { KeyOutlined, LinkOutlined } from '@ant-design/icons';

/** 一个 Table 节点：表头 + 字段行列表，每个字段两侧都有 handle，用作边的锚点。 */

export interface TableNodeField {
  name: string;
  nativeType: string;
  logicalType?: string;
  isPrimary?: boolean;
  isForeignKey?: boolean;
  nullable?: boolean;
  semanticName?: string;
  /** 该字段是否作为某条边的 target（被其他表的外键指向）。控制左侧圆点颜色。 */
  hasIncoming?: boolean;
  /** 该字段是否作为某条边的 source（是外键发起方）。控制右侧圆点颜色。 */
  hasOutgoing?: boolean;
}

export interface TableNodeData {
  tableName: string;
  alias?: string;
  columnCount: number;
  rowCount?: number;
  fields: TableNodeField[];
  highlight?: boolean;
  /** 聚焦模式下的非焦点表：渲染为低透明度。 */
  dimmed?: boolean;
  /** 聚焦模式锚点：边框金色更深、阴影更明显。 */
  focusAnchor?: boolean;
}

const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 56;
const HANDLE_SIZE = 10;

function TableNodeComp({ data, selected }: NodeProps<TableNodeData>) {
  const isAnchor = data.focusAnchor;
  const borderColor = isAnchor
    ? '#8a6932'
    : selected || data.highlight
      ? '#a07b3f'
      : '#e5e7eb';
  const shadow = isAnchor
    ? '0 10px 22px rgba(138,105,50,0.36)'
    : selected
      ? '0 8px 18px rgba(160,123,63,0.28)'
      : '0 2px 10px rgba(15,23,42,0.06)';
  return (
    <div
      className="kintsugi-table-node"
      style={{
        minWidth: 260,
        background: '#fff',
        border: `${isAnchor ? 2 : 1}px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow: shadow,
        fontSize: 12,
        // 关键：让 handle 圆点可以完整伸出节点边缘
        overflow: 'visible',
        opacity: data.dimmed ? 0.18 : 1,
        transition: 'opacity 180ms ease, box-shadow 180ms ease',
      }}
    >
      <div
        style={{
          height: HEADER_HEIGHT,
          padding: '8px 10px',
          background: '#0f172a',
          color: '#fafaf7',
          borderTopLeftRadius: 7,
          borderTopRightRadius: 7,
          borderBottom: '1px solid #a07b3f',
          cursor: 'grab',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13, lineHeight: '16px' }}>
          {data.tableName}
        </div>
        <div style={{ fontSize: 11, opacity: 0.9, marginTop: 2 }}>
          {data.alias && <span>{data.alias} · </span>}
          <span>{data.columnCount} 列</span>
          {data.rowCount !== undefined && <span> · {data.rowCount.toLocaleString()} 行</span>}
        </div>
      </div>

      <div
        style={{
          borderBottomLeftRadius: 7,
          borderBottomRightRadius: 7,
          overflow: 'visible',
        }}
      >
        {data.fields.map((f, idx) => {
          const isLast = idx === data.fields.length - 1;
          // 锦缮配色：有连线 = 金，无连线 = 灰
          const targetColor = f.hasIncoming ? '#a07b3f' : '#cbd5e1';
          const sourceColor = f.hasOutgoing ? '#a07b3f' : '#cbd5e1';
          return (
            <div
              key={f.name}
              className="kintsugi-field-row"
              style={{
                position: 'relative',
                height: ROW_HEIGHT,
                // 左右留出 22px，给内移的 handle 圆点（宽 10px + 边距 4px + 余量）
                padding: '0 22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: isLast ? 'none' : '1px solid #f0f0f0',
                borderBottomLeftRadius: isLast ? 7 : 0,
                borderBottomRightRadius: isLast ? 7 : 0,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                background: '#fff',
              }}
            >
              <Handle
                id={`${f.name}-target`}
                type="target"
                position={Position.Left}
                style={{
                  background: targetColor,
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  borderRadius: '50%',
                  border: '2px solid #fff',
                  boxShadow: f.hasIncoming
                    ? '0 0 0 1px rgba(160,123,63,0.55)'
                    : '0 0 0 1px rgba(15,23,42,0.08)',
                  opacity: f.hasIncoming ? 1 : 0.45,
                  // 关键：覆盖默认 transform（translate(-50%, -50%)）只保留垂直居中，
                  // 让 handle DOM 真正落在节点内侧 4px 处；ReactFlow 用 DOM bounding rect
                  // 计算边端点，这样边就会连到圆点而不是节点边缘。
                  top: '50%',
                  left: 4,
                  transform: 'translateY(-50%)',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                {f.isPrimary && <KeyOutlined style={{ color: '#a07b3f' }} />}
                {f.isForeignKey && !f.isPrimary && <LinkOutlined style={{ color: '#8a6932' }} />}
                <span
                  style={{
                    fontWeight: f.isPrimary ? 600 : 400,
                    color: f.nullable === false ? '#000' : '#595959',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 160,
                  }}
                  title={f.semanticName ? `${f.name} — ${f.semanticName}` : f.name}
                >
                  {f.name}
                </span>
              </div>
              <span
                style={{
                  color: '#8c8c8c',
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 100,
                  textAlign: 'right',
                }}
                title={f.nativeType}
              >
                {shortType(f.nativeType)}
              </span>
              <Handle
                id={`${f.name}-source`}
                type="source"
                position={Position.Right}
                style={{
                  background: sourceColor,
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  borderRadius: '50%',
                  border: '2px solid #fff',
                  boxShadow: f.hasOutgoing
                    ? '0 0 0 1px rgba(160,123,63,0.55)'
                    : '0 0 0 1px rgba(15,23,42,0.08)',
                  opacity: f.hasOutgoing ? 1 : 0.45,
                  top: '50%',
                  right: 4,
                  transform: 'translateY(-50%)',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortType(raw: string): string {
  return raw.replace(/\s+without time zone/i, '').replace(/\s+with time zone/i, 'tz');
}

export const TableNode = memo(TableNodeComp);

export const NODE_BASE_WIDTH = 280;
export function nodeHeight(rowCount: number): number {
  return HEADER_HEIGHT + ROW_HEIGHT * rowCount + 2;
}
