/**
 * 拆出来防 llm.module.ts ↔ llm-gateway.service.ts 的循环 import。
 * llm.module.ts 既 export LLM_PROVIDER 又 import LlmGateway，gateway 又
 * 反过来 import LLM_PROVIDER —— ESM hoisting 下首次访问会 TDZ。
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
