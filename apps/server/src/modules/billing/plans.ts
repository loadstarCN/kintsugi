/**
 * Kintsugi 商业套餐定义。
 *
 * 不做单独 Plan 表 —— 套餐改动罕见，调价 / 加套餐就改这份代码 + 重新 deploy。
 * code 是稳定 ID（写入 Tenant.currentPlanCode 和 UpgradeRequest.requestedPlanCode），
 * 改 code 视作"新套餐 + 旧套餐废弃"，不要原地改 code 含义。
 *
 * 价格用元；展示给用户的金额按 priceYuanPerMonth × requestedDurationMonths
 * 计算（年套餐已经在 priceYuanPerMonth 里折好月单价）。
 */

import type { Edition } from '@prisma/client';

export interface Plan {
  /** 稳定 ID。 */
  code: string;
  /** 升级后租户进入的 edition。 */
  edition: Edition;
  /** 展示名（中文）。 */
  displayName: string;
  /** 一行说明，用于卡片副标题。 */
  tagline: string;
  /** 月单价（元）。年套餐已折好。 */
  priceYuanPerMonth: number;
  /** 套餐允许选购的时长（月数列表）。 */
  durationsMonths: number[];
  /** 配额上限（升级时同步写到 Tenant.maxXxx；null = 不限）。 */
  quota: {
    maxDataSources: number | null;
    maxDatasets: number | null;
    maxDailyLlmCalls: number | null;
  };
  /** 每月赠送 AI 余额（元）。approve 时按 duration 累加到 Tenant.aiCredits。 */
  monthlyAiCreditYuan: number;
  /** 卖点列表，UI 卡片用。 */
  features: string[];
}

export const PLANS: Plan[] = [
  {
    code: 'pro_monthly',
    edition: 'PRO',
    displayName: 'PRO · 月付',
    tagline: '适合中小团队按月使用',
    priceYuanPerMonth: 880,
    durationsMonths: [1, 3, 6],
    quota: {
      maxDataSources: 5,
      maxDatasets: 100,
      maxDailyLlmCalls: 1000,
    },
    monthlyAiCreditYuan: 100,
    features: [
      '5 个数据源 / 100 个数据集',
      '每天 1000 次 AI 调用',
      '每月 100 元 AI 余额',
      '邮件 + 工单技术支持（48h 响应）',
      'BFF / Custom SQL / 页面构建器',
    ],
  },
  {
    code: 'pro_yearly',
    edition: 'PRO',
    displayName: 'PRO · 年付',
    tagline: '比月付立省两成',
    priceYuanPerMonth: 700, // 880 × 0.8 ≈ 700
    durationsMonths: [12, 24],
    quota: {
      maxDataSources: 5,
      maxDatasets: 100,
      maxDailyLlmCalls: 1000,
    },
    monthlyAiCreditYuan: 120,
    features: [
      '同 PRO 月付的全部功能',
      '每月 120 元 AI 余额（比月付多 20%）',
      '年付价 ¥700/月 (折扣 20%)',
      '专属客户成功对接',
    ],
  },
  {
    code: 'enterprise_yearly',
    edition: 'ENTERPRISE',
    displayName: '企业版 · 年付',
    tagline: '不限规模 + 私有化部署可选',
    priceYuanPerMonth: 2800,
    durationsMonths: [12, 24, 36],
    quota: {
      maxDataSources: null,
      maxDatasets: null,
      maxDailyLlmCalls: null,
    },
    monthlyAiCreditYuan: 1000,
    features: [
      '不限数据源 / 数据集 / AI 调用',
      '每月 1000 元 AI 余额',
      'SSO / 审计日志导出 / 私有 LLM 接入',
      '7×24 SLA 支持 + 季度健康检查',
      '可选私有化部署（额外报价）',
    ],
  },
];

export function findPlan(code: string): Plan | null {
  return PLANS.find((p) => p.code === code) ?? null;
}

/** 给定 plan + 时长 → 总价（元）。 */
export function totalPriceYuan(plan: Plan, durationMonths: number): number {
  return plan.priceYuanPerMonth * durationMonths;
}
