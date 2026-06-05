import type {
  ConnectionParams,
  DialectId,
  IntrospectOptions,
  SchemaSnapshot,
  TableSample,
} from './types';

/**
 * 每种数据库方言需要实现的抽象接口。
 * 生命周期：connect → (introspect | sampleTable | execute)* → close。
 * 实现者应是无状态或单连接包装；并发调用同一实例的安全性由实现决定。
 */
export interface DialectAdapter {
  readonly id: DialectId;

  /** 建立连接 / 连接池，必须幂等。 */
  connect(params: ConnectionParams): Promise<void>;

  /** 扫描元数据并归一化返回。 */
  introspect(opts?: IntrospectOptions): Promise<SchemaSnapshot>;

  /** 随机抽样表的前 N 行。用于后续关系推理 / LLM 语义判断。 */
  sampleTable(schemaName: string | undefined, table: string, size: number): Promise<TableSample>;

  /** 只读 SQL 执行（用于 DBAgent 的试探性查询，例如 JOIN 可行性验证）。 */
  runReadonly<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * 通用 SQL 执行（读写通吃）。Instant API 和 BFF 都走这里。
   * 返回行（SELECT / RETURNING）以及影响行数（UPDATE / DELETE / INSERT）。
   */
  execute<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;

  /** 标识符引用：pg → "col" / mysql → `col`。只接收安全字符（字母数字下划线），非法字符应先报错。 */
  quoteIdentifier(name: string): string;

  /** 参数占位符：pg → $1,$2 / mysql → ?,?（index 从 1 开始）。 */
  placeholder(index: number): string;

  /**
   * 在一个事务里跑一段逻辑。
   * 实现：pg 用 BEGIN/COMMIT/ROLLBACK；嵌套调用用 SAVEPOINT。
   * callback 内部继续调用 adapter.execute / runReadonly 走同一个事务连接。
   * 简单起见，这里不做 nested-tx 完美支持；如果 callback 内调其他 adapter 实例，不自动串起事务。
   */
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;

  close(): Promise<void>;
}

export type DialectFactory = () => DialectAdapter;

/**
 * 注册表：按 dialect id 查 factory。
 * 实现文件在各自 ./dialects/ 下动态 import，避免在只使用部分驱动时把所有驱动都塞进来。
 */
const factories = new Map<DialectId, DialectFactory>();

export function registerDialect(id: DialectId, factory: DialectFactory): void {
  factories.set(id, factory);
}

/**
 * 调每次都通过工厂函数 `f()` 返回**全新实例** —— 多个并发 caller 拿到独立 adapter，
 * 各自独立 connect/close，不会串扰。registerDefaultDialects() 注册的工厂都形如
 * `() => new XxxAdapter()`，符合这个语义。
 */
export function getDialect(id: DialectId): DialectAdapter {
  const f = factories.get(id);
  if (!f) {
    throw new Error(
      `Dialect '${id}' is not registered. ` +
        `Make sure the corresponding adapter package is installed and registered at startup.`,
    );
  }
  return f();
}

export function listRegisteredDialects(): DialectId[] {
  return Array.from(factories.keys());
}
