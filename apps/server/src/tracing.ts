/**
 * OpenTelemetry 引导：trace + metrics 一起起。必须在 Nest 启动之前 require ——
 * main.ts 第一行 import。
 *
 * 控制：
 *  - OTEL_ENABLED=true 才启用（默认不开，避免本地开发噪声）
 *  - OTEL_EXPORTER_OTLP_ENDPOINT 指定 OTLP 接收端 base（默认 http://localhost:4318）
 *    - traces 走 ${base}/v1/traces
 *    - metrics 走 ${base}/v1/metrics
 *  - OTEL_SERVICE_NAME 默认 `kintsugi-server`
 *  - OTEL_METRIC_EXPORT_INTERVAL_MS 默认 60000（推送间隔）
 *
 * 自动 instrument 对象：NestJS / http / pg / mysql / redis / express。
 *
 * 应用级 metric 的 Meter 在 `common/metrics.ts` 里 lazy-init —— OTEL_ENABLED=false
 * 时通过 OTel API 的 noop provider 兜住，业务代码无脑 .add() 不会崩。
 */
import type { NodeSDK as NodeSDKType } from '@opentelemetry/sdk-node';
import type { MeterProvider as MeterProviderType } from '@opentelemetry/sdk-metrics';

let sdk: NodeSDKType | null = null;
let meterProvider: MeterProviderType | null = null;

export async function startTracing(): Promise<void> {
  if ((process.env['OTEL_ENABLED'] ?? '').toLowerCase() !== 'true') {
    return;
  }
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = await import(
    '@opentelemetry/auto-instrumentations-node'
  );
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
  const { MeterProvider, PeriodicExportingMetricReader } = await import(
    '@opentelemetry/sdk-metrics'
  );
  const otelApi = await import('@opentelemetry/api');

  const baseEndpoint =
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
  const tracesUrl = `${baseEndpoint.replace(/\/+$/, '')}/v1/traces`;
  const metricsUrl = `${baseEndpoint.replace(/\/+$/, '')}/v1/metrics`;
  const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'kintsugi-server';
  const exportIntervalMs = Number(process.env['OTEL_METRIC_EXPORT_INTERVAL_MS'] ?? 60_000);

  // ---- traces ----
  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({ url: tracesUrl }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  // ---- metrics ----
  // 不让 NodeSDK 接管 metrics——它对 metric reader 配置的 ergonomics 一般，自己起 MeterProvider 更直白。
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: metricsUrl }),
    exportIntervalMillis: exportIntervalMs,
  });
  meterProvider = new MeterProvider({ readers: [metricReader] });
  otelApi.metrics.setGlobalMeterProvider(meterProvider);

  try {
    sdk.start();
     
    console.log(
      `[otel] enabled: service=${serviceName} traces=${tracesUrl} metrics=${metricsUrl} interval=${exportIntervalMs}ms`,
    );
  } catch (err) {
     
    console.warn('[otel] start failed:', (err as Error).message);
  }

  const shutdown = async (): Promise<void> => {
    await sdk?.shutdown().catch(() => undefined);
    await meterProvider?.shutdown().catch(() => undefined);
  };
  process.on('SIGTERM', () => {
    void shutdown();
  });
}
