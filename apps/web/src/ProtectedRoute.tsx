import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './auth';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div style={{ padding: 64, textAlign: 'center' }}>
        <Spin tip="验证身份…">
          <div style={{ padding: 32 }} />
        </Spin>
      </div>
    );
  }
  // 鉴权改用 httpOnly cookie；前端只能通过 me 是否拿到判定登录态。
  if (!me) {
    // 根路径 → 落地页；其他受保护路径 → 登录页（保留来源）
    const target = location.pathname === '/' ? '/landing' : '/login';
    return <Navigate to={target} state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
