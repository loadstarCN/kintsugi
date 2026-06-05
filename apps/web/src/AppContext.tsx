import * as React from 'react';
import { api, type ApplicationSummary, type PagedResult } from './api';
import { useAuth } from './auth';

/**
 * 全租户应用列表，挂在 AuthProvider 下面，**登录态确认后**才拉一次缓存住。
 * 之前 10 个 page 各自 useEffect 拉 `/applications?pageSize=500`，每次切页都重发 ——
 * 同一个回答 N 次，浪费带宽 + 后端配额。
 *
 * 必须等 `me` 才发请求，否则 /login 页也会触发 401 → api.ts 重定向死循环。
 */

interface AppListContextValue {
  apps: ApplicationSummary[] | null; // null = 还在拉 / 未登录
  error: Error | null;
  refresh(): Promise<void>;
}

const AppListCtx = React.createContext<AppListContextValue | null>(null);

export function AppListProvider({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  const [apps, setApps] = React.useState<ApplicationSummary[] | null>(null);
  const [error, setError] = React.useState<Error | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const r = await api.get<PagedResult<ApplicationSummary>>('/applications?pageSize=500');
      setApps(r.data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    }
  }, []);

  React.useEffect(() => {
    if (!me) {
      // 退出登录或未登录：清空缓存，避免下个用户看到上个用户的应用列表
      setApps(null);
      setError(null);
      return;
    }
    void refresh();
  }, [me, refresh]);

  const value = React.useMemo<AppListContextValue>(
    () => ({ apps, error, refresh }),
    [apps, error, refresh],
  );

  return <AppListCtx.Provider value={value}>{children}</AppListCtx.Provider>;
}

/** 拿应用列表（已缓存）。null = 还在初始化；空数组 = 没应用。 */
export function useApps(): AppListContextValue {
  const v = React.useContext(AppListCtx);
  if (!v) throw new Error('useApps must be called inside <AppListProvider>');
  return v;
}
