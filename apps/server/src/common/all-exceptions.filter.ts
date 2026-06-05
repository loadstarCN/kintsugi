import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { uncaughtExceptionCounter } from './metrics';

interface ExpressLikeRes {
  status(code: number): ExpressLikeRes;
  json(body: unknown): void;
}

/**
 * 兜底 catch 所有非 KintsugiError / 非 HttpException 的异常。
 *  - 5xx 不外泄堆栈（防 SQL/internal 文案泄漏）
 *  - 计数 uncaught_exception_total{kind=unknown}
 *  - error 日志（带 stack）便于线下排查
 *
 * 注册顺序在 KintsugiErrorFilter 之前（Nest filter 倒序匹配，最后注册的最先 catch）；
 * 见 main.ts。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<ExpressLikeRes>();

    // Nest 自己的 HttpException 走内置流程，不要在这里抢
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status >= 500) {
        uncaughtExceptionCounter.add(1, { kind: 'nest_http' });
        this.logger.error(`HttpException ${status}`, exception.stack);
      }
      res.status(status).json(typeof body === 'string' ? { message: body, statusCode: status } : body);
      return;
    }

    // 真正的 unknown：500 + 不外泄堆栈
    const err = exception as Error;
    uncaughtExceptionCounter.add(1, { kind: 'unknown' });
    this.logger.error(`uncaught: ${err?.message ?? exception}`, err?.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Internal server error',
    });
  }
}
