import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { LlmModule } from './llm/llm.module';
import { HealthModule } from './modules/health/health.module';
import { DataSourceModule } from './modules/datasource/datasource.module';
import { DbAgentModule } from './modules/dbagent/dbagent.module';
import { ApplicationModule } from './modules/application/application.module';
import { DatasetModule } from './modules/dataset/dataset.module';
import { InstantApiModule } from './modules/instant-api/instant-api.module';
import { OpenapiModule } from './modules/openapi/openapi.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomSqlModule } from './modules/custom-sql/custom-sql.module';
import { AccessKeyModule } from './modules/access-key/access-key.module';
import { BffModule } from './modules/bff/bff.module';
import { ChatsModule } from './modules/chats/chats.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AssetTransferModule } from './modules/asset-transfer/asset-transfer.module';
import { PagesModule } from './modules/pages/pages.module';
import { ReportsModule } from './modules/reports/reports.module';
import { FeishuModule } from './modules/feishu/feishu.module';
import { DingtalkModule } from './modules/dingtalk/dingtalk.module';
import { WecomModule } from './modules/wecom/wecom.module';
import { SdkDownloadModule } from './modules/sdk-download/sdk-download.module';
import { AuditModule } from './modules/audit/audit.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { TrialModule } from './modules/trial/trial.module';
import { MailModule } from './modules/mail/mail.module';
import { BillingModule } from './modules/billing/billing.module';
import { AuditInterceptor } from './common/audit.interceptor';
import { RateLimitMiddleware } from './common/rate-limit.middleware';
import { AiRateLimitMiddleware } from './common/ai-rate-limit.middleware';
import {
  LoginThrottleMiddleware,
  AccessKeyCreateThrottleMiddleware,
  TrialApplyThrottleMiddleware,
} from './common/login-throttle.middleware';
import { TenantGuard } from './common/tenant.guard';
import { HmacOrJwtGuard } from './modules/access-key/hmac.guard';
import { PermissionGuard } from './modules/rbac/permission.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    PrismaModule,
    LlmModule,
    HealthModule,
    ApplicationModule,
    DataSourceModule,
    DbAgentModule,
    DatasetModule,
    InstantApiModule,
    OpenapiModule,
    AuthModule,
    CustomSqlModule,
    AccessKeyModule,
    BffModule,
    ChatsModule,
    RbacModule,
    AssetTransferModule,
    PagesModule,
    ReportsModule,
    FeishuModule,
    DingtalkModule,
    WecomModule,
    SdkDownloadModule,
    AuditModule,
    TenantModule,
    SchedulerModule,
    WebhookModule,
    TrialModule,
    MailModule,
    BillingModule,
  ],
  providers: [
    // 全局认证（先跑）：JWT cookie / Bearer 优先，否则 HMAC（X-Access-Key + 签名）；
    // @Public() 装饰的路由直接放行（auth/health/sdk-download 等）。
    { provide: APP_GUARD, useClass: HmacOrJwtGuard },
    // 全局租户隔离（认证后跑）：appCode 的 tenantCode 必须等于 req.user.tenantCode；
    // access key 路径校验 ctx.appCode 与请求 appCode 一致。
    { provide: APP_GUARD, useClass: TenantGuard },
    // 权限校验（最后跑）：@Permission 装饰的路由查 user.roles 的 grants；
    // 没装饰默认放行（向后兼容）；access key 路径默认放行（受 TenantGuard 限定）。
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // login 单独的暴破节流（默认 5/min/IP，更严）
    consumer
      .apply(LoginThrottleMiddleware)
      .forRoutes({ path: 'auth/login', method: RequestMethod.POST });
    // access key 创建节流（默认 10/min/IP）：每条都要落库 + 加密，被滥用时压力大
    consumer
      .apply(AccessKeyCreateThrottleMiddleware)
      .forRoutes({ path: 'access-keys', method: RequestMethod.POST });
    // 试用申请节流（默认 3/min/IP）：公开 endpoint 防机器人填爆 RDS
    consumer
      .apply(TrialApplyThrottleMiddleware)
      .forRoutes({ path: 'trial/apply', method: RequestMethod.POST });
    // 通用 RateLimit 应用到所有 /api（含 login —— 走完 login 节流仍计入通用桶）；
    // 排除 health
    consumer.apply(RateLimitMiddleware).exclude('api/health').forRoutes('api/*');

    // AI hot-path 严限流：默认 10/min, 200/hour（per tenant / appCode / IP）。
    // 这些端点都会真去烧 LLM token + 跑外部 DB；要比通用桶严得多。
    consumer
      .apply(AiRateLimitMiddleware)
      .forRoutes(
        { path: 'chats/ask', method: RequestMethod.POST },
        { path: 'apps/:appCode/reports/ask', method: RequestMethod.POST },
        { path: 'apps/:appCode/pages/generate', method: RequestMethod.POST },
        { path: 'pages/:id/regenerate', method: RequestMethod.POST },
        { path: 'pages/:id/publish', method: RequestMethod.POST },
        { path: 'dbagent/datasources/:dataSourceId/scan', method: RequestMethod.POST },
        { path: 'dbagent/datasources/:dataSourceId/sync', method: RequestMethod.POST },
        { path: 'bridges/feishu/webhook', method: RequestMethod.POST },
      );
  }
}
