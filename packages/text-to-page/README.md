# @kintsugi/text-to-page ⏸️ v2

Text-to-Page / Multimodal 页面生成器。

## 目标

输入：自然语言描述 + 可选截图/白板/Excel/原型图 + 当前应用的 Dataset 列表。
输出：一个完整的 React 子应用工程（`src/app/index.jsx` + 组件 + hooks 用法），按 DO JSON 自动绑定 InstantAPI。

## 为什么今天不做

这是 M3 的一整条代码生成 pipeline：

- prompt 工程化（分步：页面结构 → 数据绑定 → 交互 → 样式）；
- LLM 产物一定有错（类型/依赖/语法），需要真实 dev server + vite build 试跑 + 反馈回环；
- 多模态输入：截图 OCR + 视觉理解（Claude 3.5 vision 或 Qwen-VL）。

## 最小可继续的起点

- `packages/text-to-page/src/index.ts` 导出 `generatePage(opts): Promise<GeneratedBundle>`：
  - 输入：`{ appCode, prompt, attachments?, datasetCodes }`
  - 输出：`{ files: Record<string,string>, previewUrl?, tokens: number }`
- 先用纯文本 prompt 产出单文件 React 组件（`src/app/index.jsx`），不搞子文件树。
- 挂到 `/api/apps/:appCode/pages/generate` endpoint，写入 `Page` + `ReactSubApp` 表。

## 先读的资料

- `docs/04_React自定义页面生成.txt`
- Ant Design Pro / Arco 的 schema-driven 表单、表格 API。
