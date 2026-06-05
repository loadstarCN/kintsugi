import { BadRequestException, Controller, Get, Header, Param, Res } from '@nestjs/common';
import { OpenapiService } from './openapi.service';
import { buildPlatformSpec } from './platform-spec';
import { Public } from '../auth/auth.guard';

interface ExpressLikeRes {
  type(t: string): ExpressLikeRes;
  send(body: string): void;
}

/** appCode 必须只含 ASCII 字母/数字/`-`/`_`，长度 1-64。 */
const APP_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

function assertAppCode(appCode: string): void {
  if (!APP_CODE_RE.test(appCode)) {
    throw new BadRequestException('invalid appCode');
  }
}

function htmlEscape(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      case '`': return '&#96;';
      default: return c;
    }
  });
}

/** 平台稳定 API 规范——给 @kintsugi/sdk 这种"跨 app"客户端用。
 *  路径 `/api/openapi.platform.json`（不在 :appCode 下）。
 *  为了挂在同一个 OpenapiController 上不另起 controller，下面用同一个 class，
 *  但显式区分 @Get 路径前缀。 */
@Public()
@Controller()
export class PlatformOpenapiController {
  @Get('openapi.platform.json')
  @Header('Content-Type', 'application/json')
  buildPlatform(): unknown {
    return buildPlatformSpec();
  }
}

@Public()
@Controller('apps/:appCode')
export class OpenapiController {
  constructor(private readonly svc: OpenapiService) {}

  @Get('openapi.json')
  @Header('Content-Type', 'application/json')
  build(@Param('appCode') appCode: string): Promise<unknown> {
    assertAppCode(appCode);
    return this.svc.buildForApp(appCode);
  }

  /** 轻量 Swagger UI，避免引入 swagger-ui-express 依赖。 */
  @Get('docs')
  docsHtml(@Param('appCode') appCode: string, @Res() res: ExpressLikeRes): void {
    assertAppCode(appCode);
    const safe = htmlEscape(appCode);
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Kintsugi API · ${safe}</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>body { margin: 0; }</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
window.onload = () => {
  SwaggerUIBundle({
    url: '/api/apps/${safe}/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
  });
};
</script>
</body>
</html>`;
    res.type('html').send(html);
  }
}
