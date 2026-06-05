import * as React from 'react';

/**
 * 系统内嵌帮助中心的内容索引。
 *
 * 维护规则：
 *  - 所有 doc 都是 React Fragment / JSX，不引入 markdown 渲染依赖
 *  - 标题、章节、正文、code block 由 HelpPage.tsx 里的 .kintsugi-help-article 样式接管
 *  - 截图位先用 <p> 占位，UI 路径写"侧边栏 → X → Y"形式
 *  - SDK 教程：TS / iOS / Android 是已上线 SDK，写真用法；Python / Go / Java 写"即将上线"
 *    + 一段未来 API 形态的伪代码（让等待的客户先看看会是什么样子）
 */

export type HelpSlug =
  | 'index'
  // 操作说明
  | 'manual-roles'
  | 'manual-login'
  | 'manual-applications'
  | 'manual-datasources'
  | 'manual-datasets'
  | 'manual-er'
  | 'manual-sql'
  | 'manual-bff'
  | 'manual-pages'
  | 'manual-chats'
  | 'manual-reports'
  | 'manual-access-keys'
  | 'manual-webhooks'
  | 'manual-integrations'
  | 'manual-transfer'
  | 'manual-audit'
  // SDK 教程
  | 'sdk-typescript'
  | 'sdk-ios'
  | 'sdk-android'
  | 'sdk-python'
  | 'sdk-go'
  | 'sdk-java';

export interface HelpSection {
  group: string;
  items: Array<{ slug: HelpSlug; label: string }>;
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    group: '总览',
    items: [{ slug: 'index', label: '帮助首页' }],
  },
  {
    group: '操作说明',
    items: [
      { slug: 'manual-roles', label: '角色与权限' },
      { slug: 'manual-login', label: '登录与账号' },
      { slug: 'manual-applications', label: '应用 (Application)' },
      { slug: 'manual-datasources', label: '数据源 / 扫描' },
      { slug: 'manual-datasets', label: '数据集 / DO' },
      { slug: 'manual-er', label: 'ER 图' },
      { slug: 'manual-sql', label: 'Custom SQL' },
      { slug: 'manual-bff', label: 'BFF 脚本' },
      { slug: 'manual-pages', label: '自定义页面' },
      { slug: 'manual-chats', label: 'AI 问数 (Chats)' },
      { slug: 'manual-reports', label: 'AI 报表' },
      { slug: 'manual-access-keys', label: 'Access Key' },
      { slug: 'manual-webhooks', label: 'Webhooks' },
      { slug: 'manual-integrations', label: 'IM 集成' },
      { slug: 'manual-transfer', label: '资产导入导出' },
      { slug: 'manual-audit', label: '审计日志' },
    ],
  },
  {
    group: 'SDK 教程',
    items: [
      { slug: 'sdk-typescript', label: 'TypeScript / Node' },
      { slug: 'sdk-ios', label: 'iOS (Swift)' },
      { slug: 'sdk-android', label: 'Android (Kotlin)' },
      { slug: 'sdk-python', label: 'Python' },
      { slug: 'sdk-go', label: 'Go' },
      { slug: 'sdk-java', label: 'Java' },
    ],
  },
];

// ---------- 操作说明 ----------

const indexArticle = (
  <>
    <h1>帮助中心</h1>
    <p>
      欢迎使用 Kintsugi 锦缮平台。这里集中收录平台所有功能的操作说明 +
      官方 SDK 集成教程，凡是登录用户都能看到。
    </p>
    <h2>怎么用这份文档</h2>
    <ul>
      <li>
        <strong>不熟悉哪一块就翻"操作说明"</strong>—— 按平台左侧导航顺序排列，
        每篇都说明"该功能是做什么的、UI 路径在哪、典型操作步骤、注意事项"。
      </li>
      <li>
        <strong>要把数据接出去就翻"SDK 教程"</strong>—— TS / iOS /
        Android 已可用；Python / Go / Java 即将上线（占位文档先就位，方便提前评估）。
      </li>
    </ul>
    <h2>找不到想要的？</h2>
    <p>
      平台的 OpenAPI 契约在 <code>/api/openapi.platform.json</code>；
      每个 app 自己的 Instant API 文档在 <code>/api/apps/&#123;appCode&#125;/docs</code>（Swagger UI）。
      还是搞不定就联系平台管理员。
    </p>
  </>
);

const manualRoles = (
  <>
    <h1>角色与权限</h1>
    <p>
      Kintsugi 用极简 RBAC：每个用户挂若干 <strong>Role</strong>，每个 Role 持一组
      <strong>grant</strong>，grant 形如 <code>&lt;app|*&gt;:&lt;resource&gt;:&lt;action&gt;</code>，
      支持任意一段写 <code>*</code> 当通配符。后端 <code>PermissionGuard</code> 鉴权，前端按相同规则
      隐藏没权限的菜单 / 按钮。
    </p>
    <h2>两个层级：平台级 vs 租户级</h2>
    <p>
      Kintsugi 是多租户平台。<strong>平台级</strong>角色管"跨租户"的事（审批别家公司新建租户的
      试用申请、计费升级等），<strong>租户级</strong>角色只在自己租户内有权——再"超级"的
      tenant-admin 也不能去审批别家的 trial。
    </p>
    <h2>预置角色（bootstrap-demo 自动建）</h2>
    <p style={{ fontSize: 12, color: '#888' }}>
      平台级角色（含 <code>*:admin:*</code>）<strong>不</strong>预置在普通租户里——
      Kintsugi 的 Role 表必须挂某个 tenantCode，把它实例化进 demo 租户等于让租户管理员
      看见一个含跨租户权限的角色，曝露本身就是设计味道。需要平台运营时由平台方
      在专属租户里手工建（grants <code>*:*:*</code>）。
    </p>
    <table>
      <thead>
        <tr>
          <th>角色</th>
          <th>层级</th>
          <th>定位</th>
          <th>grants</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>tenant-admin</code></td>
          <td>租户</td>
          <td>本租户超管，能管自己租户的所有资源（含 webhook / 审计 / RBAC / 资产导入导出），但<strong>不能</strong>审批别家 trial。bootstrap 默认绑给 alice。</td>
          <td>
            <code>*:application:write</code>，<code>*:datasource:write</code>，
            <code>*:dataset:read/write</code>，<code>*:page:write</code>，
            <code>*:sql:write/exec</code>，<code>*:bff:write/exec</code>，
            <code>*:asset:read/write</code>，<code>*:audit:read</code>，
            <code>*:webhook:read/write</code>，<code>*:accessKey:read/write</code>，
            <code>*:rbac:read/write</code>
          </td>
        </tr>
        <tr>
          <td><code>developer</code></td>
          <td>租户</td>
          <td>建模 / 扩展开发</td>
          <td>
            <code>*:datasource:write</code>，<code>*:dataset:write</code>，
            <code>*:page:write</code>，<code>*:sql:write/exec</code>，
            <code>*:bff:write/exec</code>，<code>*:accessKey:read/write</code>
          </td>
        </tr>
        <tr>
          <td><code>operator</code></td>
          <td>租户</td>
          <td>运维 / 审计</td>
          <td>
            <code>*:asset:read/write</code>，<code>*:audit:read</code>，
            <code>*:webhook:read/write</code>，<code>*:accessKey:read</code>
          </td>
        </tr>
        <tr>
          <td><em>viewer</em>（默认登录用户，无需建 Role）</td>
          <td>租户</td>
          <td>仅读、用消费层</td>
          <td>无</td>
        </tr>
      </tbody>
    </table>
    <h2>各功能适用角色（按侧边栏顺序）</h2>
    <table>
      <thead>
        <tr>
          <th>功能</th>
          <th>看（list / detail）</th>
          <th>写 / 危险操作</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>首页 · 应用列表</td>
          <td>所有登录用户</td>
          <td>tenant-admin（新建应用需 *:application:write；目前没专门 UI，走 API）</td>
        </tr>
        <tr>
          <td>角色 / 权限（管理组）</td>
          <td>tenant-admin（需 *:rbac:read）</td>
          <td>tenant-admin（建角色 / 绑用户 / 解绑，需 *:rbac:write）</td>
        </tr>
        <tr>
          <td>数据源 / 扫描</td>
          <td>所有登录用户</td>
          <td>tenant-admin · developer（新建 / 编辑 / 测试 / 触发扫描 / 删除）</td>
        </tr>
        <tr>
          <td>数据集 / DO</td>
          <td>所有登录用户</td>
          <td>tenant-admin · developer（编辑业务名 / 字段角色 / 保存 DO）</td>
        </tr>
        <tr>
          <td>ER 图</td>
          <td>所有登录用户（只读图）</td>
          <td>—</td>
        </tr>
        <tr>
          <td>页面（自定义页 / AI 生成）</td>
          <td>所有登录用户（可访问已发布页）</td>
          <td>tenant-admin · developer（AI 生成 / 重新生成 / 保存源码 / 发布）</td>
        </tr>
        <tr>
          <td>问数 / AI 报表</td>
          <td>所有登录用户</td>
          <td>—（只读消费）</td>
        </tr>
        <tr>
          <td>数据浏览（Instant API CRUD）</td>
          <td>所有登录用户</td>
          <td>所有登录用户（最终由 ABAC + RLS / dataRule 控制行级权限）</td>
        </tr>
        <tr>
          <td>Custom SQL</td>
          <td>所有登录用户（看列表）</td>
          <td>
            tenant-admin · developer：write = 新建 / 编辑 / 删除；
            exec = 执行
          </td>
        </tr>
        <tr>
          <td>BFF 脚本</td>
          <td>所有登录用户（看列表）</td>
          <td>
            tenant-admin · developer：write = 新建 / 编辑 / 删除；
            exec = 执行
          </td>
        </tr>
        <tr>
          <td>资产导入导出</td>
          <td>tenant-admin · operator（导出 zip）</td>
          <td>tenant-admin · operator（导入覆盖）</td>
        </tr>
        <tr>
          <td>集成 / SDK · OpenAPI 文档</td>
          <td>所有登录用户</td>
          <td>—</td>
        </tr>
        <tr>
          <td>Webhooks</td>
          <td>tenant-admin · operator</td>
          <td>tenant-admin · operator（新建 / 启用切换 / 删除）</td>
        </tr>
        <tr>
          <td>审计日志</td>
          <td>tenant-admin · operator</td>
          <td>—（只读）</td>
        </tr>
        <tr>
          <td>试用申请审批（<strong>平台级</strong>）</td>
          <td>platform-admin（需 *:admin:read）</td>
          <td>platform-admin（通过 / 拒绝，需 *:admin:write）。tenant-admin <strong>不</strong>包含此 grant。</td>
        </tr>
        <tr>
          <td>健康检查</td>
          <td>所有登录用户</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>
    <h2>等级与"不可越权授权"原则</h2>
    <p>
      Kintsugi 在 RBAC 上执行 <strong>privilege attenuation</strong>：建角色或给用户绑角色时，
      <strong>caller 自己手上的 grants 必须能覆盖请求里的每一条 grant</strong>。否则后端直接 403。
    </p>
    <ul>
      <li>
        tenant-admin（无 <code>*:admin:*</code>）<strong>不能</strong>建一个含 <code>*:admin:write</code>
        的角色，更不能把 platform-admin 角色绑给任何人 —— 否则就等于自我提权。
      </li>
      <li>
        platform-admin（持 <code>*:*:*</code>）能建任何 grant 组合的角色，能绑任何角色给任何人。
      </li>
      <li>
        UI 里 grants 选择器和角色选择器都按这条规则过滤；后端 <code>assertCanGrantAll</code> 兜底。
      </li>
    </ul>
    <h2>怎么给用户加角色</h2>
    <p>当前没有 RBAC 管理 UI，临时通过两种方式：</p>
    <ol>
      <li>
        <strong>SQL 直改</strong>：往 <code>"UserRole"(userId, roleId)</code> 插一行。
        Role 可以走 <code>POST /api/rbac/roles</code> 接口建（持 <code>*:rbac:write</code> 才能调，
        通常 tenant-admin）。
      </li>
      <li>
        <strong>bootstrap-demo</strong>：演示用的 demo 租户，跑
        <code>pnpm --filter @kintsugi/server bootstrap:demo</code> 会一键建出
        tenant-admin / developer / operator 三个角色，并把 alice 绑成 tenant-admin。
      </li>
    </ol>
    <h2>前端 vs 后端的鉴权关系</h2>
    <ul>
      <li>
        <strong>后端</strong> 是真正的安全边界。<code>@Permission('resource:action')</code>
        装饰在每个写接口上；缺 grant → 直接 403，message 形如
        <code>missing permission: &lt;app&gt;:resource:action</code>。
      </li>
      <li>
        <strong>前端</strong> 只用 <code>hasGrant(me, key)</code>（与后端通配符规则一致）
        决定按钮 / 菜单是否露出，避免用户点了之后被 403。这是 UX 提示，<strong>不</strong>是
        安全边界 —— 别在前端 grant check 里塞业务规则。
      </li>
    </ul>
    <h2>常见排错</h2>
    <ul>
      <li>
        点按钮报"missing permission: &lt;any&gt;:resource:action" → 当前账号缺该 grant，
        让 tenant-admin 给你绑 developer / operator 角色。
      </li>
      <li>
        看到"只读模式"提示 → 同上，缺 write grant；可以浏览但不能保存。
      </li>
      <li>
        新装的环境只有 alice，又拿不到密码 → 跑 <code>pnpm --filter @kintsugi/server bootstrap:demo</code>
        看终端打印的 "default password = ..."（仅在 alice 不存在时打）；alice 已存在则
        密码不会被覆盖，找平台方拿。
      </li>
    </ul>
  </>
);

const manualLogin = (
  <>
    <h1>登录与账号</h1>
    <p>
      Kintsugi 是商业平台，不开放公开注册。账号有两条路径：
      平台方直建（联系商务），或在 <code>/apply</code> 提交试用申请等审批。
    </p>
    <h2>登录</h2>
    <ol>
      <li>进入 <code>/login</code>，填租户编码（tenantCode）、用户名、密码。</li>
      <li>提交后服务端发 JWT，存进 <code>kintsugi_session</code> cookie（HttpOnly + 7 天有效）。</li>
      <li>登录后默认跳到 <strong>首页</strong>；点右上角头像可以登出 / 切换租户。</li>
    </ol>
    <h2>失败锁定</h2>
    <p>
      连续 5 次密码错误（默认 15 分钟窗口）→ 账号锁定 15 分钟。期间正确密码也拒。
      平台后台不给重置入口，只能等过期或联系平台方。这是反暴破策略，不可关。
    </p>
    <h2>试用账户</h2>
    <ul>
      <li>有效期 14 天（默认），到期后再登录会被拒，提示去续费 / 升级 PRO。</li>
      <li>额度上限：1 个数据源、3 个数据集、每天 50 次 LLM 调用、5 元 AI 余额。</li>
      <li>到期后数据不删，升级到 PRO 后所有资产无缝继续可用。</li>
    </ul>
    <h2>Token 撤销</h2>
    <p>
      登出操作会把当前 token 的 jti 加进黑名单，即使 token 还没到 7 天有效期，
      旧 token 也立即失效。这条对"端泄密 + 紧急下线"有用。
    </p>
  </>
);

const manualApplications = (
  <>
    <h1>应用 (Application)</h1>
    <p>
      <strong>应用</strong>是 Kintsugi 的顶层组织单位。一个租户可以有多个应用
      （生产 / 灰度 / 开发各一），每个应用承载若干数据集 + 页面 + BFF + SQL。
      Access Key、Webhook 订阅都挂在应用上。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 首页（应用列表）</p>
    <h2>新建应用</h2>
    <p>
      目前没有专门的"新建应用"页面。需持 <code>*:application:write</code>（默认 tenant-admin 持有）
      的账号通过 API 调用：
    </p>
    <pre><code>{`curl -X POST https://your-host/api/applications \\
  -H "Content-Type: application/json" \\
  -b kintsugi_session=... \\
  -d '{"appCode":"app-foo","name":"Foo App","environment":"development"}'`}</code></pre>
    <p>
      <code>appCode</code> 短英文 + 全平台唯一；<code>environment</code> 在
      production / daily / development 三选一。后续会补一个简单的"新建应用"对话框。
    </p>
    <h2>environment 字段的语义</h2>
    <ul>
      <li><code>production</code>：正式生产环境，谨慎写。</li>
      <li><code>daily</code>：日常 / 测试环境，可以多刷数据。</li>
      <li><code>development</code>：本地 / 开发，跨服务集成时区分用。</li>
    </ul>
    <p>
      字段只是元数据，不强制行为；用来给你 / 监控系统 / 集成环境一个明确语义。
    </p>
    <h2>删除应用</h2>
    <blockquote>
      ⚠️ 删除应用会级联清掉所有数据集元数据、Access Key、Webhook 订阅。
      底层数据库表里的业务数据 <strong>不会</strong>被删（那是数据源的事），
      但 Kintsugi 这边的元数据 + 凭据全无法恢复。删之前导出 bundle 备份。
    </blockquote>
  </>
);

const manualDataSources = (
  <>
    <h1>数据源 / 扫描</h1>
    <p>
      <strong>数据源</strong>是 Kintsugi 与你的真实数据库的连接。一个数据源 = 一个 DSN
      （host + port + db + user + 密码加密落库）。建好之后 Kintsugi 会扫描它的 schema，
      把每张表抽成"数据集"。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 数据源 → 列表 / 详情</p>
    <h2>支持的方言</h2>
    <ul>
      <li>PostgreSQL（推荐 — RLS / GUC 强制安全策略最完整）</li>
      <li>MySQL</li>
      <li>MariaDB</li>
      <li>SQL Server (mssql)</li>
      <li>Oracle</li>
    </ul>
    <h2>新建数据源</h2>
    <ol>
      <li>侧边栏 → 数据源 → 「新建数据源」</li>
      <li>选方言、填 host / port / database / user / password / schema 名</li>
      <li>提交后端会先 ping 一次，连不上直接拒</li>
      <li>密码用 AES-256-GCM 加密落库（每条独立 salt），server 端 ENCRYPTION_KEY 拿不到就解不开</li>
    </ol>
    <h2>schema 扫描</h2>
    <ol>
      <li>数据源详情 → 「扫描」按钮</li>
      <li>后端 introspect 表 + 列 + 索引 + 外键，写进 ScanJob</li>
      <li>扫描完成后点表名「→ 创建数据集」一键建</li>
    </ol>
    <p>
      历史扫描记录在「扫描历史」标签里，可以对比两次 schema 漂移。
    </p>
    <h2>注意</h2>
    <blockquote>
      生产数据源建议用<strong>只读账号</strong>。Kintsugi 的 SQL Editor / Chats
      默认走只读事务保护，但 BFF 脚本可以走非只读 client。低权限账号 = 多一道兜底。
    </blockquote>
  </>
);

const manualDatasets = (
  <>
    <h1>数据集 / DO</h1>
    <p>
      <strong>数据集（Dataset）</strong>是 Kintsugi 平台抽象出来的"数据对象"：
      它指向真实库的一张表，但带上业务名 / 字段映射 / 软删字段 / 默认排序 /
      索引提示等元数据，做成一个可复用的 DO（Data Object）。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 数据集 → 列表 / 详情 / 数据浏览</p>
    <h2>从扫描结果建数据集</h2>
    <ol>
      <li>数据源详情 → 选一张表 → 「→ 创建数据集」</li>
      <li>系统自动把表的列填进 DO；businessName / 中文别名你自己补</li>
      <li>选定 ID 字段（一般是 <code>id</code>）和软删字段（如 <code>is_deleted</code>）</li>
      <li>保存后 Kintsugi 给它分配一个 <code>datasetCode</code>，对外契约用这个</li>
    </ol>
    <h2>数据浏览（Data Browser）</h2>
    <ul>
      <li>数据集详情 → 「数据」标签</li>
      <li>带筛选 / 分页 / 排序的网格视图</li>
      <li>有写权限的角色可以在里面直接编辑（行级 RLS 也在这条路径生效）</li>
    </ul>
    <h2>RLS 策略</h2>
    <p>
      数据集详情 → 「RLS 策略」标签可以为该 dataset 配置行级安全策略，常见两种 scope：
    </p>
    <ul>
      <li><strong>tenant</strong>：同租户互通（默认）</li>
      <li><strong>self</strong>：只能看 / 改 <code>created_by = current_user</code> 的行</li>
    </ul>
    <p>
      这条策略在 PG 端用 <code>CREATE POLICY</code> 落地；Kintsugi 在执行 SQL 前
      <code>SET LOCAL kintsugi.tenant_code / kintsugi.user_id</code>，让 PG 自己拒非法行。
      靠的是 PG 强制，不靠应用层 if-else。
    </p>
    <h2>版本</h2>
    <p>
      DO 改了字段（加 / 删 / 改 logical type）→ <code>version</code> 加 1。
      下游 SDK 在校验 schema 时可以用 version 判断是否需要重新生成 types。
    </p>
  </>
);

const manualEr = (
  <>
    <h1>ER 图</h1>
    <p>
      数据源扫描完后，<strong>ER 图</strong>把表 + 外键关系可视化成图。
      用来做技术调研 / 给同事讲解用，<strong>不是查表入口</strong>——查具体数据集走「数据集」列表。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 数据源 → 选某个数据源 → 「ER 图」标签</p>
    <h2>能做什么</h2>
    <ul>
      <li>双指 / 滚轮缩放，拖拽平移</li>
      <li>聚焦模式（Focus Mode）：双击某张表 → 只显示它和直接关系的邻居</li>
      <li>右下角小地图（Minimap）快速跳转</li>
      <li>自动布局：力导向算法摆位，可以手动拖到喜欢的位置（位置不持久化）</li>
    </ul>
    <h2>不能做什么</h2>
    <blockquote>
      ER 图只读，不能在这里建 / 改字段。要改字段去「数据集」详情；要改外键
      去真实数据库里改。Kintsugi 不动你的 schema。
    </blockquote>
  </>
);

const manualSql = (
  <>
    <h1>Custom SQL</h1>
    <p>
      预置 SQL 脚本：参数化 / 命名占位 / 风险评级 / 审批，让"业务方需要一段查询"这事
      不用每次找 DBA。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → Custom SQL → 列表 / 编辑器</p>
    <h2>新建</h2>
    <ol>
      <li>「新建 SQL」</li>
      <li>选数据源</li>
      <li>
        写 SQL，参数用 <code>:name</code> 形式：
        <pre><code>{`SELECT id, total
FROM orders
WHERE tenant_code = :tenantCode
  AND created_at > :since
LIMIT 100`}</code></pre>
      </li>
      <li>系统给这条 SQL 静态分析：估行数、有无 WHERE、是否含 DML，给 <code>riskLevel</code>（low / medium / critical）</li>
      <li>critical 级 SQL（INSERT/UPDATE/DELETE/无 WHERE 的全表 SELECT）需要审批通过才能跑</li>
    </ol>
    <h2>调用方式</h2>
    <p>
      <code>POST /api/sql/&#123;sqlCode&#125;/execute</code>
      ，body 含 <code>params</code>（按 name 注入）+ <code>actor</code>（human / agent）+ 可选 <code>sqlSafe</code>。
      参数用 PG <code>$1, $2</code> 或 MySQL <code>?</code> 形式真实绑定，不是字符串拼接。
    </p>
    <h2>actor=agent 与 sqlSafe</h2>
    <ul>
      <li><strong>actor=human</strong>：UI 用户主动点的，按用户角色 ABAC 鉴权</li>
      <li><strong>actor=agent</strong>：Chats / 自动流程调的，更严格，默认 only-SELECT</li>
      <li><strong>sqlSafe=true</strong>：跳过 critical 审批（仅平台 admin 可用）</li>
    </ul>
  </>
);

const manualBff = (
  <>
    <h1>BFF 脚本</h1>
    <p>
      <strong>BFF（Backend For Frontend）</strong>让你在 Kintsugi 里写一段 JS 函数，
      访问数据集 + 自定义 SQL + 内置 logger，被前端 / 客户端通过一个端点调用。
      适合"前端要的不是单表数据，而是多表组合后的视图"这种场景。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → BFF → 列表 / 编辑器</p>
    <h2>脚本签名</h2>
    <pre><code>{`module.exports = async function (ctx) {
  const { client, payload, logger } = ctx;
  // 用 client.models.<datasetCode> 操作数据集
  const orders = await client.models.orders.filter({
    where: [{ field: 'tenant_code', op: 'eq', value: payload.tenantCode }],
  });
  // 也可以执行 Custom SQL
  const summary = await client.sql.execute('orders-summary-monthly', { since: '2026-01-01' });
  // 真事务：跨多个 dataset 写入
  await client.tx(async () => {
    await client.models.orders.create({ /* ... */ });
    await client.models.audit_log.create({ /* ... */ });
  });
  logger.log('returning', orders.data.length, 'rows');
  return { orders: orders.data, summary };
};`}</code></pre>
    <h2>调用方式</h2>
    <p>
      <code>POST /api/bff/exec/&#123;appCode&#125;/&#123;scriptName&#125;</code>，
      body <code>&#123; payload: ... &#125;</code>，返回脚本的返回值（JSON-safe）。
    </p>
    <h2>沙箱说明</h2>
    <blockquote>
      BFF 跑在独立的 worker 子进程里（vm.Script），不能访问主进程的内存 / fs；
      但 <code>node:vm</code> 不是真安全沙箱，只防一般业务出错，不防恶意代码。
      因此 BFF 脚本的<strong>写权限</strong>仅给平台 admin。多租户 / 不可信用户禁止开 BFF 写。
    </blockquote>
    <h2>超时 / 资源限制</h2>
    <ul>
      <li>默认单次执行 vmTimeout 30s，超时被强杀</li>
      <li>worker pool 大小受 <code>BFF_MAX_WORKERS</code> 控制</li>
      <li>RPC 总时长上限受 <code>BFF_RPC_TIMEOUT_MS</code> 控制</li>
    </ul>
  </>
);

const manualPages = (
  <>
    <h1>自定义页面</h1>
    <p>
      <strong>页面（Page）</strong>是 Kintsugi 提供的"无代码 UI 构建"——把数据集
      / SQL / BFF 拼成一个用户能看到的页面（表格 / 看板 / 图表组合），
      挂在路由 <code>/p/&#123;routePath&#125;</code> 下。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 页面 → 列表 / 详情</p>
    <h2>建页流程</h2>
    <ol>
      <li>「新建页面」</li>
      <li>选 boundDataset（页面的主数据集）</li>
      <li>编辑器里拖块：表头筛选 / 数据表 / 卡片 / 图表 / 操作按钮</li>
      <li>保存后即时可访问（<code>/p/&#123;routePath&#125;</code>）</li>
    </ol>
    <h2>权限</h2>
    <p>
      页面默认按 <strong>boundDataset 的 RLS 策略</strong>过数据。
      给某些角色看 / 不给看：通过 RBAC 角色 + permission 配置。
    </p>
    <h2>菜单</h2>
    <p>
      页面可以挂到自定义菜单（Menu），让你的 IT 同学不用进 Kintsugi 后台，
      而是在客户端直接用菜单导航。
    </p>
  </>
);

const manualChats = (
  <>
    <h1>AI 问数 (Chats)</h1>
    <p>
      用自然语言问数据库的"问数"端点。LLM 拿到 dataset schema + 你的问题，
      产出一条 SELECT-only 的 SQL，跑出来再用业务字段名格式化结果。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 问数</p>
    <h2>怎么问</h2>
    <ol>
      <li>选应用</li>
      <li>问问题，例如"最近 30 天每天的订单量是多少"</li>
      <li>系统给出 SQL + 解释 + 数据 + 可视化建议（chart type / x / y / series）</li>
      <li>不满意可以「重生成」，会换一种思路</li>
    </ol>
    <h2>安全保证</h2>
    <ul>
      <li>SQL 只能是 <code>SELECT / WITH / EXPLAIN</code> 开头，否则拒（sql-guard）</li>
      <li>禁多语句（<code>;</code> 分隔）</li>
      <li>超出 1000 行结果自动截断</li>
      <li>读路径走 <code>BEGIN READ ONLY</code> 事务，PG 端兜底拒写</li>
      <li>RLS 仍然生效——LLM 看不到当前用户没权限的行</li>
    </ul>
    <h2>计费</h2>
    <p>
      每次提问扣 <code>aiCredits</code>：先按预扣（默认 0.10 元）reserve，
      实际 token 用完后 settle 多退少补。余额不足直接拒新调用。
      试用账户每天 50 次（额度可在 <code>TRIAL_MAX_DAILY_LLM_CALLS</code> 调）。
    </p>
  </>
);

const manualReports = (
  <>
    <h1>AI 报表</h1>
    <p>
      和「问数」是一回事，但更聚焦"图表"——同一条问题，
      生成一个可保存的报表对象（含 SQL + 渲染配置），可以贴到自定义页面里。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → AI 报表</p>
    <h2>使用流程</h2>
    <ol>
      <li>选应用，输入问题</li>
      <li>预览图（按推荐 chart type 渲染）</li>
      <li>满意则保存为命名报表，否则改问题或换 chart type 重生成</li>
    </ol>
    <h2>典型用法</h2>
    <p>
      给运营同学做"昨日 GMV / 订单量 / 客单价"的看板，
      不需要 BI 工程师介入：自然语言 → AI 出 SQL + 图，一次成型。
      复杂场景仍然推荐 Custom SQL + Page。
    </p>
  </>
);

const manualAccessKeys = (
  <>
    <h1>Access Key</h1>
    <p>
      给程序 / 第三方系统访问 Kintsugi API 用的长期凭证。
      用 HMAC-SHA256 签名调用，不需要每次拿 JWT。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 集成 / SDK → 选某应用 → 「Access Keys」</p>
    <h2>新建</h2>
    <ol>
      <li>「新建 Access Key」</li>
      <li>可选 <code>expiresInDays</code>（不填 = 永不过期）</li>
      <li>可选 <code>boundUserId</code>（绑给某个用户，用于 self-scope RLS）</li>
      <li><strong>secretKey 只在创建时返回一次</strong>，关掉对话框就再看不到。复制好</li>
    </ol>
    <h2>签名规范</h2>
    <p>
      规范化字符串 = <code>METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY</code>，
      <code>HMAC-SHA256(secret, canonical)</code> 取 hex 进 <code>X-Signature</code>。
      其他 header：<code>X-Access-Key</code> / <code>X-Timestamp</code>（10 位 unix 秒）/ <code>X-Nonce</code>（8+ hex）。
    </p>
    <p>详细在「SDK 教程」各语言页里。</p>
    <h2>旋转</h2>
    <p>
      Access Key 详情 → 「旋转」生成新 secret，
      旧 secret 在 <code>graceMinutes</code>（默认 60 分钟，最大 240）内仍可用作灰度切换。
      grace 过完自动失效。
    </p>
    <h2>撤销</h2>
    <p>
      「撤销」按钮立即吊销，不留 grace。
      跨 tenant 撤销 / 旋转别人的 key 一律返回"AccessKey not found"——
      不暴露目标 key 所属的 appCode。
    </p>
  </>
);

const manualWebhooks = (
  <>
    <h1>Webhooks</h1>
    <p>
      数据集发生增 / 改 / 删事件时主动 POST 到你配置的 URL，让你的下游系统不用轮询。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → Webhooks</p>
    <h2>新建订阅</h2>
    <ol>
      <li>「新建订阅」</li>
      <li>填 URL（必须 https，不能是私网 / loopback / link-local — SSRF 防护）</li>
      <li>选要订阅的事件：<code>dataset.created</code> / <code>dataset.updated</code> / <code>dataset.deleted</code> / 全部</li>
      <li>系统给你一个 <code>secret</code>（同样仅创建时可见，AES 加密落库）</li>
    </ol>
    <h2>请求 header</h2>
    <table>
      <thead>
        <tr><th>Header</th><th>含义</th></tr>
      </thead>
      <tbody>
        <tr><td><code>X-Kintsugi-Event</code></td><td>事件类型</td></tr>
        <tr><td><code>X-Kintsugi-Timestamp</code></td><td>unix 秒</td></tr>
        <tr><td><code>X-Kintsugi-Signature</code></td><td><code>sha256=&#123;hmac&#125;</code>，body 为 message</td></tr>
        <tr><td><code>X-Kintsugi-Attempts</code></td><td>当前尝试次数（1-based）</td></tr>
        <tr><td><code>X-Kintsugi-Delivery-Id</code></td><td>本次投递唯一 id；用于幂等去重</td></tr>
      </tbody>
    </table>
    <h2>重试策略</h2>
    <ul>
      <li>非 2xx → 退避重试：1m → 5m → 30m → 2h（共 4 次重试）</li>
      <li>5 次失败 → dead-letter，不再投递；可在 UI 看失败详情</li>
      <li>多实例部署用 lease 防双投</li>
    </ul>
    <h2>幂等</h2>
    <blockquote>
      receiver 一定要按 <code>X-Kintsugi-Delivery-Id</code> 做幂等：HTTP 抖动场景
      （你 200 但响应丢失 → 我们超时重发）会让你重复处理同一事件。
    </blockquote>
  </>
);

const manualIntegrations = (
  <>
    <h1>IM 集成</h1>
    <p>
      接入飞书 / 钉钉 / 企业微信群机器人，让用户在 IM 里 @机器人 直接问数。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 集成 / SDK → 「IM Bridges」</p>
    <h2>飞书</h2>
    <ol>
      <li>飞书开放平台：建机器人，选「事件订阅」</li>
      <li>请求 URL: <code>https://&#123;kintsugi-host&#125;/api/feishu/event</code></li>
      <li>把飞书给的 <code>Verification Token</code> 填到平台 env <code>FEISHU_VERIFY_TOKEN</code></li>
      <li>订阅 <code>im.message.receive_v1</code> 事件</li>
    </ol>
    <h2>钉钉</h2>
    <ol>
      <li>群设置 → 智能群助手 → 添加机器人 → 自定义</li>
      <li>勾「加签」，把 secret 填到 <code>DINGTALK_VERIFY_SECRET</code></li>
      <li>POST URL: <code>https://&#123;kintsugi-host&#125;/api/dingtalk/event?appCode=&#123;your-app&#125;</code></li>
    </ol>
    <h2>企业微信</h2>
    <ol>
      <li>企业微信管理后台 → 应用管理 → 自建应用 → 接收消息</li>
      <li>把 <code>token</code> 填到 <code>WECOM_VERIFY_TOKEN</code></li>
      <li>POST URL: <code>https://&#123;kintsugi-host&#125;/api/wecom/event?appCode=&#123;your-app&#125;</code></li>
    </ol>
    <h2>验签 / 安全</h2>
    <blockquote>
      生产环境必须设三家的 token / secret，否则 webhook 一律拒。
      非生产可以临时用 <code>KINTSUGI_BRIDGE_DEV_BYPASS=true</code> 跳过校验，
      <strong>仅供 dev</strong>。
    </blockquote>
  </>
);

const manualTransfer = (
  <>
    <h1>资产导入导出</h1>
    <p>
      把一个应用里的所有元数据（数据集 / 页面 / BFF / SQL / 角色）打包成 zip
      bundle，迁去另一个环境（dev → prod / prod → 备用集群）。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 资产导入导出</p>
    <h2>导出</h2>
    <ol>
      <li>选应用 → 「导出 bundle」</li>
      <li>下载得到 <code>app-&#123;code&#125;-bundle.zip</code></li>
      <li>包含 <code>bundle.json</code>（元数据）+ <code>bff/*.js</code> + <code>sql/*.sql</code></li>
    </ol>
    <h2>导入</h2>
    <ol>
      <li>目标环境 → 「导入 bundle」 → 选目标应用 → 上传 zip</li>
      <li>勾「覆盖已存在」决定 upsert 还是 skip</li>
      <li>整体事务化：任一段失败整体回滚</li>
    </ol>
    <h2>注意</h2>
    <ul>
      <li>zip 大小硬限 4MB（防 zip bomb）</li>
      <li><code>dataSourceId</code> 是目标环境特有，不会自动跨环境映射 → 导入后手动给数据集 link 数据源</li>
      <li>Access Key / Webhook secret 不进 bundle（凭据本来就不能跨环境复用）</li>
    </ul>
  </>
);

const manualAudit = (
  <>
    <h1>审计日志</h1>
    <p>
      所有写操作（POST / PATCH / PUT / DELETE）都自动记一条审计行，
      含 tenantCode / userId / accessKey / appCode / action / timestamp / traceparent /
      请求体（脱敏后）。
    </p>
    <h2>UI 路径</h2>
    <p>侧边栏 → 审计日志</p>
    <h2>能查什么</h2>
    <ul>
      <li>按租户 / 用户 / Access Key / 时间窗 / 动作类型筛选</li>
      <li>详情页看完整请求体（已脱敏 password / secret 等敏感字段）</li>
      <li>带 <code>traceparent</code> → 一键跳到 OTel 追踪后台</li>
    </ul>
    <h2>保留期</h2>
    <p>
      默认 365 天滚动清理（<code>AUDIT_RETENTION_DAYS</code>）。设为 <code>0</code>
      关闭清理（合规要求"绝不删"用此 + 走外部冷备）。
    </p>
    <h2>什么不会被记</h2>
    <ul>
      <li>纯 GET 读路径（量太大，靠 OTel trace + 网关日志）</li>
      <li>BFF 内部子调用（外层 BFF 调用本身记，里面那一层不记）</li>
      <li>密码 / secret / 私钥字段（脱敏 redactor 滤掉）</li>
    </ul>
  </>
);

// ---------- SDK 教程 ----------

const sdkTypeScript = (
  <>
    <h1>TypeScript / Node.js SDK</h1>
    <p>
      官方 SDK 包名 <code>@kintsugi/sdk</code>，TS 写就，浏览器 + Node 通用。
      types 由 <code>/api/openapi.platform.json</code> 自动生成，跟着 server 走。
    </p>
    <h2>安装</h2>
    <pre><code>{`pnpm add @kintsugi/sdk
# 或 npm install @kintsugi/sdk / yarn add @kintsugi/sdk`}</code></pre>
    <h2>初始化（三种 auth）</h2>
    <pre><code>{`import { createClient } from '@kintsugi/sdk';

// 1. 浏览器 cookie 模式（已登录用户）
const client = createClient({
  baseUrl: 'https://kintsugi.example.com',
  appCode: 'my-app',
  auth: { kind: 'cookie' },
});

// 2. JWT bearer
const client = createClient({
  baseUrl: 'https://kintsugi.example.com',
  appCode: 'my-app',
  auth: { kind: 'token', token: process.env.KINTSUGI_TOKEN! },
});

// 3. Access Key (HMAC) — 推荐生产 / 服务端
const client = createClient({
  baseUrl: 'https://kintsugi.example.com',
  appCode: 'my-app',
  auth: {
    kind: 'accessKey',
    accessKey: process.env.KINTSUGI_AK!,
    secretKey: process.env.KINTSUGI_SK!,
  },
});`}</code></pre>
    <h2>数据集操作</h2>
    <pre><code>{`// 列表 / 筛选 / 分页
const result = await client.models.orders.filter({
  where: [
    { field: 'status', op: 'eq', value: 'paid' },
    { field: 'created_at', op: 'gte', value: '2026-01-01' },
  ],
  orderBy: [{ field: 'created_at', direction: 'desc' }],
  page: 1,
  pageSize: 50,
});
console.log(result.data, result.total);

// 单条
const order = await client.models.orders.getOne(123);

// 创建 / 更新 / 删除
const created = await client.models.orders.create({ status: 'paid', total: 99.0 });
await client.models.orders.update(123, { status: 'refunded' });
await client.models.orders.delete(123);

// 批量创建（高吞吐）
await client.models.orders.batchCreate([
  { status: 'paid', total: 100 },
  { status: 'paid', total: 200 },
]);

// 聚合
const agg = await client.models.orders.aggregate({
  groupBy: ['status'],
  metrics: [{ alias: 'cnt', op: 'count' }, { alias: 'sum', op: 'sum', field: 'total' }],
});`}</code></pre>
    <h2>Custom SQL</h2>
    <pre><code>{`const r = await client.sql.execute({
  sqlCode: 'orders-summary-monthly',
  params: { since: '2026-01-01' },
  actor: 'agent',
});
console.log(r.data, r.rowCount, r.riskLevel);`}</code></pre>
    <h2>BFF</h2>
    <pre><code>{`const result = await client.bff.execute<{ orders: Order[] }>({
  scriptName: 'orders-with-customer-summary',
  payload: { tenantCode: 'acme' },
});`}</code></pre>
    <h2>AI 问数</h2>
    <pre><code>{`const r = await client.chats.ask({
  question: '最近 30 天每天的订单量是多少',
  maxTables: 6,
});
console.log(r.sql, r.explanation, r.data, r.chart);`}</code></pre>
    <h2>类型生成</h2>
    <p>
      包内自带 <code>src/generated/api-types.ts</code>，从平台 OpenAPI 派生。
      你可以直接 <code>import &#123; paths, components &#125; from '@kintsugi/sdk/types'</code>
      拿 <code>operations</code> / <code>schemas</code> 类型。
    </p>
  </>
);

const sdkIos = (
  <>
    <h1>iOS (Swift) SDK</h1>
    <p>
      官方 iOS SDK 用 Swift Package Manager 分发，Swift 5.9+，iOS 15+。
      已发布到内部仓 <code>git@github.com:kintsugi/kintsugi-ios.git</code>。
    </p>
    <h2>集成</h2>
    <pre><code>{`// Package.swift
dependencies: [
  .package(url: "git@github.com:kintsugi/kintsugi-ios.git", from: "0.1.0"),
]
// 或 Xcode → File → Add Packages → 输入仓库 URL`}</code></pre>
    <h2>初始化</h2>
    <pre><code>{`import KintsugiSDK

let client = KintsugiClient(
  baseURL: URL(string: "https://kintsugi.example.com")!,
  appCode: "my-app",
  auth: .accessKey(
    accessKey: ProcessInfo.processInfo.environment["KINTSUGI_AK"]!,
    secretKey: ProcessInfo.processInfo.environment["KINTSUGI_SK"]!
  )
)`}</code></pre>
    <h2>查询</h2>
    <pre><code>{`struct Order: Codable {
  let id: Int
  let status: String
  let total: Double
}

let result: PagedResult<Order> = try await client.dataset("orders").filter(
  where: [.eq("status", "paid")],
  orderBy: [.desc("created_at")],
  pageSize: 50
)
print(result.data.count, "of", result.total)`}</code></pre>
    <h2>调 Custom SQL / BFF / 问数</h2>
    <pre><code>{`// SQL
let sqlResult: SqlExecuteResponse = try await client.sql.execute(
  sqlCode: "orders-summary-monthly",
  params: ["since": "2026-01-01"]
)

// BFF
struct BffOut: Codable { let orders: [Order] }
let bff: BffOut = try await client.bff.execute(
  scriptName: "orders-with-customer",
  payload: ["tenantCode": "acme"]
)

// 问数
let ask = try await client.chats.ask(question: "最近 30 天每天的订单量")
print(ask.sql, ask.explanation)`}</code></pre>
    <h2>错误处理</h2>
    <pre><code>{`do {
  let r = try await client.dataset("orders").getOne(id: 123)
} catch let e as KintsugiHTTPError {
  print("HTTP", e.statusCode, e.code, e.message)
} catch {
  print("network/other:", error)
}`}</code></pre>
  </>
);

const sdkAndroid = (
  <>
    <h1>Android (Kotlin) SDK</h1>
    <p>
      官方 Android SDK 以 AAR 分发，Kotlin 1.9+，minSdk 24。
      下载入口：<code>/api/sdk/android/info</code> 拿到当前版本与 AAR 直链。
    </p>
    <h2>集成</h2>
    <pre><code>{`// settings.gradle.kts
dependencyResolutionManagement {
  repositories {
    maven { url = uri("https://kintsugi.example.com/maven") }
  }
}

// app/build.gradle.kts
dependencies {
  implementation("com.kintsugi:sdk:0.1.0")
  // 协程 / Retrofit / OkHttp 依赖会自动传递
}`}</code></pre>
    <h2>初始化</h2>
    <pre><code>{`import com.kintsugi.sdk.KintsugiClient
import com.kintsugi.sdk.Auth

val client = KintsugiClient(
  baseUrl = "https://kintsugi.example.com",
  appCode = "my-app",
  auth = Auth.AccessKey(
    accessKey = BuildConfig.KINTSUGI_AK,
    secretKey = BuildConfig.KINTSUGI_SK,
  ),
)`}</code></pre>
    <h2>查询（协程）</h2>
    <pre><code>{`@Serializable
data class Order(val id: Long, val status: String, val total: Double)

val result = client.dataset<Order>("orders").filter(
  where = listOf(Where.eq("status", "paid")),
  orderBy = listOf(OrderBy.desc("created_at")),
  pageSize = 50
)
Log.i("Kintsugi", "got \${result.data.size} of \${result.total}")`}</code></pre>
    <h2>调 SQL / BFF / 问数</h2>
    <pre><code>{`// SQL
val sql = client.sql.execute(
  sqlCode = "orders-summary-monthly",
  params = mapOf("since" to "2026-01-01")
)

// BFF
@Serializable data class BffOut(val orders: List<Order>)
val bff: BffOut = client.bff.execute(
  scriptName = "orders-with-customer",
  payload = mapOf("tenantCode" to "acme")
)

// 问数
val ask = client.chats.ask("最近 30 天每天的订单量")`}</code></pre>
    <h2>线程模型</h2>
    <p>
      所有方法都是 <code>suspend</code>；建议在 ViewModel 里用 <code>viewModelScope.launch</code>，
      网络 IO 自动走 <code>Dispatchers.IO</code>。
    </p>
  </>
);

const sdkPython = (
  <>
    <h1>Python SDK</h1>
    <blockquote>
      <strong>Round 12 上线（实施中）</strong>。下面是即将发布的 API 形态预览，
      欢迎提前做集成评估，正式 GA 后这一页会替换为完整教程。
    </blockquote>
    <h2>计划安装</h2>
    <pre><code>{`pip install kintsugi-sdk
# 或 uv add kintsugi-sdk / poetry add kintsugi-sdk`}</code></pre>
    <h2>计划用法</h2>
    <pre><code>{`from kintsugi_sdk import KintsugiClient, AccessKeyAuth

client = KintsugiClient(
    base_url="https://kintsugi.example.com",
    app_code="my-app",
    auth=AccessKeyAuth(
        access_key=os.environ["KINTSUGI_AK"],
        secret_key=os.environ["KINTSUGI_SK"],
    ),
)

# 数据集
result = client.models.orders.filter(
    where=[{"field": "status", "op": "eq", "value": "paid"}],
    page_size=50,
)
print(result["data"])

# Custom SQL
r = client.sql.execute(
    sql_code="orders-summary-monthly",
    params={"since": "2026-01-01"},
    actor="agent",
)

# BFF
out = client.bff.execute(
    script_name="orders-with-customer",
    payload={"tenant_code": "acme"},
)

# 问数
ask = client.chats.ask("最近 30 天每天的订单量")`}</code></pre>
    <h2>异步版本</h2>
    <p>
      正式版同时提供同步 (<code>KintsugiClient</code>) 和异步 (<code>AsyncKintsugiClient</code>) 两套。
      异步基于 <code>httpx.AsyncClient</code>，FastAPI / asyncio 服务直接 await。
    </p>
    <h2>类型支持</h2>
    <p>
      用 <code>pydantic v2</code> 给请求 / 响应做 schema 校验，
      types 同样从平台 OpenAPI 派生（<code>kintsugi-sdk</code> 包里自带 .pyi）。
    </p>
  </>
);

const sdkGo = (
  <>
    <h1>Go SDK</h1>
    <blockquote>
      <strong>Round 12 上线（实施中）</strong>。下面是即将发布的 API 形态预览。
    </blockquote>
    <h2>计划安装</h2>
    <pre><code>{`go get github.com/kintsugi/kintsugi-go@latest`}</code></pre>
    <h2>计划用法</h2>
    <pre><code>{`import (
    "context"
    "os"
    "github.com/kintsugi/kintsugi-go"
)

client := kintsugi.NewClient(kintsugi.Config{
    BaseURL: "https://kintsugi.example.com",
    AppCode: "my-app",
    Auth: kintsugi.AccessKeyAuth{
        AccessKey: os.Getenv("KINTSUGI_AK"),
        SecretKey: os.Getenv("KINTSUGI_SK"),
    },
})

// 数据集
type Order struct {
    ID     int64   \`json:"id"\`
    Status string  \`json:"status"\`
    Total  float64 \`json:"total"\`
}

var orders kintsugi.Paged[Order]
err := client.Dataset("orders").Filter(ctx, kintsugi.FilterRequest{
    Where: []kintsugi.Where{{Field: "status", Op: "eq", Value: "paid"}},
    PageSize: 50,
}, &orders)

// Custom SQL
var sqlResp kintsugi.SqlResult
client.SQL.Execute(ctx, "orders-summary-monthly", map[string]any{
    "since": "2026-01-01",
}, &sqlResp)

// BFF
var bffOut struct{ Orders []Order \`json:"orders"\` }
client.BFF.Execute(ctx, "orders-with-customer", map[string]any{
    "tenantCode": "acme",
}, &bffOut)

// 问数
ask, _ := client.Chats.Ask(ctx, "最近 30 天每天的订单量")`}</code></pre>
    <h2>设计要点</h2>
    <ul>
      <li>所有方法接 <code>context.Context</code>，超时 / cancel 直传</li>
      <li>用 <code>encoding/json</code> + 泛型容器（Go 1.21+）类型化解码</li>
      <li>错误统一用 <code>*kintsugi.HTTPError</code>，含 status / code / message</li>
    </ul>
  </>
);

const sdkJava = (
  <>
    <h1>Java SDK</h1>
    <blockquote>
      <strong>Round 12 上线（实施中）</strong>。Java 17+，同时支持同步 / Reactor 异步。
    </blockquote>
    <h2>计划安装</h2>
    <pre><code>{`<!-- pom.xml -->
<dependency>
  <groupId>com.kintsugi</groupId>
  <artifactId>kintsugi-sdk</artifactId>
  <version>0.1.0</version>
</dependency>

<!-- Gradle -->
implementation("com.kintsugi:kintsugi-sdk:0.1.0")`}</code></pre>
    <h2>计划用法</h2>
    <pre><code>{`import com.kintsugi.sdk.KintsugiClient;
import com.kintsugi.sdk.Auth;

KintsugiClient client = KintsugiClient.builder()
    .baseUrl("https://kintsugi.example.com")
    .appCode("my-app")
    .auth(Auth.accessKey(
        System.getenv("KINTSUGI_AK"),
        System.getenv("KINTSUGI_SK")))
    .build();

// 数据集
record Order(long id, String status, double total) {}

PagedResult<Order> result = client.dataset(Order.class, "orders")
    .filter(FilterRequest.builder()
        .where(Where.eq("status", "paid"))
        .pageSize(50)
        .build());

// Custom SQL
SqlResult sql = client.sql().execute(
    "orders-summary-monthly",
    Map.of("since", "2026-01-01"));

// BFF
record BffOut(List<Order> orders) {}
BffOut bff = client.bff().execute(
    BffOut.class,
    "orders-with-customer",
    Map.of("tenantCode", "acme"));

// 问数
ChatsAskResult ask = client.chats().ask("最近 30 天每天的订单量");`}</code></pre>
    <h2>异步</h2>
    <p>
      Reactor 风格：<code>client.async().dataset(...)</code> 返回 <code>Mono</code> /
      <code>Flux</code>，可被 Spring WebFlux 直接挂在 controller 链路上。
    </p>
  </>
);

// ---------- 索引 ----------

export const HELP_CONTENTS: Record<HelpSlug, React.ReactElement> = {
  index: indexArticle,
  'manual-roles': manualRoles,
  'manual-login': manualLogin,
  'manual-applications': manualApplications,
  'manual-datasources': manualDataSources,
  'manual-datasets': manualDatasets,
  'manual-er': manualEr,
  'manual-sql': manualSql,
  'manual-bff': manualBff,
  'manual-pages': manualPages,
  'manual-chats': manualChats,
  'manual-reports': manualReports,
  'manual-access-keys': manualAccessKeys,
  'manual-webhooks': manualWebhooks,
  'manual-integrations': manualIntegrations,
  'manual-transfer': manualTransfer,
  'manual-audit': manualAudit,
  'sdk-typescript': sdkTypeScript,
  'sdk-ios': sdkIos,
  'sdk-android': sdkAndroid,
  'sdk-python': sdkPython,
  'sdk-go': sdkGo,
  'sdk-java': sdkJava,
};
