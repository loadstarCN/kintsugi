export interface PageRequest {
  page?: number; // 1-based
  pageSize?: number;
  /** 可选 关键字搜索；具体字段由各 service 决定。 */
  keyword?: string;
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Backward-compat 老名字。 */
export type PageResult<T> = PagedResult<T>;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

export interface PaginationSpec {
  take: number;
  skip: number;
  page: number;
  pageSize: number;
}

export function paginate(req: PageRequest, opts: { defaultPageSize?: number; maxPageSize?: number } = {}): PaginationSpec {
  const max = opts.maxPageSize ?? MAX_PAGE_SIZE;
  const def = opts.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, Math.floor(req.page ?? 1));
  const pageSize = Math.min(max, Math.max(1, Math.floor(req.pageSize ?? def)));
  return { take: pageSize, skip: (page - 1) * pageSize, page, pageSize };
}

export function normalizePage(req: PageRequest): Required<Omit<PageRequest, 'keyword'>> {
  const { page, pageSize } = paginate(req);
  return { page, pageSize };
}
