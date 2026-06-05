import type { DialectAdapter } from '../dialect';
import type {
  ConnectionParams,
  DialectId,
  IntrospectOptions,
  SchemaSnapshot,
  TableSample,
} from '../types';

/**
 * 占位实现：MSSQL / Oracle / SQLite 这些方言先不接驱动，保留接口结构。
 * 注册时用法：registerDialect('mssql', () => new UnsupportedAdapter('mssql'));
 * 任何调用会立刻抛 DATASOURCE_DIALECT_UNSUPPORTED 的语义（上层转成 KintsugiError）。
 */
export class UnsupportedAdapter implements DialectAdapter {
  readonly id: DialectId;
  constructor(id: DialectId) {
    this.id = id;
  }
  connect(_: ConnectionParams): Promise<void> {
    return Promise.reject(this.err());
  }
  introspect(_?: IntrospectOptions): Promise<SchemaSnapshot> {
    return Promise.reject(this.err());
  }
  sampleTable(_: string | undefined, __: string, ___: number): Promise<TableSample> {
    return Promise.reject(this.err());
  }
  runReadonly<T = unknown>(_: string, __?: unknown[]): Promise<T[]> {
    return Promise.reject(this.err());
  }
  execute<T = Record<string, unknown>>(
    _: string,
    __?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }> {
    return Promise.reject(this.err());
  }
  quoteIdentifier(name: string): string {
    return `"${name}"`;
  }
  placeholder(index: number): string {
    return `$${index}`;
  }
  withTransaction<T>(_: () => Promise<T>): Promise<T> {
    return Promise.reject(this.err());
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  private err(): Error {
    return new Error(`Dialect '${this.id}' is not yet implemented in this MVP.`);
  }
}
