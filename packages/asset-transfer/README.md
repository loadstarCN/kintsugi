# @kintsugi/asset-transfer ⏸️ v2

资产导入/导出 + 版本管理 + 灰度。

## 目标

把一个 app 的资产打成一个 bundle：

```
export/
  app.json           # appCode, name, env, metadata
  datasets.json      # 所有 Dataset + DO JSON
  pages.json         # Page + ReactSubApp sourceFiles
  menus.json
  bff/<name>.js
  sql/<name>.sql
  roles.json
```

能 `import` 到另一个 app（跨环境迁移：dev → daily → prod），带冲突处理。

## 起点 API

- `POST /api/apps/:appCode/export` → 返回 zip
- `POST /api/apps/:appCode/import` （multipart：zip）
- `GET /api/apps/:appCode/diff/:otherAppCode`

## 版本化

- 每次 import 在资产上贴 `bundleVersion` 标签；
- 支持 dry-run（只显示会改什么）+ 回滚（保留上一版本的 bundle）。
