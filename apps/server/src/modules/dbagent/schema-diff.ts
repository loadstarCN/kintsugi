import type { SchemaSnapshot } from '@kintsugi/db-scanner';

export interface SchemaDiff {
  addedTables: string[];
  removedTables: string[];
  modifiedTables: Array<{
    table: string;
    addedColumns: string[];
    removedColumns: string[];
    changedColumns: Array<{ column: string; before: ColSummary; after: ColSummary }>;
  }>;
}

interface ColSummary {
  nativeType: string;
  nullable: boolean;
  isPrimary: boolean;
  isAutoIncrement: boolean;
}

function colSummary(c: SchemaSnapshot['tables'][number]['columns'][number]): ColSummary {
  return {
    nativeType: c.nativeType,
    nullable: c.nullable,
    isPrimary: c.primaryKeyOrder !== undefined,
    isAutoIncrement: c.isAutoIncrement,
  };
}

function sameCol(a: ColSummary, b: ColSummary): boolean {
  return (
    a.nativeType === b.nativeType &&
    a.nullable === b.nullable &&
    a.isPrimary === b.isPrimary &&
    a.isAutoIncrement === b.isAutoIncrement
  );
}

export function diffSnapshots(prev: SchemaSnapshot, next: SchemaSnapshot): SchemaDiff {
  const prevTables = new Map(prev.tables.map((t) => [t.name, t]));
  const nextTables = new Map(next.tables.map((t) => [t.name, t]));
  const addedTables: string[] = [];
  const removedTables: string[] = [];
  for (const name of nextTables.keys()) if (!prevTables.has(name)) addedTables.push(name);
  for (const name of prevTables.keys()) if (!nextTables.has(name)) removedTables.push(name);

  const modifiedTables: SchemaDiff['modifiedTables'] = [];
  for (const [name, nextT] of nextTables) {
    const prevT = prevTables.get(name);
    if (!prevT) continue;
    const prevCols = new Map(prevT.columns.map((c) => [c.name, c]));
    const nextCols = new Map(nextT.columns.map((c) => [c.name, c]));
    const addedColumns: string[] = [];
    const removedColumns: string[] = [];
    const changedColumns: SchemaDiff['modifiedTables'][number]['changedColumns'] = [];
    for (const cname of nextCols.keys()) if (!prevCols.has(cname)) addedColumns.push(cname);
    for (const cname of prevCols.keys()) if (!nextCols.has(cname)) removedColumns.push(cname);
    for (const [cname, nc] of nextCols) {
      const pc = prevCols.get(cname);
      if (!pc) continue;
      const b = colSummary(pc);
      const a = colSummary(nc);
      if (!sameCol(b, a)) changedColumns.push({ column: cname, before: b, after: a });
    }
    if (addedColumns.length || removedColumns.length || changedColumns.length) {
      modifiedTables.push({ table: name, addedColumns, removedColumns, changedColumns });
    }
  }
  return { addedTables, removedTables, modifiedTables };
}
