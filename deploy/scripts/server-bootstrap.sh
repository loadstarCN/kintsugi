#!/usr/bin/env bash
# server-bootstrap.sh — 首次在新服务器上手动跑一次（root 权限）。
#
# 做的事：
#   1. 装 Node 22、pnpm、PM2、prisma CLI（全局）
#   2. 准备 /opt/kintsugi 目录与 .env（chmod 600，模板）
#   3. 生成 GitHub Actions 用的 ed25519 deploy key（如果不存在）
#   4. 提示后续要在 GitHub Settings → Secrets 配置的字段
#
# 使用：
#   ssh root@kintsugi.example.com 'bash -s' < deploy/scripts/server-bootstrap.sh
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/kintsugi}"

log() { printf '[bootstrap] %s\n' "$*"; }

# --- 1. Node 22 -------------------------------------------------------------
if ! node -v 2>/dev/null | grep -q '^v22'; then
  log "install Node 22 via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
log "node $(node -v) / npm $(npm -v)"

# --- 2. pnpm + pm2 + prisma -------------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  log "install pnpm@9.12.0"
  npm install -g pnpm@9.12.0
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "install pm2"
  npm install -g pm2
fi

# pm2-logrotate：默认 pm2 不轮转日志，挂久了会撑爆磁盘
if ! pm2 ls 2>/dev/null | grep -q pm2-logrotate; then
  log "install + configure pm2-logrotate"
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 14
  pm2 set pm2-logrotate:compress true
  pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
fi

if ! command -v prisma >/dev/null 2>&1; then
  log "install prisma CLI@5.22.0"
  npm install -g prisma@5.22.0
fi

log "pnpm $(pnpm -v) / pm2 $(pm2 -v) / prisma $(prisma -v --no-color 2>&1 | head -1)"

# --- 3. 部署目录 + .env ------------------------------------------------------
mkdir -p "${DEPLOY_PATH}"
if [[ ! -f "${DEPLOY_PATH}/.env" ]]; then
  log "create ${DEPLOY_PATH}/.env (template — 编辑后再触发部署)"
  cat > "${DEPLOY_PATH}/.env" <<'EOF'
NODE_ENV=production
LOG_LEVEL=info
SERVER_PORT=4000

# LLM
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
LLM_API_KEY=__FILL_ME__
LLM_TIMEOUT_MS=120000

# Auth / Crypto —— 32+ char 高熵字符串
JWT_SECRET=__FILL_ME__
SESSION_SECRET=__FILL_ME__
ENCRYPTION_KEY=__FILL_ME__

# Metadata DB（控制平面）
METADATA_DATABASE_URL=__FILL_ME__
EOF
  chmod 600 "${DEPLOY_PATH}/.env"
else
  log "${DEPLOY_PATH}/.env already exists, skip"
fi

# --- 4. 生成 deploy key ------------------------------------------------------
KEY_PATH="/root/.ssh/github_actions_deploy"
if [[ ! -f "${KEY_PATH}" ]]; then
  log "generate ed25519 deploy key at ${KEY_PATH}"
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  ssh-keygen -t ed25519 -N '' -C "github-actions@kintsugi" -f "${KEY_PATH}"
  cat "${KEY_PATH}.pub" >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
fi

cat <<EOF

================================================================================
✔ Server bootstrap complete.

Next: 在 GitHub repo Settings → Secrets and variables → Actions 配置：

  DEPLOY_HOST     = kintsugi.example.com   （或你的域名 / IP）
  DEPLOY_USER     = root
  DEPLOY_PATH     = /opt/kintsugi
  DEPLOY_SSH_KEY  = (私钥内容，文件路径见下方)

私钥保存在：${KEY_PATH}
公钥（仅供核对，已写入 authorized_keys）：${KEY_PATH}.pub

⚠️ 不在此输出私钥到终端 —— 之前会留 scrollback / SSH session 副本。
   要复制时在受信终端单独执行：
       ssh root@kintsugi.example.com cat ${KEY_PATH}
================================================================================
EOF
