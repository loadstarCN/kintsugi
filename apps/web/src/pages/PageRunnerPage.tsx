import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Form,
  Grid,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { message } from '../notify';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { hasGrant, useAuth } from '../auth';

interface PageDetail {
  id: string;
  appCode: string;
  name: string;
  type: string;
  routePath: string;
  configJson: unknown;
  status: string;
  sourceFiles: Record<string, string> | null;
  publishedVersion: number | null;
}

export function PageRunnerPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const canWrite = hasGrant(me, '*:page:write');
  const [page, setPage] = React.useState<PageDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);

  React.useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      // 安全：只接受当前 iframe 发来的消息。
      // srcdoc 同源 + sandbox 后 ev.origin 是 'null'；不能仅靠 origin 判断。
      // iframe.contentWindow 引用是浏览器层面的 window 实体，无法被外部窗口伪造。
      // 任何其它窗口（页面里另外开的弹窗 / 浏览器扩展 / 跨页打开的标签）发来的
      // postMessage 都会被这条 source 比对挡掉，避免被借父窗 token 越权调 /api。
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return;
      const data = ev.data as
        | { type?: string; error?: string; id?: string; method?: string; path?: string; body?: unknown }
        | undefined;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'kintsugi-subapp-error' && typeof data.error === 'string') {
        setRuntimeError(data.error);
        return;
      }
      if (data.type === 'kintsugi-subapp-ok') {
        setRuntimeError(null);
        return;
      }
      // RPC：iframe 内的 kintsugi.client.* 通过 postMessage 让父窗代发请求。
      // 父窗持有 token；iframe 永远拿不到。allowlist 限制 path 前缀，方法
      // 限制在子应用真正需要的几条上。
      if (data.type === 'k-rpc-call' && typeof data.id === 'string') {
        const reply = (payload: { ok: boolean; data?: unknown; error?: string }) => {
          (ev.source as Window | null)?.postMessage(
            { type: 'k-rpc-result', id: data.id, ...payload },
            '*',
          );
        };
        void (async () => {
          try {
            const method = String(data.method ?? 'GET').toUpperCase();
            const path = String(data.path ?? '');
            if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
              throw new Error(`method ${method} not allowed`);
            }
            // path 必须 / 开头；只放行子应用运行时实际用的几个前缀
            // （instant-api 模型操作 / custom-sql 执行 / bff 脚本执行）。
            // 任何其他路径（auth / rbac / datasource / pages 自身 等管理类）
            // 一律拒绝 —— 防止恶意 LLM 代码通过 RPC 越权操作管理面。
            const apps = `/api/apps/${page?.appCode ?? '__none__'}/ds/`;
            const okPath =
              path.startsWith(apps) ||
              path.startsWith('/api/sql/') ||
              (path.startsWith('/api/bff/exec/') && page?.appCode &&
                path.startsWith(`/api/bff/exec/${page.appCode}/`));
            if (!okPath) throw new Error(`path ${path} not allowed for subapp RPC`);

            // 鉴权走父窗的 httpOnly cookie，浏览器自动带；iframe 拿不到 token 字面量。
            const init: RequestInit = {
              method,
              headers: {
                'content-type': 'application/json',
                accept: 'application/json',
              },
            };
            if (data.body !== undefined && method !== 'GET') {
              init.body = JSON.stringify(data.body);
            }
            const r = await fetch(path, init);
            const text = await r.text();
            const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
            if (!r.ok) {
              const msg =
                typeof json === 'object' && json !== null && 'message' in (json as Record<string, unknown>)
                  ? String((json as { message: unknown }).message)
                  : `HTTP ${r.status}`;
              reply({ ok: false, error: msg });
            } else {
              reply({ ok: true, data: json });
            }
          } catch (err) {
            reply({ ok: false, error: (err as Error).message });
          }
        })();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [page?.appCode]);

  const load = React.useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.get<PageDetail>(`/pages/${id}`);
      setPage(d);
      setCode(d.sourceFiles?.['src/app/index.jsx'] ?? '');
      setDirty(false);
      setError(null);
    } catch (err) {
       
      console.error('[PageRunner] load failed', err);
      setError((err as Error).message);
    }
  }, [id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!page) return;
    setSaving(true);
    try {
      await api.put(`/pages/${page.id}/source`, {
        sourceFiles: { 'src/app/index.jsx': code },
      });
      message.success('已保存');
      setDirty(false);
      await load();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!page) return;
    try {
      const r = await api.post<{ version: number }>(`/pages/${page.id}/publish`, {});
      message.success(`已发布 v${r.version}`);
      await load();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const [promptModalOpen, setPromptModalOpen] = React.useState(false);
  const [promptText, setPromptText] = React.useState('');
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [promptDatasets, setPromptDatasets] = React.useState<string[]>([]);
  const [datasetOptions, setDatasetOptions] = React.useState<
    Array<{ value: string; label: string }>
  >([]);

  const runRegenerate = React.useCallback(
    async (body?: { prompt?: string; datasetCodes?: string[] }) => {
      if (!page) return;
      setRegenerating(true);
      try {
        await api.post(`/pages/${page.id}/regenerate`, body ?? {});
        message.success('已按最新 prompt 规范重新生成源码');
        setPromptModalOpen(false);
        await load();
      } catch (err) {
        const e = err as { code?: string; message: string; status?: number };
        if (
          e.message?.includes('未保存原始 prompt') ||
          e.message?.includes('PROMPT_REQUIRED') ||
          e.status === 400
        ) {
          if (!datasetOptions.length && page.appCode) {
            try {
              const r = await api.get<{
                data: Array<{ datasetCode: string; tableName: string; alias: string }>;
              }>(`/datasets?appCode=${encodeURIComponent(page.appCode)}&pageSize=500`);
              setDatasetOptions(
                r.data.map((d) => ({
                  value: d.datasetCode,
                  label: `${d.alias || d.tableName} (${d.tableName})`,
                })),
              );
            } catch {
              /* ignore */
            }
          }
          setPromptModalOpen(true);
        } else {
          message.error(e.message);
        }
      } finally {
        setRegenerating(false);
      }
    },
    [page, datasetOptions.length, load],
  );

  const regenerate = () => void runRegenerate();

  if (error)
    return (
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Breadcrumb
          items={[
            { title: <Link to="/pages">页面</Link> },
            { title: id ?? 'unknown' },
          ]}
        />
        <Alert
          type="error"
          message="加载页面失败"
          description={
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{error}</pre>
          }
          showIcon
        />
        <Button onClick={() => void load()}>重试</Button>
      </Space>
    );
  if (!page) return <Spin tip="加载页面…"><div style={{ padding: 32 }} /></Spin>;

  // 注意：token 不进 iframe（iframe sandbox 已去掉 allow-same-origin，
  // 即使 LLM 输出 fetch(localStorage) 也读不到）。子应用所有请求都通过
  // postMessage RPC 让父窗代发。
  const runnerHtml = buildRunnerHtml({
    code,
    appCode: page.appCode,
  });

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Modal
        title="重新生成（旧版页面缺失 prompt，请补全）"
        open={promptModalOpen}
        onCancel={() => setPromptModalOpen(false)}
        confirmLoading={regenerating}
        okText="开始生成"
        onOk={() => {
          if (!promptText.trim()) {
            message.warning('请填写 prompt');
            return;
          }
          if (!promptDatasets.length) {
            message.warning('请至少选择 1 个数据集');
            return;
          }
          void runRegenerate({ prompt: promptText.trim(), datasetCodes: promptDatasets });
        }}
        width={isMobile ? '95vw' : 640}
      >
        <Form layout="vertical">
          <Form.Item label="原始描述（自然语言）">
            <Input.TextArea
              rows={5}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="例如：做一个商品列表页，可按名称搜索，可编辑商品的标价、上架状态。"
            />
          </Form.Item>
          <Form.Item label="使用哪些数据集">
            <Select
              mode="multiple"
              value={promptDatasets}
              onChange={setPromptDatasets}
              options={datasetOptions}
              placeholder="选择 1～10 个 dataset"
              showSearch
              optionFilterProp="label"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Breadcrumb
        items={[
          { title: <Link to="/pages">页面</Link> },
          { title: page.name },
        ]}
      />
      {runtimeError && (
        <Alert
          type="error"
          message="子应用运行时报错"
          description={
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{runtimeError}</pre>
          }
          showIcon
          closable
          onClose={() => setRuntimeError(null)}
        />
      )}
      <Card
        size="small"
        title={
          <Space wrap size={[8, 4]}>
            <Typography.Text strong>{page.name}</Typography.Text>
            <Tag color={page.status === 'published' ? 'green' : 'default'}>{page.status}</Tag>
            <Typography.Text code>{page.routePath}</Typography.Text>
            {page.publishedVersion != null && <Tag>v{page.publishedVersion}</Tag>}
          </Space>
        }
        extra={
          canWrite ? (
            <Space wrap size={[8, 4]}>
              <Button loading={regenerating} onClick={() => void regenerate()}>
                重新生成
              </Button>
              <Button loading={saving} disabled={!dirty} onClick={() => void save()}>
                保存源码
              </Button>
              <Button type="primary" onClick={() => void publish()}>
                发布
              </Button>
            </Space>
          ) : null
        }
      >
        <Tabs
          items={[
            {
              key: 'preview',
              label: '预览',
              children: (
                <iframe
                  ref={iframeRef}
                  srcDoc={runnerHtml}
                  title="React SubApp"
                  style={{
                    width: '100%',
                    height: '70vh',
                    border: '1px solid #eee',
                    borderRadius: 4,
                    background: '#fff',
                  }}
                  sandbox="allow-scripts allow-forms"
                />
              ),
            },
            {
              key: 'source',
              label: '源码',
              children: (
                <textarea
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setDirty(true);
                  }}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    minHeight: '60vh',
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 13,
                    padding: 12,
                    border: '1px solid #d9d9d9',
                    borderRadius: 4,
                    resize: 'vertical',
                  }}
                />
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}

/**
 * 把 React 子应用代码嵌进一个自包含 HTML，在 iframe 里运行。
 * 注入：React / ReactDOM / antd（CDN）+ window.kintsugi.client（postMessage → 父窗 → /api）。
 * 真沙箱 (qiankun/wujie) 下次做；iframe + srcDoc 已经能隔离 DOM/样式。
 */
function buildRunnerHtml(args: { code: string; appCode: string }): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Kintsugi SubApp</title>
<link rel="stylesheet" href="https://unpkg.com/antd@5.21.2/dist/reset.css" integrity="sha384-Rh5FRX7P6eIAOLQJXihyUaEa7SElWzcO7ZQk3pb6YhVJVfBq1m7QAZXxSy+lIAuJ" crossorigin="anonymous"/>
<style>
  /* ----- Kintsugi 锦缮 子应用统一主题（与宿主 apps/web 一致） ----- */
  :root {
    --k-ink: #0f172a;
    --k-ink-2: #1e293b;
    --k-paper: #fafaf7;
    --k-paper-warm: #f5f1e8;
    --k-rule: #e5e7eb;
    --k-muted: #64748b;
    --k-gold: #a07b3f;
    --k-gold-soft: #c8a96a;
  }
  html, body {
    background: var(--k-paper);
    color: var(--k-ink);
    font-family: "Iowan Old Style", "Garamond", "Songti SC", "Source Han Serif SC", serif;
  }
  body { margin: 0; padding: 16px; }
  code, pre, kbd, .ant-typography code {
    font-family: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace !important;
  }
  #root { min-height: 100px; }
  #err {
    color: #b91c1c; white-space: pre-wrap; padding: 12px;
    background: #fff; border: 1px solid var(--k-rule); border-left: 3px solid #b91c1c;
    border-radius: 4px; margin: 12px 0;
  }
  #err:empty { display: none; }

  /* —— 链接 / 文字按钮：金色 —— */
  .ant-btn-link, a { color: var(--k-gold) !important; }
  .ant-btn-link:hover, a:hover { color: #8a6932 !important; }

  /* —— 主按钮：墨色，hover 金色 —— */
  .ant-btn-primary {
    background: var(--k-ink) !important;
    border-color: var(--k-ink) !important;
    color: #fafaf7 !important;
  }
  .ant-btn-primary:hover, .ant-btn-primary:focus {
    background: var(--k-gold) !important;
    border-color: var(--k-gold) !important;
  }
  .ant-btn-primary:disabled {
    background: #cbd5e1 !important;
    border-color: #cbd5e1 !important;
    color: #fff !important;
  }

  /* —— Tag 杂蓝去掉 —— */
  .ant-tag-blue, .ant-tag-processing {
    background: var(--k-paper-warm) !important;
    color: var(--k-gold) !important;
    border-color: var(--k-rule) !important;
  }
  .ant-tag-success { background: #f0fdf4 !important; color: #15803d !important; border-color: #bbf7d0 !important; }
  .ant-tag-error   { background: #fef2f2 !important; color: #b91c1c !important; border-color: #fecaca !important; }
  .ant-tag-warning { background: #fffbeb !important; color: #b45309 !important; border-color: #fde68a !important; }

  /* —— Alert 信息条改杂志风：白底 + 左色条 —— */
  .ant-alert-info {
    background: #fff !important;
    border-color: var(--k-rule) !important;
    border-left: 3px solid var(--k-gold) !important;
  }
  .ant-alert-info .ant-alert-icon { color: var(--k-gold) !important; }

  /* —— Table / Pagination —— */
  .ant-table { background: #fff; border-radius: 8px; }
  .ant-table-thead > tr > th {
    background: var(--k-paper-warm) !important;
    color: var(--k-ink) !important;
    font-weight: 600;
    border-bottom: 1px solid var(--k-rule) !important;
  }
  .ant-pagination-item-active {
    background: var(--k-ink) !important;
    border-color: var(--k-ink) !important;
  }
  .ant-pagination-item-active a { color: #fff !important; }
  .ant-pagination-item:hover { border-color: var(--k-gold) !important; }
  .ant-pagination-item:hover a { color: var(--k-gold) !important; }

  /* —— Drawer 头部金色细线 —— */
  .ant-drawer-header { border-bottom: 1px solid var(--k-rule) !important; }
  .ant-drawer-title { font-weight: 600; }

  /* —— Card —— */
  .ant-card {
    border: 1px solid var(--k-rule) !important;
    border-radius: 8px !important;
    box-shadow: 0 1px 2px rgba(15,23,42,0.04);
  }
  .ant-card-head { border-bottom: 1px solid var(--k-rule) !important; }

  /* —— Form / Input / Select 统一内边距与圆角 —— */
  .ant-input, .ant-input-affix-wrapper, .ant-select-selector, .ant-input-number, .ant-picker {
    border-radius: 6px !important;
  }
</style>
</head>
<body>
<div id="root"></div>
<div id="err"></div>
<div id="loading" style="padding:12px;color:#94a3b8;font-family:ui-monospace,Menlo,monospace;font-size:12px;">
  正在加载运行时 (React · antd · Babel)…
</div>
<script>
  // 错误冒泡到父页面
  window.addEventListener('error', function (ev) {
    try { window.parent.postMessage({ type: 'kintsugi-subapp-error', error: (ev.error && ev.error.message) || ev.message }, '*'); } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (ev) {
    try { window.parent.postMessage({ type: 'kintsugi-subapp-error', error: (ev.reason && ev.reason.message) || String(ev.reason) }, '*'); } catch (_) {}
  });

  function setLoading(t) {
    var el = document.getElementById('loading');
    if (el) el.textContent = t;
  }
  function showError(t) {
    document.getElementById('err').textContent = '运行错误: ' + t;
    var l = document.getElementById('loading');
    if (l) l.remove();
    try { window.parent.postMessage({ type: 'kintsugi-subapp-error', error: t }, '*'); } catch (_) {}
  }

  // 链式顺序加载 CDN —— 浏览器不保证 document-order script 的 ready 顺序，
  // 尤其 type=text/babel 会异步编译；UMD 间也有依赖顺序（antd 依赖 React / dayjs）。
  // 所以一张链子挨个 onload。
  //
  // SRI integrity：每个 URL 锁定 sha384，unpkg 被入侵换文件时浏览器拒绝执行。
  // 升级 CDN 版本 = 改 url + 重算 hash（Bash: openssl dgst -sha384 -binary | openssl base64 -A）。
  var SCRIPTS = [
    { url: 'https://unpkg.com/react@18.3.1/umd/react.development.js', name: 'React',
      sri: 'sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L' },
    { url: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js', name: 'ReactDOM',
      sri: 'sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm' },
    { url: 'https://unpkg.com/dayjs@1.11.13/dayjs.min.js', name: 'dayjs',
      sri: 'sha384-DpVxUeeBWjUvUV1czyIHJAjh+jYUZFu2lLakbdua5vbwOrBGi1UgaKCHjTC+x3Ky' },
    { url: 'https://unpkg.com/antd@5.21.2/dist/antd.min.js', name: 'antd',
      sri: 'sha384-uogUVaDpDEBKyn+k/HlGkyqKHV5q9tiganG9JDzjdwzgleeDEWwaGjOzQfyFZMQo' },
    { url: 'https://unpkg.com/@babel/standalone@7.25.6/babel.min.js', name: 'Babel',
      sri: 'sha384-EIcs2MbARRLcLs7Gv2wqqhhfMlcLeW9yuJsWki1r5iveN1F5gpzHOwAKycJqSQOI' },
  ];
  function loadChain(i) {
    if (i >= SCRIPTS.length) return onAllLoaded();
    var s = SCRIPTS[i];
    setLoading('加载 ' + s.name + ' ('+(i+1)+'/'+SCRIPTS.length+')…');
    var tag = document.createElement('script');
    tag.src = s.url;
    tag.crossOrigin = 'anonymous';
    tag.integrity = s.sri;
    tag.onload = function () { loadChain(i + 1); };
    tag.onerror = function () {
      showError('无法加载 ' + s.name + ' (' + s.url + ')。检查网络 / CDN 连通；或 SRI 校验失败（CDN 文件被换）。');
    };
    document.head.appendChild(tag);
  }
  loadChain(0);

  function onAllLoaded() {
    // 双检查 globals
    if (!window.React || !window.ReactDOM) return showError('React 未就位');
    if (!window.antd) return showError('antd 未就位');
    if (!window.Babel) return showError('Babel 未就位');

    // 注入 Kintsugi client（apiBase / token 故意不暴露 —— 子应用没有直接 fetch 的能力）
    window.kintsugi = {
      appCode: ${JSON.stringify(args.appCode)},
      client: buildClient(${JSON.stringify(args.appCode)}),
    };

    // 移除"loading"占位
    var l = document.getElementById('loading');
    if (l) l.remove();

    // 编译并执行用户代码
    try {
      var src = USER_CODE;
      var compiled = window.Babel.transform(src, { presets: ['react'] }).code;
      // eslint-disable-next-line no-new-func
      new Function(compiled).call(window);
      var AppCmp = window.App;
      if (!AppCmp) throw new Error('子应用未暴露 window.App（默认导出 App 组件）');
      // —— 用 antd ConfigProvider 注入 Kintsugi 主题 token，子应用的 antd 组件继承 ——
      var KINTSUGI_THEME = {
        token: {
          colorPrimary: '#1677ff',
          colorLink: '#a07b3f',
          colorLinkHover: '#8a6932',
          colorText: '#0f172a',
          colorBorder: '#e5e7eb',
          colorBgContainer: '#ffffff',
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", "Songti SC", sans-serif',
        },
        components: {
          Button: { borderRadius: 6, controlHeight: 34 },
          Input: { borderRadius: 6, controlHeight: 34 },
          Select: { borderRadius: 6, controlHeight: 34 },
          Table: { headerBg: '#f5f1e8', headerColor: '#0f172a', borderColor: '#e5e7eb' },
          Drawer: { paddingLG: 20 },
          Tag: { defaultBg: '#f5f1e8', defaultColor: '#a07b3f' },
        },
      };
      var Provider = window.antd.ConfigProvider;
      var root = window.ReactDOM.createRoot(document.getElementById('root'));
      root.render(
        window.React.createElement(
          Provider,
          { theme: KINTSUGI_THEME, componentSize: 'middle' },
          window.React.createElement(AppCmp),
        ),
      );
      try { window.parent.postMessage({ type: 'kintsugi-subapp-ok' }, '*'); } catch (_) {}
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
    }
  }

  // 用户代码作为字符串嵌入，避开模板字面量冲突
  var USER_CODE = ${JSON.stringify(args.code)};

  function buildClient(appCode) {
    // RPC：所有请求都让父窗代发。token 永远不在 iframe 里。
    var nextId = 0;
    var pending = new Map();
    window.addEventListener('message', function (ev) {
      var data = ev.data;
      if (!data || data.type !== 'k-rpc-result' || typeof data.id !== 'string') return;
      var h = pending.get(data.id);
      if (!h) return;
      pending.delete(data.id);
      if (data.ok) h.resolve(data.data);
      else h.reject(new Error(data.error || 'RPC failed'));
    });
    function request(method, path, body) {
      return new Promise(function (resolve, reject) {
        var id = String(++nextId) + '-' + Date.now();
        pending.set(id, { resolve: resolve, reject: reject });
        try {
          window.parent.postMessage(
            { type: 'k-rpc-call', id: id, method: method, path: path, body: body },
            '*'
          );
        } catch (e) {
          pending.delete(id);
          reject(e);
          return;
        }
        // 60s 兜底，防止父窗丢消息时 promise 永远 pending
        setTimeout(function () {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('RPC timeout: ' + method + ' ' + path));
          }
        }, 60000);
      });
    }

    // 兼容 LLM 偶尔生成的 \`where: [{ type: { eq: 'x' } }]\` 形态，转成 [{field,op,value}]
    function normalizeFilterBody(body) {
      if (!body || !Array.isArray(body.where)) return body || {};
      var w = [];
      body.where.forEach(function (clause) {
        if (clause && typeof clause === 'object' && 'field' in clause && 'op' in clause) {
          w.push(clause);
          return;
        }
        if (clause && typeof clause === 'object') {
          Object.keys(clause).forEach(function (field) {
            var ops = clause[field];
            if (ops && typeof ops === 'object') {
              Object.keys(ops).forEach(function (op) {
                w.push({ field: field, op: op, value: ops[op] });
              });
            } else {
              w.push({ field: field, op: 'eq', value: ops });
            }
          });
        }
      });
      return Object.assign({}, body, { where: w });
    }

    async function filter(base, body) {
      var r = await request('POST', base + '/filter', normalizeFilterBody(body));
      // 同时暴露 list 别名（兼容 LLM 生成代码 \`res.list\`）
      return Object.assign({}, r, { list: r.data, items: r.data });
    }

    return {
      appCode,
      models: new Proxy({}, {
        get: (_t, key) => {
          if (typeof key !== 'string') return undefined;
          var base = '/api/apps/' + appCode + '/ds/' + key;
          return {
            filter: function (body) { return filter(base, body); },
            getOne: function (id) { return request('GET', base + '/' + encodeURIComponent(String(id))); },
            create: function (data) { return request('POST', base, data); },
            update: function (id, data) { return request('PATCH', base + '/' + encodeURIComponent(String(id)), data); },
            delete: function (id) { return request('DELETE', base + '/' + encodeURIComponent(String(id))); },
            batchCreate: function (rows) { return request('POST', base + '/batchCreate', { rows: rows }); },
            aggregate: function (body) { return request('POST', base + '/aggregate', body); },
            getSelectOptions: function (field) { return request('GET', base + '/options/' + encodeURIComponent(field)); },
          };
        },
      }),
      sql: {
        execute: function (sqlCode, params) {
          return request('POST', '/api/sql/' + sqlCode + '/execute', { params: params || {}, actor: 'human', sqlSafe: true });
        },
      },
    };
  }
</script>
</body>
</html>`;
}
