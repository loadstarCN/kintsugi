# @kintsugi/report ⏸️ v2

AI 报表：给一句自然语言「近 30 天销售总额按门店」，返回可视化 + 洞察。

## 流程

1. LLM 解析问题 → 选出 aggregate 配置 `{groupBy, metrics, where, limit}`；
2. 调 InstantApi aggregate → 拿结果；
3. LLM 根据结果形态选图（bar / line / pie / funnel）+ 生成洞察文字；
4. 前端用 vchart / echarts 画。

## 起点

- 端点 `POST /api/apps/:appCode/reports/ask`
- 复用现成 `ChatsService.ask`，增加 "output mode = chart"；
- prompt 多一步：产出的 JSON 带 `chart: { type, xField, yField, seriesField }`。
