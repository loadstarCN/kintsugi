import * as React from 'react';

/**
 * Auth：服务端 set httpOnly cookie，前端只用 `me` 判定登录态。
 * 不再 localStorage 存 JWT —— XSS 失窃面被关掉。
 *
 * `token` 字段保留（暴露给 ProtectedRoute 等老调用方），但永远是 null —— 真正的
 * "已登录"判定改成 `me !== null`。等所有调用方都迁到 me 后可以拿掉 token 字段。
 */

export interface MeInfo {
  id: string;
  tenantCode: string;
  username: string;
  email: string | null;
  roles: string[];
  /**
   * 用户的扁平 grants（包含通配符如 `*:*:*` / `*:admin:read`）。
   * 仅供前端 nav / UI 决定展示用；最终鉴权仍以服务端 PermissionGuard 为准。
   */
  grants: string[];
}

/**
 * 前端展示用 grant 匹配。匹配 RbacService.userHasPermission 的通配符规则。
 *  - 用户 grants 含 `*:*:*` → 任何 key 都通过
 *  - 严格相等 → 通过
 *  - 通配符匹配（任一段为 `*` 视作 wildcard）
 *
 * 注意：这里**不**自己拼 appCode 前缀；调用方按需要传 `<app>:res:act` 或 `*:res:act`。
 * 默认对 admin 类 nav 我们传 `*:admin:read` 这种全局形态。
 */
export function hasGrant(me: MeInfo | null, key: string): boolean {
  if (!me) return false;
  const grants = me.grants;
  if (grants.includes('*:*:*')) return true;
  if (grants.includes(key)) return true;
  const [a, r, c] = key.split(':');
  const variants = [
    `*:${r}:${c}`,
    `${a}:*:${c}`,
    `${a}:${r}:*`,
    `*:*:${c}`,
    `${a}:*:*`,
    `*:${r}:*`,
  ];
  return variants.some((v) => grants.includes(v));
}

export interface AuthContextValue {
  /** @deprecated cookie 是 httpOnly，前端拿不到 token；用 me 判登录态 */
  token: null;
  me: MeInfo | null;
  loading: boolean;
  login(input: { tenantCode: string; username: string; password: string }): Promise<void>;
  register(input: {
    tenantCode: string;
    username: string;
    password: string;
    email?: string;
  }): Promise<void>;
  logout(): Promise<void>;
}

const AuthCtx = React.createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<MeInfo | null> {
  const res = await fetch('/api/auth/me');
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`/api/auth/me failed: ${res.status}`);
  return (await res.json()) as MeInfo;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = React.useState<MeInfo | null>(null);
  const [loading, setLoading] = React.useState(true);

  // 启动时探一次 cookie 是否还有效
  React.useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((r) => {
        if (!cancelled) setMe(r);
      })
      .catch(() => {
        // 网络抖动等非 401 情况：留 me=null，loading 结束，让 ProtectedRoute 决策
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value: AuthContextValue = {
    token: null,
    me,
    loading,
    async login(input) {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg =
          body && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message)
            : `login failed: ${res.status}`;
        throw new Error(msg);
      }
      // 服务端已 Set-Cookie；拿 me 即可。
      const m = await fetchMe();
      setMe(m);
    },
    async register(input) {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`register failed: ${res.status}`);
      const m = await fetchMe();
      setMe(m);
    },
    async logout() {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      setMe(null);
    },
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = React.useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be called inside <AuthProvider>');
  return v;
}
