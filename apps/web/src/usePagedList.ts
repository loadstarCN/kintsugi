import * as React from 'react';
import type { PagedResult, PageRequest } from './api';

export interface PagedListState<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  keyword: string;
  setKeyword(k: string): void;
  setPage(p: number, ps?: number): void;
  refresh(): Promise<void>;
}

/**
 * 通用列表 hook：把 server-side 分页 + keyword 搜索封装一处。
 * fetcher 是一个稳定的 useCallback。
 */
export function usePagedList<T>(
  fetcher: (q: PageRequest) => Promise<PagedResult<T>>,
  defaults: { pageSize?: number } = {},
): PagedListState<T> {
  const [data, setData] = React.useState<T[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPageState] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(defaults.pageSize ?? 20);
  const [keyword, setKeywordState] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const fetcherRef = React.useRef(fetcher);
  React.useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetcherRef.current({ page, pageSize, keyword });
      setData(r.data);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPage = React.useCallback((p: number, ps?: number) => {
    setPageState(p);
    if (ps !== undefined) setPageSize(ps);
  }, []);

  const setKeyword = React.useCallback((k: string) => {
    setKeywordState(k);
    setPageState(1);
  }, []);

  return { data, total, page, pageSize, loading, keyword, setKeyword, setPage, refresh };
}
