import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HmacOrJwtGuard } from './hmac.guard';
import type { AuthService } from '../auth/auth.service';
import type { AccessKeyService } from './access-key.service';
import { IS_PUBLIC_KEY } from '../auth/auth.guard';

interface FakeReq {
  method: string;
  url: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  body?: unknown;
  user?: unknown;
  accessKeyCtx?: unknown;
}

function makeCtx(req: FakeReq, isPublic = false): ExecutionContext {
  const handler = (): void => undefined;
  const cls = class {};
  if (isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

function makeGuard(opts: {
  jwtVerify?: ReturnType<typeof vi.fn>;
  akVerify?: ReturnType<typeof vi.fn>;
}): {
  guard: HmacOrJwtGuard;
  jwtVerify: ReturnType<typeof vi.fn>;
  akVerify: ReturnType<typeof vi.fn>;
} {
  const jwtVerify = opts.jwtVerify ?? vi.fn().mockRejectedValue(new Error('invalid'));
  const akVerify = opts.akVerify ?? vi.fn().mockResolvedValue(null);
  const auth = { verifyAndCheckRevocation: jwtVerify } as unknown as AuthService;
  const ak = { verifySignature: akVerify } as unknown as AccessKeyService;
  return { guard: new HmacOrJwtGuard(new Reflector(), auth, ak), jwtVerify, akVerify };
}

describe('HmacOrJwtGuard', () => {
  it('@Public 路由 → 直接放行，不查 JWT 也不查 HMAC', async () => {
    const { guard, jwtVerify, akVerify } = makeGuard({});
    const ctx = makeCtx(
      { method: 'GET', url: '/api/health', headers: {} },
      /* isPublic */ true,
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwtVerify).not.toHaveBeenCalled();
    expect(akVerify).not.toHaveBeenCalled();
  });

  it('cookie token 有效 → req.user 注入并放行', async () => {
    const userPayload = { sub: 'u1', tenantCode: 't', username: 'a' };
    const { guard, jwtVerify, akVerify } = makeGuard({
      jwtVerify: vi.fn().mockResolvedValue(userPayload),
    });
    const req: FakeReq = {
      method: 'GET',
      url: '/api/x',
      headers: {},
      cookies: { kintsugi_session: 'jwt-token' },
    };
    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);
    expect(req.user).toEqual(userPayload);
    expect(akVerify).not.toHaveBeenCalled();
    expect(jwtVerify).toHaveBeenCalledWith('jwt-token');
  });

  it('Bearer token 有效 → req.user 注入并放行', async () => {
    const userPayload = { sub: 'u1', tenantCode: 't', username: 'a' };
    const { guard, jwtVerify } = makeGuard({
      jwtVerify: vi.fn().mockResolvedValue(userPayload),
    });
    const req: FakeReq = {
      method: 'GET',
      url: '/api/x',
      headers: { authorization: 'Bearer abc.def.ghi' },
    };
    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);
    expect(req.user).toEqual(userPayload);
    expect(jwtVerify).toHaveBeenCalledWith('abc.def.ghi');
  });

  it('JWT 失败但 HMAC 成功 → fall through，accessKeyCtx 注入', async () => {
    const akCtx = {
      appCode: 'app-x',
      tenantCode: 't',
      createdBy: 'svc',
      boundUserId: null,
    };
    const { guard } = makeGuard({
      jwtVerify: vi.fn().mockRejectedValue(new Error('expired')),
      akVerify: vi.fn().mockResolvedValue(akCtx),
    });
    const req: FakeReq = {
      method: 'POST',
      url: '/api/apps/app-x/ds/g/filter',
      headers: {
        authorization: 'Bearer expired',
        'x-access-key': 'ak_xxx',
        'x-signature': 'deadbeef',
        'x-timestamp': '12345',
        'x-nonce': 'n1',
      },
      body: { where: [] },
    };
    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);
    expect(req.accessKeyCtx).toMatchObject({ appCode: 'app-x', accessKey: 'ak_xxx', tenantCode: 't' });
  });

  it('既无 JWT 又无 HMAC → 401', async () => {
    const { guard } = makeGuard({});
    const ctx = makeCtx({ method: 'GET', url: '/api/x', headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('HMAC 头齐全但签名错 → 401', async () => {
    const { guard, akVerify } = makeGuard({
      akVerify: vi.fn().mockResolvedValue(null), // service 拒
    });
    const req: FakeReq = {
      method: 'POST',
      url: '/api/x',
      headers: {
        'x-access-key': 'ak_xxx',
        'x-signature': 'forged',
        'x-timestamp': '12345',
        'x-nonce': 'n',
      },
    };
    await expect(guard.canActivate(makeCtx(req))).rejects.toThrow(UnauthorizedException);
    expect(akVerify).toHaveBeenCalled();
  });

  it('HMAC 缺一个头（如 nonce）→ 不进 verify，直接 401', async () => {
    const { guard, akVerify } = makeGuard({});
    const req: FakeReq = {
      method: 'POST',
      url: '/api/x',
      headers: {
        'x-access-key': 'ak_xxx',
        'x-signature': 'sig',
        'x-timestamp': '12345',
        // nonce missing
      },
    };
    await expect(guard.canActivate(makeCtx(req))).rejects.toThrow(UnauthorizedException);
    expect(akVerify).not.toHaveBeenCalled();
  });

  it('canonical path 用 originalUrl 去掉 query string', async () => {
    const akVerify = vi.fn().mockResolvedValue({
      appCode: 'app-x',
      tenantCode: 't',
      createdBy: null,
      boundUserId: null,
    });
    const { guard } = makeGuard({ akVerify });
    const req: FakeReq = {
      method: 'GET',
      url: '/api/x?q=1',
      originalUrl: '/api/x?q=1&debug=true',
      headers: {
        'x-access-key': 'ak',
        'x-signature': 's',
        'x-timestamp': '1',
        'x-nonce': 'n',
      },
    };
    await guard.canActivate(makeCtx(req));
    expect(akVerify).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/x' }));
  });

  it('GET req.body={} 在签名时被序列化为空字符串（与 SDK 对齐）', async () => {
    const akVerify = vi.fn().mockResolvedValue({
      appCode: 'app-x',
      tenantCode: 't',
      createdBy: null,
      boundUserId: null,
    });
    const { guard } = makeGuard({ akVerify });
    const req: FakeReq = {
      method: 'GET',
      url: '/api/x',
      headers: {
        'x-access-key': 'ak',
        'x-signature': 's',
        'x-timestamp': '1',
        'x-nonce': 'n',
      },
      body: {}, // express 默认空 body
    };
    await guard.canActivate(makeCtx(req));
    expect(akVerify).toHaveBeenCalledWith(expect.objectContaining({ body: '' }));
  });

  it('header 数组取第一个值（multi-valued header 防御）', async () => {
    const akVerify = vi.fn().mockResolvedValue({
      appCode: 'app-x',
      tenantCode: 't',
      createdBy: null,
      boundUserId: null,
    });
    const { guard } = makeGuard({ akVerify });
    const req: FakeReq = {
      method: 'GET',
      url: '/api/x',
      headers: {
        'x-access-key': ['ak1', 'ak2'],
        'x-signature': ['sig'],
        'x-timestamp': '1',
        'x-nonce': 'n',
      },
    };
    await guard.canActivate(makeCtx(req));
    expect(akVerify).toHaveBeenCalledWith(expect.objectContaining({ accessKey: 'ak1', signature: 'sig' }));
  });
});
