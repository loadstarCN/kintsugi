# Text-to-Page 提示词

LLM 根据你的 prompt + DO 信息产出**完整的 React 子应用源码**。这一篇讲怎么写 prompt 让它产出的代码可用率更高。

## API

```bash
POST /api/apps/:appCode/pages/generate
```

```json
{
  "prompt": "做一个商品列表页，能按 type 筛选、按价格倒序",
  "datasetCodes": ["ds-xxx", "ds-yyy"],
  "name": "商品管理", // 可选；默认从 prompt slugify
  "routePath": "/goods", // 可选；默认 /ai/<slug>-<timestamp>
  "imageUrls": ["https://..."] // 可选；vision 模型才能消费
}
```

返回：

```json
{
  "pageId": "...",
  "description": "商品列表 + 筛选 + 排序",
  "files": {
    "src/app/index.jsx": "...",
    "src/app/styles.css": "..."
  }
}
```

## 提示词写法：5 条经验

### 1. 描述要做什么，不描述怎么做

❌ "用 antd 的 Table 组件，列宽 200px，分页 20 一页..."
✓ "做一个商品列表，能筛选 / 排序 / 分页，操作列有编辑和删除"

LLM 知道 antd / Material UI 的常用模式，自己挑组件比你指挥它更靠谱。

### 2. 字段名用中文也行

DO 已经填了 `businessName`：

```
prompt: "用商品名称、单价、上架时间这几列；筛选支持按类目"
```

LLM 会自动把"商品名称"映射到 `name` 列。

### 3. 用截图替代千言

```json
{
  "prompt": "按截图实现",
  "imageUrls": ["data:image/png;base64,iVBORw0KGgo..."]
}
```

要求：

- LLM_MODEL 必须是 vision 模型（DeepSeek-VL / GPT-4o / Qwen-VL / Claude Sonnet 4）
- 图片建议 PNG / JPEG，长边 ≤ 1280px（更大也行但费 token）
- 多图按视觉顺序传

### 4. 一次只让它做一个页面

❌ "做商品管理 + 订单管理 + 用户管理三个页面"
✓ 调三次接口，每次一个 prompt

LLM 在单页面任务上质量明显更高。多页面会把 token 用在 boilerplate 上。

### 5. 复用：让它继承现有页面

如果已经有商品列表页，prompt 里写：

```
"参考已有的商品列表页（pageId=xxx），做一个相同样式的订单列表"
```

server 会把那个页面的源码摘取放进 prompt 上下文。

## 选 datasetCodes 的策略

| 情况                         | 怎么传                              |
| ---------------------------- | ----------------------------------- |
| 单 dataset 列表 / 表单       | 传一个                              |
| 主从表（订单 + 订单项）      | 两个都传，prompt 写"主从结构"       |
| 字段太多 / 多 dataset 没必要 | 仍然只传相关的；DO 越多 prompt 越大 |

不传 `datasetCodes` → server 取该 application 下前 10 张 dataset，靠 LLM 自己挑——一般不准。

## 生成后改源码

`http://localhost:5173/pages/<pageId>` 双 tab：

- 左：iframe 预览（Babel-standalone 即时编译）
- 右：源码编辑器（Monaco）

改完保存（`PUT /api/pages/:id/source`），预览实时刷新。

满意了发布（`POST /api/pages/:id/publish`），生成 `publishedVersion`。

## 用 RPC 调业务

生成的代码里能用 `window.kintsugi.client`：

```jsx
const { models } = window.kintsugi.client;
const r = await models.goods.filter({ where: [...] });
```

token 不进 iframe（父窗 cookie 自动跟，子应用拿不到 token 字面量），所有调用都过父窗代理 + allowlist。

## 重新生成

```bash
POST /api/pages/:pageId/regenerate
```

不传参 → 用原始 prompt 重跑（适合 prompt 规范升级后批量回刷）。
传 `prompt` / `datasetCodes` → override。

::: tip 第一版 prompt 没保存的页面
旧版本生成的 page 没存 prompt，regenerate 时必须显式传 `prompt` + `datasetCodes`，否则报 `PROMPT_REQUIRED`。
:::

## 限制

- LLM 最长 180s 超时
- 单文件最大 ~50KB（再大 LLM 上下文撑不住）
- 不能产 native 模块依赖（npm 包不可用）；可用：React 18 + antd + dayjs + axios + echarts-for-react
- 路由是 hash 形式（iframe 限制）
- 没 SSR

## 排障

| 错误                                     | 含义                                              |
| ---------------------------------------- | ------------------------------------------------- |
| `LLM_UPSTREAM_ERROR: empty LLM response` | LLM 返回空内容；通常是 quota 用完                 |
| `LLM did not produce src/app/index.jsx`  | LLM 输出格式不对——重试 / 换 prompt                |
| `LLM non-JSON`                           | LLM 没用 json mode，看 server 日志 raw 字段 debug |
| 预览白屏                                 | Babel 编译失败；F12 看子 iframe console           |
