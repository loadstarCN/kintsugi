import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { KintsugiError, type KintsugiErrorCode } from '@kintsugi/shared';
import { uncaughtExceptionCounter } from './metrics';

interface ExpressLikeRes {
  status(code: number): ExpressLikeRes;
  json(body: unknown): void;
}

const STATUS_BY_CODE: Record<KintsugiErrorCode, number> = {
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  CONFLICT: HttpStatus.CONFLICT,
  BLOCKED_BY_CONCURRENT_EDIT: HttpStatus.CONFLICT,
  TENANT_ISOLATION_VIOLATED: HttpStatus.FORBIDDEN,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  DATASOURCE_UNREACHABLE: HttpStatus.BAD_GATEWAY,
  DATASOURCE_DIALECT_UNSUPPORTED: HttpStatus.BAD_REQUEST,
  LLM_UPSTREAM_ERROR: HttpStatus.BAD_GATEWAY,
  INSUFFICIENT_CREDIT: HttpStatus.PAYMENT_REQUIRED,
  QUOTA_EXCEEDED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * 把 service 层抛出的 KintsugiError 翻译成合适的 HTTP 状态码 + 结构化 body。
 * 不在这里处理 Nest 自身的 HttpException —— 它已有内置流程。
 */
@Catch(KintsugiError)
export class KintsugiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(KintsugiErrorFilter.name);

  catch(exception: KintsugiError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<ExpressLikeRes>();
    const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      this.logger.error(`${exception.code}: ${exception.message}`, exception.stack);
      uncaughtExceptionCounter.add(1, { kind: 'kintsugi_error', code: exception.code });
    }

    res.status(status).json({
      statusCode: status,
      code: exception.code,
      message: exception.message,
      ...(exception.details !== undefined ? { details: exception.details } : {}),
    });
  }
}
