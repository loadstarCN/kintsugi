import type { LlmMessage, LlmProvider, LlmProviderConfig, LlmRequest, LlmResponse } from './types';

/**
 * 覆盖一大票 OpenAI-compatible 后端：DeepSeek / Qwen / OpenAI 本家 / 大部分自托管。
 * 走标准 `/chat/completions` 接口，payload 基本一致；差异（如 thinking / response_format）通过 extra 兜底。
 * 实现刻意不依赖 `openai` 或 `@ai-sdk/*` 包 —— 直接 fetch，便于在 Node/Edge/Bun 通用。
 */

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: { content?: string };
    delta?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly id;
  readonly model;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultTimeout: number;

  constructor(config: LlmProviderConfig) {
    this.id = config.provider;
    this.model = config.model;
    if (!config.baseUrl) {
      throw new Error(`OpenAICompatibleProvider: baseUrl required for ${config.provider}`);
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.defaultTimeout = config.timeoutMs ?? 300_000;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), req.timeoutMs ?? this.defaultTimeout);

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        // content 可能是 string，也可能是 multimodal parts 数组（vision 模型）。
        // OpenAI 兼容 API 直接接受这两种 shape。
        messages: req.messages.map((m: LlmMessage) => ({ role: m.role, content: m.content })),
      };
      if (req.temperature !== undefined) body['temperature'] = req.temperature;
      if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
      if (req.user) body['user'] = req.user;
      if (req.responseFormatJson) {
        // DeepSeek / OpenAI 都支持 `response_format: { type: 'json_object' }`
        body['response_format'] = { type: 'json_object' };
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LLM upstream ${res.status}: ${text.slice(0, 500)}`);
      }

      const json = (await res.json()) as ChatCompletionsResponse;
      const content = json.choices?.[0]?.message?.content ?? '';
      const response: LlmResponse = { content, raw: json };
      if (json.usage) {
        const u: NonNullable<LlmResponse['usage']> = {};
        if (json.usage.prompt_tokens != null) u.promptTokens = json.usage.prompt_tokens;
        if (json.usage.completion_tokens != null) u.completionTokens = json.usage.completion_tokens;
        if (json.usage.total_tokens != null) u.totalTokens = json.usage.total_tokens;
        response.usage = u;
      }
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
