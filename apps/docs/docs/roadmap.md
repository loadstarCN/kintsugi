# Roadmap

完整版见仓库根 [`ROADMAP.md`](https://github.com/LoadstarCN/kintsugi/blob/main/ROADMAP.md)。

## 短期（本月）

- [ ] 可视化页面编辑器 MVP（筛选器 + 表单 + 表格）
- [ ] OpenAPI → TS SDK 自动生成（替代手写 SDK 类型）
- [ ] DBAgent eval fixture 扩到 20+ 覆盖更多脏库 case
- [ ] BFF runtime SET LOCAL 已完成 ✓

## 中期（季度）

- [ ] qiankun/wujie 替代 iframe 子应用宿主（如果产品需要多子应用同屏）
- [ ] mssql / oracle / sqlite 方言适配
- [ ] 真 PG RLS 端到端集成（emitter + GUC + 后台触发器）
- [ ] 移动端 SDK 发布到 CocoaPods + Maven Central
- [x] AccessKey 路径注入 tenantCode GUC（已完成；user-level binding 仍 TODO）

## 长期（年度）

- [ ] 独立部署 Spring Boot 二方包（Java 栈客户）
- [ ] 文档站完整覆盖（reference + tutorials + migration）
- [ ] 多模态 Text-to-Page（截图 + 白板 + Excel + 原型图）

## 已交付

见 [更新日志](./changelog)。
