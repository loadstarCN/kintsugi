#!/usr/bin/env bash
# server-deploy.sh — 服务器侧原子部署脚本
#
# 由 GitHub Actions 通过 SSH 调用，期望以下环境变量：
#   RELEASE_ID  本次发布的唯一 id（YYYYMMDD-HHMMSS-<sha7>）
#   DEPLOY_PATH 部署根目录，默认 /opt/kintsugi
#   STAGING     上传 artifact 的临时目录（包含 *.tar.gz + ecosystem.config.cjs）
#
# 不动 .env：/opt/kintsugi/.env 由人工维护，部署只读。
#
# 流程：
#   1. 解压 server bundle 到 server-new
#   2. ln .env，cp ecosystem.config.cjs
#   3. prisma db push（schema 同步；TODO round-11 切到 migrate deploy）
#   4. 原子 mv：server → server-old，server-new → server
#   5. pm2 startOrReload（首次自动 start，后续 reload）
#   6. /api/health 健康探针；失败则回滚
#   7. 部署 web（静态文件）
#   8. 清理
set -euo pipefail

: "${RELEASE_ID:?RELEASE_ID required}"
: "${STAGING:?STAGING required}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/kintsugi}"

log() { printf '[deploy %s] %s\n' "$RELEASE_ID" "$*"; }
err() { printf '[deploy %s] ERR: %s\n' "$RELEASE_ID" "$*" >&2; }

# --- 0. 前置检查 -------------------------------------------------------------
if [[ ! -f "${DEPLOY_PATH}/.env" ]]; then
  err "${DEPLOY_PATH}/.env not found — create it first (chmod 600). Aborting."
  exit 1
fi

for cmd in pm2 prisma curl tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "missing required command: $cmd"
    exit 1
  fi
done

# --- 1. 解压 server bundle --------------------------------------------------
log "extract server bundle"
rm -rf "${DEPLOY_PATH}/server-new"
mkdir -p "${DEPLOY_PATH}/server-new"
tar -xzf "${STAGING}/server-bundle.tar.gz" -C "${DEPLOY_PATH}/server-new"

# --- 2. 链接 .env / 拷贝 pm2 config -----------------------------------------
ln -sf "${DEPLOY_PATH}/.env" "${DEPLOY_PATH}/server-new/.env"
cp "${STAGING}/ecosystem.config.cjs" "${DEPLOY_PATH}/server-new/ecosystem.config.cjs"

# --- 3. 跑 migration --------------------------------------------------------
# .env 里允许 value 含空格 / 特殊字符（无引号），不能直接 source。
# 用 regex 一行行解析，把每条 KEY=VALUE 喂给 export。
log "parse env"
ENV_KV=()
while IFS= read -r line || [[ -n "$line" ]]; do
  # 跳过空行与注释
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    k="${BASH_REMATCH[1]}"
    v="${BASH_REMATCH[2]}"
    # 剥去成对引号
    if [[ "$v" =~ ^\"(.*)\"$ || "$v" =~ ^\'(.*)\'$ ]]; then
      v="${BASH_REMATCH[1]}"
    fi
    ENV_KV+=("${k}=${v}")
  fi
done < "${DEPLOY_PATH}/.env"

log "prisma db push (sync schema, schema 端权威)"
# TODO(round-11)：切到 `prisma migrate deploy` 走可审计的 migration 流，
# 不再 db push 绕过 _prisma_migrations 表。
# 切换前提：
#  · 现有生产 RDS 已 baseline（cycle 0 已跑 prisma migrate resolve --applied 20260503000000_initial_baseline）
#  · 全部 schema 改动都通过 prisma:migrate:create 进 git
# 改动后：
#    env "${ENV_KV[@]}" prisma migrate deploy --schema prisma/schema.prisma
# 可保留 db push 作为应急 fallback。
(
  cd "${DEPLOY_PATH}/server-new"
  # --skip-generate：CI 已经 generate 过了；--accept-data-loss 默认 false，
  # 真要丢列时会中止部署，运维介入再决定。
  env "${ENV_KV[@]}" prisma db push --schema prisma/schema.prisma --skip-generate
)
# 把 SERVER_PORT 提出来供后面 health check 用（如果 .env 里设了）
for kv in "${ENV_KV[@]}"; do
  if [[ "$kv" == SERVER_PORT=* ]]; then
    SERVER_PORT="${kv#SERVER_PORT=}"
  fi
done

# --- 4. 原子切换 server 目录 -------------------------------------------------
log "atomic swap: server <- server-new"
if [[ -d "${DEPLOY_PATH}/server" ]]; then
  rm -rf "${DEPLOY_PATH}/server-old"
  mv "${DEPLOY_PATH}/server" "${DEPLOY_PATH}/server-old"
fi
mv "${DEPLOY_PATH}/server-new" "${DEPLOY_PATH}/server"

# --- 5. pm2 重新加载 -----------------------------------------------------
# 用 delete + start 而不是 reload —— pm2 reload 不会重新读 ecosystem.config 的
# script 字段，第一次从老 path（main.js）切到新 path（dist/main.js）时会卡。
# fork 模式 reload 本来就不是零停机，差几秒重启接受。
log "pm2 delete + start (forces config re-read)"
pm2 delete kintsugi-server >/dev/null 2>&1 || true
pm2 start "${DEPLOY_PATH}/server/ecosystem.config.cjs"
pm2 save >/dev/null 2>&1 || true

# --- 6. 健康检查 -------------------------------------------------------------
HEALTH_PORT="${SERVER_PORT:-4000}"
HEALTH_URL="http://127.0.0.1:${HEALTH_PORT}/api/health"
log "health check ${HEALTH_URL}"
HEALTHY=
for i in $(seq 1 20); do
  if curl -fsS "$HEALTH_URL" -m 5 >/dev/null 2>&1; then
    HEALTHY=1
    log "✔ healthy (after ${i} probes)"
    break
  fi
  sleep 2
done

if [[ -z "$HEALTHY" ]]; then
  err "health check failed; rolling back server"
  if [[ -d "${DEPLOY_PATH}/server-old" ]]; then
    rm -rf "${DEPLOY_PATH}/server"
    mv "${DEPLOY_PATH}/server-old" "${DEPLOY_PATH}/server"
    pm2 delete kintsugi-server >/dev/null 2>&1 || true
    pm2 start "${DEPLOY_PATH}/server/ecosystem.config.cjs"
  fi
  exit 1
fi

# --- 7. 部署 web (静态文件) ---------------------------------------------------
log "extract web bundle"
rm -rf "${DEPLOY_PATH}/web-new"
mkdir -p "${DEPLOY_PATH}/web-new"
tar -xzf "${STAGING}/web-bundle.tar.gz" -C "${DEPLOY_PATH}/web-new"

if [[ -d "${DEPLOY_PATH}/web" ]]; then
  rm -rf "${DEPLOY_PATH}/web-old"
  mv "${DEPLOY_PATH}/web" "${DEPLOY_PATH}/web-old"
fi
mv "${DEPLOY_PATH}/web-new" "${DEPLOY_PATH}/web"

# --- 8. 清理 -----------------------------------------------------------------
log "cleanup"
rm -rf "${DEPLOY_PATH}/server-old" "${DEPLOY_PATH}/web-old" "${STAGING}"

log "✔ deploy complete (release ${RELEASE_ID})"
