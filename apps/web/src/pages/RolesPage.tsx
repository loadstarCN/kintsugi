/**
 * 角色管理 · 租户级
 *   - 持 *:rbac:read 才能进
 *   - 持 *:rbac:write 才能建角色 / 绑用户 / 解绑
 *
 * 数据模型：
 *   - Role：tenantCode + appCode? + name + description + permissions.grants[]
 *   - UserRole：userId × roleId，多对多
 *
 * 这里只暴露"列出 / 创建 / 绑用户 / 解绑用户"四件事；
 * 删除角色 / 改角色 grants 留作后续（接口也还没暴露）。
 */
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import * as React from 'react';
import { callerCanGrant } from '@kintsugi/shared';
import { api } from '../api';
import { message } from '../notify';
import { hasGrant, useAuth } from '../auth';

interface RoleRow {
  id: string;
  tenantCode: string;
  appCode: string | null;
  name: string;
  description: string | null;
  permissions: { grants?: string[] };
  createdAt: string;
  updatedAt: string;
}

interface TenantUserRow {
  id: string;
  username: string;
  email: string | null;
  roles: Array<{ id: string; name: string }>;
}

/** 与 packages/shared 的 KNOWN_PERMISSIONS 保持一致 —— 这是给"建角色"表单的 grant picker 提供选项。
 *  有 contract spec 在后端兜底，这里漂了 contract test 不会发现，但选不出的 grant 用户也写不进去。 */
const GRANT_OPTIONS: ReadonlyArray<{ value: string; label: string; level: 'platform' | 'tenant' }> = [
  // 平台级（提示：tenant-admin 不该有这些；勾了等于晋升 platform-admin）
  { value: '*:admin:read', label: '*:admin:read · 平台级（试用申请列表）', level: 'platform' },
  { value: '*:admin:write', label: '*:admin:write · 平台级（试用审批）', level: 'platform' },
  // 租户级
  { value: '*:application:write', label: '*:application:write · 新建应用', level: 'tenant' },
  { value: '*:datasource:write', label: '*:datasource:write · 数据源 CRUD / 测试 / 扫描', level: 'tenant' },
  { value: '*:dataset:read', label: '*:dataset:read · 看数据集详情', level: 'tenant' },
  { value: '*:dataset:write', label: '*:dataset:write · 改 DO / 字段角色', level: 'tenant' },
  { value: '*:page:write', label: '*:page:write · AI 页面 / 发布', level: 'tenant' },
  { value: '*:sql:write', label: '*:sql:write · Custom SQL CRUD', level: 'tenant' },
  { value: '*:sql:exec', label: '*:sql:exec · 执行 Custom SQL', level: 'tenant' },
  { value: '*:bff:write', label: '*:bff:write · BFF 脚本 CRUD', level: 'tenant' },
  { value: '*:bff:exec', label: '*:bff:exec · 调用 BFF 脚本', level: 'tenant' },
  { value: '*:asset:read', label: '*:asset:read · 导出 zip', level: 'tenant' },
  { value: '*:asset:write', label: '*:asset:write · 导入 zip', level: 'tenant' },
  { value: '*:audit:read', label: '*:audit:read · 审计日志', level: 'tenant' },
  { value: '*:webhook:read', label: '*:webhook:read · webhook 订阅 / 投递', level: 'tenant' },
  { value: '*:webhook:write', label: '*:webhook:write · 创建 / 切换 / 删除 webhook', level: 'tenant' },
  { value: '*:accessKey:read', label: '*:accessKey:read · 看 API key', level: 'tenant' },
  { value: '*:accessKey:write', label: '*:accessKey:write · 创建 / 旋转 / 删除 API key', level: 'tenant' },
  { value: '*:rbac:read', label: '*:rbac:read · 看角色 / 用户', level: 'tenant' },
  { value: '*:rbac:write', label: '*:rbac:write · 改角色 / 绑用户', level: 'tenant' },
];

export function RolesPage() {
  const { me } = useAuth();
  const canWrite = hasGrant(me, '*:rbac:write');

  const [roles, setRoles] = React.useState<RoleRow[]>([]);
  const [users, setUsers] = React.useState<TenantUserRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [bindTarget, setBindTarget] = React.useState<TenantUserRow | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [r, u] = await Promise.all([
        api.get<RoleRow[]>('/rbac/roles'),
        api.get<TenantUserRow[]>('/rbac/users'),
      ]);
      setRoles(r);
      setUsers(u);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="角色 / 权限管理（租户级）"
        description={
          <>
            这里管的只是<strong>当前租户</strong>内的角色和用户绑定。预置角色 tenant-admin /
            developer / operator / platform-admin 由 bootstrap-demo 维护——改它们的 grants
            会被下次 bootstrap 拉回；自定义角色随便建。<br />
            权限矩阵详情见侧边栏「操作说明 / SDK」→「角色与权限」。
          </>
        }
      />
      <Tabs
        items={[
          {
            key: 'roles',
            label: `角色 (${roles.length})`,
            children: (
              <RolesTab
                roles={roles}
                loading={loading}
                canWrite={canWrite}
                onCreate={() => setCreateOpen(true)}
                onRefresh={() => void refresh()}
              />
            ),
          },
          {
            key: 'users',
            label: `用户 (${users.length})`,
            children: (
              <UsersTab
                users={users}
                roles={roles}
                loading={loading}
                canWrite={canWrite}
                onBind={(u) => setBindTarget(u)}
                onRefresh={() => void refresh()}
              />
            ),
          },
        ]}
      />
      {createOpen && (
        <CreateRoleModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            void refresh();
          }}
        />
      )}
      {bindTarget && (
        <BindModal
          user={bindTarget}
          roles={roles}
          onClose={() => setBindTarget(null)}
          onSaved={() => {
            setBindTarget(null);
            void refresh();
          }}
        />
      )}
    </Space>
  );
}

function RolesTab({
  roles,
  loading,
  canWrite,
  onCreate,
  onRefresh,
}: {
  roles: RoleRow[];
  loading: boolean;
  canWrite: boolean;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  return (
    <Card
      title="租户内角色"
      extra={
        <Space>
          <Button onClick={onRefresh} loading={loading}>
            刷新
          </Button>
          {canWrite && (
            <Button type="primary" onClick={onCreate}>
              + 新建角色
            </Button>
          )}
        </Space>
      }
    >
      {!loading && roles.length === 0 ? (
        <Empty description="还没有角色（异常状态——预置角色应由 bootstrap-demo 自动建）" />
      ) : (
        <Table<RoleRow>
          rowKey="id"
          loading={loading}
          dataSource={roles}
          pagination={false}
          size="middle"
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              key: 'name',
              render: (v: string, r) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{v}</Typography.Text>
                  {r.appCode && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.appCode}
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            {
              title: '说明',
              dataIndex: 'description',
              key: 'description',
              render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
            },
            {
              title: 'grants',
              key: 'grants',
              render: (_: unknown, r) => {
                const grants = r.permissions.grants ?? [];
                if (grants.includes('*:*:*')) {
                  return <Tag color="red">*:*:* · 全部</Tag>;
                }
                return (
                  <Space wrap size={4}>
                    {grants.length === 0 ? (
                      <Typography.Text type="secondary">（无 grants）</Typography.Text>
                    ) : (
                      grants.map((g) => (
                        <Tag key={g} color="default" style={{ fontFamily: 'monospace' }}>
                          {g}
                        </Tag>
                      ))
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      )}
    </Card>
  );
}

function UsersTab({
  users,
  roles,
  loading,
  canWrite,
  onBind,
  onRefresh,
}: {
  users: TenantUserRow[];
  roles: RoleRow[];
  loading: boolean;
  canWrite: boolean;
  onBind: (u: TenantUserRow) => void;
  onRefresh: () => void;
}) {
  // api.delete 不接受 body —— 这里直接走 fetch；同源 cookie 自动带。
  const unassign = async (userId: string, roleId: string) => {
    try {
      const res = await fetch('/api/rbac/assign', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, roleId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      message.success('已解绑');
      onRefresh();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <Card
      title={`本租户用户`}
      extra={
        <Button onClick={onRefresh} loading={loading}>
          刷新
        </Button>
      }
    >
      <Table<TenantUserRow>
        rowKey="id"
        loading={loading}
        dataSource={users}
        pagination={false}
        size="middle"
        columns={[
          {
            title: '用户名',
            dataIndex: 'username',
            key: 'username',
            render: (v: string, r) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{v}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.email ?? '—'}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '已绑角色',
            key: 'roles',
            render: (_: unknown, r) => {
              const known = new Set(roles.map((rr) => rr.id));
              return (
                <Space wrap size={4}>
                  {r.roles.length === 0 && (
                    <Typography.Text type="secondary">（无角色 = viewer）</Typography.Text>
                  )}
                  {r.roles.map((role) => (
                    <Tag
                      key={role.id}
                      color={known.has(role.id) ? 'gold' : 'default'}
                      closable={canWrite}
                      onClose={(e) => {
                        e.preventDefault();
                        void unassign(r.id, role.id);
                      }}
                    >
                      {role.name}
                    </Tag>
                  ))}
                </Space>
              );
            },
          },
          {
            title: '操作',
            key: 'actions',
            width: 120,
            render: (_: unknown, r) =>
              canWrite ? (
                <Button size="small" onClick={() => onBind(r)}>
                  + 绑角色
                </Button>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  只读
                </Typography.Text>
              ),
          },
        ]}
      />
    </Card>
  );
}

function CreateRoleModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth();
  const [form] = Form.useForm<{ name: string; description?: string; grants: string[] }>();
  const [submitting, setSubmitting] = React.useState(false);

  // Privilege Attenuation：只让用户从自己手上有的 grants 里选。后端 createRole 还会再校验一次，
  // 这里只是 UX——避免选了平台级再被 403 退回。
  const callerGrants = me?.grants ?? [];
  const callerHas = (target: string) => callerCanGrant(callerGrants, target);
  const availableOptions = GRANT_OPTIONS.filter((o) => callerHas(o.value));

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await api.post('/rbac/roles', {
        name: values.name.trim(),
        ...(values.description?.trim() ? { description: values.description.trim() } : {}),
        grants: values.grants,
      });
      message.success(`已创建角色 ${values.name}`);
      onSaved();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      title="新建角色"
      okText="创建"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
      width={640}
    >
      <Form layout="vertical" form={form} initialValues={{ grants: [] }}>
        <Form.Item
          label="角色名"
          name="name"
          rules={[
            { required: true, message: '必填' },
            { max: 64, message: '不超过 64 字符' },
          ]}
          extra="本租户内唯一。建议小写英文短串，比如 analyst、ops。"
        >
          <Input placeholder="analyst" />
        </Form.Item>
        <Form.Item label="说明（可选）" name="description" rules={[{ max: 200 }]}>
          <Input placeholder="给团队读的简短描述" />
        </Form.Item>
        <Form.Item
          label="grants"
          name="grants"
          rules={[{ required: true, message: '至少选一个' }]}
          extra={
            <>
              选项已按你当前账号的 grants 过滤，<strong>越权 grant 不会出现在列表里</strong>
              （后端会再校验一次）。<br />
              格式 <code>&lt;app|*&gt;:&lt;resource&gt;:&lt;action&gt;</code>，<code>*</code> 是通配符。
            </>
          }
        >
          <Select
            mode="multiple"
            placeholder={
              availableOptions.length === 0
                ? '当前账号没有任何可外授的 grant'
                : '勾选这个角色应有的权限'
            }
            disabled={availableOptions.length === 0}
            options={availableOptions.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            optionFilterProp="label"
            showSearch
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function BindModal({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user: TenantUserRow;
  roles: RoleRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { me } = useAuth();
  const [roleId, setRoleId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Privilege Attenuation：caller 不能把自己手上没有的 grants 通过角色绑定外授。
  // 这里把 caller 没法完全覆盖的角色从候选里剔掉，保持和后端 assertCanGrantAll 一致。
  const callerGrants = me?.grants ?? [];
  const alreadyBound = new Set(user.roles.map((r) => r.id));
  const candidates = roles.filter((r) => {
    if (alreadyBound.has(r.id)) return false;
    const grants = r.permissions.grants ?? [];
    return grants.every((g) => callerCanGrant(callerGrants, g));
  });
  const blockedByPrivilege = roles.length - alreadyBound.size - candidates.length;

  const submit = async () => {
    if (!roleId) return;
    setSubmitting(true);
    try {
      await api.post('/rbac/assign', { userId: user.id, roleId });
      message.success('已绑定');
      onSaved();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      title={`给 ${user.username} 绑定角色`}
      okText="绑定"
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: !roleId }}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      {candidates.length === 0 ? (
        <Empty
          description={
            blockedByPrivilege > 0
              ? `还剩 ${blockedByPrivilege} 个角色，但其 grants 越出当前账号的权限，不能由你绑定`
              : '该用户已经绑了所有现存角色'
          }
        />
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            placeholder="选一个角色"
            value={roleId ?? undefined}
            onChange={setRoleId}
            options={candidates.map((r) => ({
              value: r.id,
              label: `${r.name}${r.description ? ` · ${r.description}` : ''}`,
            }))}
          />
          {roleId && (
            <Alert
              type="info"
              showIcon
              message="勾选确认"
              description={
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {(roles.find((r) => r.id === roleId)?.permissions.grants ?? []).join(' · ') || '（无 grants）'}
                </span>
              }
            />
          )}
        </Space>
      )}
    </Modal>
  );
}
