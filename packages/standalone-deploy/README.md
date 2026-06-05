# @kintsugi/standalone-deploy ⏸️ v2（企业版）

独立部署形态：把 Kintsugi 作为一个 Spring Boot 二方包 + 前端 assets 打包交付客户，跑在客户内网。

## 工期估算

整个 Java 栈至少 2-3 个月：

- Maven 子包结构（core / spring5-adapter / spring6-adapter / demo-jdk21）
- Java SDK（对齐 TS SDK 的 client.models.\*.filter 等接口）
- `IScriptExtension` 接口定义
- Helm chart / Docker Compose
- 建表 SQL 脚本生成器（从 Prisma schema 反向生成）
- 客户侧 application.yml 契约
- 升级策略（页面/菜单导出 + 二方包版本 bump）

## 现状可复用

- 后端是 NestJS，完全可以作为独立部署的"控制面"；业务数据库是客户自带的；
- 如果只做 Node.js 独立部署版本（Docker），会更简单：打一个 docker-compose.yaml + 一键安装脚本。

## 短期实际能做（1 天 < 1 人）

- `scripts/standalone/install.sh`：在一台干净机器上 `docker-compose up` 起 Kintsugi（server + web + 迁移脚本）；
- `standalone.Dockerfile`：多阶段构建出 single-image server + web nginx。
