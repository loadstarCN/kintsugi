import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'body-parser';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { registerDefaultDialects } from '@kintsugi/db-scanner';
import { startTracing } from './tracing';
import { KintsugiErrorFilter } from './common/kintsugi-error.filter';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AuthService } from './modules/auth/auth.service';
import { validateEncryptionKeyAtStartup } from './common/crypto';

async function bootstrap(): Promise<void> {
  // ENCRYPTION_KEY 强度校验放在最前：漏配让进程立即 fail-fast，
  // 不要等第一次 encrypt/decrypt 才崩（access key / datasource creds 才碰得到）。
  validateEncryptionKeyAtStartup();

  await startTracing();
  registerDefaultDialects();

  // 关掉 Nest 默认 body-parser，自己装一份并把原始 body 挂到 req.rawBody
  // （飞书 webhook 等需要按原文计算签名）。
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });

  // trust proxy：让 Express 在反代后能正确解析 X-Forwarded-For → req.ip。
  // 配置含义见 https://expressjs.com/en/guide/behind-proxies.html
  //   未设 / 'loopback'   →  只信 127.0.0.1（默认安全；生产无反代时用这个）
  //   'true' / '1'        →  信任全部上游（直接读首跳 X-Forwarded-For；只有完全不暴露公网时安全）
  //   'X.X.X.X[/cidr]...' →  逗号分隔的可信反代 IP / CIDR 列表
  //   '<n>'(数字)         →  信任最近 n 跳代理
  const trustProxyRaw = (process.env['TRUST_PROXY'] ?? 'loopback').trim();
  const trustProxy =
    trustProxyRaw === 'true' || trustProxyRaw === '1'
      ? true
      : trustProxyRaw === 'false' || trustProxyRaw === '0' || trustProxyRaw === ''
        ? false
        : /^\d+$/.test(trustProxyRaw)
          ? Number(trustProxyRaw)
          : trustProxyRaw;
  // NestExpressAdapter 暴露的 instance 是 Express app
  const httpAdapter = app.getHttpAdapter().getInstance() as {
    set(name: string, value: unknown): void;
  };
  httpAdapter.set('trust proxy', trustProxy);

  app.use(helmet());
  app.use(cookieParser());
  app.use(
    json({
      limit: '4mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '4mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Filter 顺序：Nest 倒序匹配——KintsugiErrorFilter 先 catch 自家 KintsugiError；
  // 剩下的都被 AllExceptionsFilter 兜底（含 HttpException 的 5xx 计数）。
  app.useGlobalFilters(new AllExceptionsFilter(), new KintsugiErrorFilter());
  app.setGlobalPrefix('api');

  // 启动 + 周期性清理：删过期的 JWT 撤销项，防表无限增长（token TTL 7d，
  // 进程长跑时若只在启动跑一次，撤销表会持续累积一周量级垃圾行）。
  const auth = app.get(AuthService);
  const runCleanup = (): void => {
    void auth.cleanupExpiredRevocations().then((n) => {
      if (n > 0) {
         
        console.log(`[kintsugi] cleaned ${n} expired JWT revocations`);
      }
    });
  };
  runCleanup();
  // 每小时跑一次；setInterval 在进程退出时不阻塞（unref 一下）
  setInterval(runCleanup, 60 * 60 * 1000).unref();

  const port = Number(process.env['SERVER_PORT'] ?? 4000);
  await app.listen(port);
   
  console.log(`[kintsugi] server listening on http://localhost:${port}`);

  // BFF 沙箱安全告警 —— node:vm 不是真隔离，写权限必须收紧到管理员。
  if (process.env['NODE_ENV'] === 'production') {
     
    console.warn(
      '[kintsugi][SECURITY] BFF runs in node:vm which is NOT a security sandbox. ' +
        'Restrict BFF script write to admins only, or run server in a dedicated container. ' +
        'Switch to isolated-vm / worker_threads before exposing BFF write to multi-tenant users.',
    );
  }
}

bootstrap().catch((err) => {
   
  console.error('bootstrap failed', err);
  process.exit(1);
});
