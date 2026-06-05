#!/usr/bin/env bash
# Production smoke test —— 不动 DB，只 GET / POST 公开端点验证服务在线。
#
# 用法：
#   bash deploy/scripts/prod-smoke.sh                              # 默认打 prod
#   BASE=http://localhost:4000 bash deploy/scripts/prod-smoke.sh   # 打本地
#
# 退出码 0 = 全过；非 0 = 至少一项 fail。
set +e

BASE="${BASE:-https://kintsugi.example.com}"
PASS=0
FAIL=0

check() {
  local name="$1"; local expected="$2"; local actual="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS+1))
    echo "  ✓ $name (HTTP $actual)"
  else
    FAIL=$((FAIL+1))
    echo "  ✗ $name (got $actual, want $expected)"
  fi
}

http_code() {
  curl -so /dev/null -w '%{http_code}' "$@"
}

echo "=========================================="
echo "PROD SMOKE — $BASE"
echo "$(date -Iseconds)"
echo "=========================================="

# ---- 公开端点 ----
check "health" 200 "$(http_code "$BASE/api/health")"
check "openapi.platform.json" 200 "$(http_code "$BASE/api/openapi.platform.json")"

# ---- 申请试用 API（POST 公开）----
TS=$(date +%s)
EMAIL="smoke-${TS}@invalid.example"
RESP=$(curl -s -w '|%{http_code}' -X POST "$BASE/api/trial/apply" \
  -H 'content-type: application/json' \
  -d "{\"contactName\":\"smoke\",\"email\":\"$EMAIL\",\"useCase\":\"prod smoke automated test\"}")
STATUS="${RESP##*|}"
BODY="${RESP%|*}"
check "trial/apply 提交成功" 201 "$STATUS"

# ---- 拒未授权 admin endpoint ----
check "admin/trials 无 token → 401" 401 "$(http_code "$BASE/api/admin/trials")"
check "admin trials approve 无 token → 401" 401 \
  "$(http_code -X POST "$BASE/api/admin/trials/fake-id/reject" -H 'content-type: application/json' -d '{}')"

# ---- 关闭的公开 register ----
RES=$(http_code -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d '{"tenantCode":"smoke-no-go","username":"x","password":"long-enough-password-X"}')
check "公开 register 默认禁 → 403" 403 "$RES"

# ---- bridges 默认拒 ----
check "DingTalk bridge 默认拒 → 401" 401 \
  "$(http_code -X POST "$BASE/api/bridges/dingtalk/webhook?appCode=smoke&timestamp=$(date +%s)000&sign=fake" -H 'content-type: application/json' -d '{}')"
check "Feishu bridge 默认拒 → 401" 401 \
  "$(http_code -X POST "$BASE/api/bridges/feishu/webhook?appCode=smoke" -H 'content-type: application/json' -H 'x-lark-signature: x' -H "x-lark-request-timestamp: $(date +%s)" -H 'x-lark-request-nonce: n' -d '{}')"

# ---- Login wrong creds 401 ----
check "login 无效凭证 → 401" 401 \
  "$(http_code -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"tenantCode":"none","username":"none","password":"long-enough-pwd-X"}')"

# ---- Register dup email + 试用申请 dup → 409 ----
DUP=$(http_code -X POST "$BASE/api/trial/apply" \
  -H 'content-type: application/json' \
  -d "{\"contactName\":\"smoke\",\"email\":\"$EMAIL\",\"useCase\":\"dup\"}")
check "trial/apply 重复 email → 409" 409 "$DUP"

# ---- Health 内容验证 ----
HEALTH_BODY=$(curl -s "$BASE/api/health")
if echo "$HEALTH_BODY" | grep -q '"status":"ok"' && echo "$HEALTH_BODY" | grep -q '"metadata":"connected"'; then
  PASS=$((PASS+1))
  echo "  ✓ health body shape ok"
else
  FAIL=$((FAIL+1))
  echo "  ✗ health body unexpected: $HEALTH_BODY"
fi

echo "=========================================="
echo "PASS: $PASS  /  FAIL: $FAIL"
echo "=========================================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
