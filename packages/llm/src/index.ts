export * from './types';
export { OpenAICompatibleProvider } from './openai-compatible';

import type { LlmProvider, LlmProviderConfig, LlmProviderId } from './types';
import { OpenAICompatibleProvider } from './openai-compatible';

/**
 * 工厂：按 provider 配置返回具体实现。
 * 目前 DeepSeek / Qwen / OpenAI 都可复用 OpenAICompatibleProvider，
 * Anthropic / Azure OpenAI 后续各写一个。
 */
export function createLlmProvider(config: LlmProviderConfig): LlmProvider {
  const provider = config.provider;
  switch (provider) {
    case 'deepseek':
      return new OpenAICompatibleProvider({
        baseUrl: 'https://api.deepseek.com',
        ...config,
      });
    case 'qwen':
      return new OpenAICompatibleProvider({
        baseUrl: 'https://your-pg-host.example.com/compatible-mode/v1',
        ...config,
      });
    case 'openai':
      return new OpenAICompatibleProvider({
        baseUrl: 'https://api.openai.com/v1',
        ...config,
      });
    case 'anthropic':
    case 'azure-openai':
      throw new Error(`LLM provider '${provider}' not implemented yet`);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown LLM provider: ${String(_exhaustive)}`);
    }
  }
}

export function createLlmProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const provider = (env['LLM_PROVIDER'] ?? 'deepseek') as LlmProviderId;
  const model = env['LLM_MODEL'] ?? 'deepseek-chat';
  const apiKey = env['LLM_API_KEY'] ?? '';
  if (!apiKey) {
    throw new Error('LLM_API_KEY is required');
  }
  const config: LlmProviderConfig = { provider, model, apiKey };
  if (env['LLM_BASE_URL']) config.baseUrl = env['LLM_BASE_URL'];
  if (env['LLM_TIMEOUT_MS']) config.timeoutMs = Number(env['LLM_TIMEOUT_MS']);
  return createLlmProvider(config);
}
