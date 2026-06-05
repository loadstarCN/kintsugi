import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import type { RbacService } from './rbac.service';
import { PERMISSION_KEY } from './permission.decorator';
import { IS_PUBLIC_KEY } from '../auth/auth.guard';

interface FakeReq {
  user?: { sub: string; tenantCode: string; username: string };
  accessKeyCtx?: { appCode: string };
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

function makeCtx(req: FakeReq, meta: Record<string | symbol, unknown> = {}): ExecutionContext {
  const handler = (): void => undefined;
  const cls = class {};
  // Reflect metadata on handler so Reflector.get works
  for (const [k, v] of Object.entries(meta)) {
    Reflect.defineMetadata(k, v, handler);
  }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

function makeGuard(rbacOk: boolean): { guard: PermissionGuard; rbac: { userHasPermission: ReturnType<typeof vi.fn> } } {
  const rbac = { userHasPermission: vi.fn(async () => rbacOk) };
  const guard = new PermissionGuard(new Reflector(), rbac as unknown as RbacService);
  return { guard, rbac };
}

describe('PermissionGuard', () => {
  it('allows when route is @Public even if @Permission is set', async () => {
    const { guard, rbac } = makeGuard(false);
    const ctx = makeCtx({}, { [IS_PUBLIC_KEY]: true, [PERMISSION_KEY]: ['dataset:write'] });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(rbac.userHasPermission).not.toHaveBeenCalled();
  });

  it('allows when no @Permission metadata is present', async () => {
    const { guard } = makeGuard(false);
    const ctx = makeCtx({ user: { sub: 'u1', tenantCode: 't', username: 'a' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows access-key path even when @Permission is required', async () => {
    const { guard, rbac } = makeGuard(false);
    const ctx = makeCtx(
      { accessKeyCtx: { appCode: 'app-x' } },
      { [PERMISSION_KEY]: ['dataset:write'] },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(rbac.userHasPermission).not.toHaveBeenCalled();
  });

  it('throws Forbidden when @Permission set and user is anonymous', async () => {
    const { guard } = makeGuard(false);
    const ctx = makeCtx({}, { [PERMISSION_KEY]: ['dataset:write'] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('checks <appCode>:<key> against RbacService and throws on miss', async () => {
    const { guard, rbac } = makeGuard(false);
    const ctx = makeCtx(
      {
        user: { sub: 'u1', tenantCode: 't', username: 'a' },
        params: { appCode: 'app-x' },
      },
      { [PERMISSION_KEY]: ['dataset:write'] },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(/missing permission: app-x:dataset:write/);
    expect(rbac.userHasPermission).toHaveBeenCalledWith('u1', 'app-x:dataset:write');
  });

  it('passes when RbacService allows; multiple keys are AND', async () => {
    const rbac = { userHasPermission: vi.fn(async () => true) };
    const guard = new PermissionGuard(new Reflector(), rbac as unknown as RbacService);
    const ctx = makeCtx(
      {
        user: { sub: 'u1', tenantCode: 't', username: 'a' },
        body: { appCode: 'app-y' },
      },
      { [PERMISSION_KEY]: ['dataset:write', 'dataset:read'] },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(rbac.userHasPermission).toHaveBeenCalledTimes(2);
    expect(rbac.userHasPermission).toHaveBeenNthCalledWith(1, 'u1', 'app-y:dataset:write');
    expect(rbac.userHasPermission).toHaveBeenNthCalledWith(2, 'u1', 'app-y:dataset:read');
  });

  it('falls back to "*" when no appCode in params/query/body', async () => {
    const rbac = { userHasPermission: vi.fn(async () => true) };
    const guard = new PermissionGuard(new Reflector(), rbac as unknown as RbacService);
    const ctx = makeCtx(
      { user: { sub: 'u1', tenantCode: 't', username: 'a' } },
      { [PERMISSION_KEY]: ['admin:read'] },
    );
    await guard.canActivate(ctx);
    expect(rbac.userHasPermission).toHaveBeenCalledWith('u1', '*:admin:read');
  });
});
