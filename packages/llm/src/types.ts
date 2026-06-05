/** 统一的消息格式。provider 各自把它翻成对应厂商 API 的 payload。
 *
 *  content 既可以是纯文本（最常见路径），也可以是多模态 parts 数组——
 *  让上层在 vision 模型（DeepSeek-VL / GPT-4o / Qwen-VL）下传图片。
 *  现有 provider 把数组直接 pass-through 给 OpenAI 兼容 API。
 */
export type LlmTextPart = { type: 'text'; text: string };
export type LlmImagePart = {
  type: 'image_url';
  /** 标准 OpenAI vision shape：可以是 https URL 或 data: URL（base64）。 */
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
};
export type LlmContentPart = LlmTextPart | LlmImagePart;

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LlmContentPart[];
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** 0-2。未指定则 provider 用默认值。 */
  temperature?: number;
  /** 希望输出 JSON 时置 true；provider 尽量约束（用 response_format 或 system prompt 兜底）。 */
  responseFormatJson?: boolean;
  /** 最大生成 token；各 provider 名字不同，内部翻译。 */
  maxTokens?: number;
  /** 请求级超时（覆盖 provider 默认）。 */
  timeoutMs?: number;
  /** 透传给上游的用户标识，便于滥用追溯。 */
  user?: string;
  /** 启用流式回调时由调用方设置。 */
  onDelta?: (chunk: string) => void;
}

export interface LlmResponse {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** 原始响应（调试用，可能体积大，日志按采样记录）。 */
  raw?: unknown;
}

export type LlmProviderId = 'deepseek' | 'openai' | 'anthropic' | 'qwen' | 'azure-openai';

export interface LlmProviderConfig {
  provider: LlmProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Provider-specific overrides. */
  extra?: Record<string, unknown>;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}
