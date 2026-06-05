---
name: kintsugi-cli
description: Operate a Kintsugi application from the shell — list datasets, validate/save/exec Custom SQL, push BFF scripts, ask natural-language questions.
trigger: When the user mentions "kintsugi", "Kintsugi dataset", "apply BFF", or needs to run SQL / query a connected database through the Kintsugi platform.
---

# Kintsugi CLI SOP

`kintsugi` is the **development-time** CLI for a Kintsugi app. It talks to the server over HTTP using `KINTSUGI_API_BASE` + `KINTSUGI_TOKEN`.

> For **runtime** agents (飞书/钉钉机器人) that must not enumerate resources, use `kintsugi-runtime` instead.

## Setup (once per shell)

```bash
export KINTSUGI_API_BASE=http://localhost:4000
export KINTSUGI_TOKEN=$(kintsugi auth login -t demo -u alice -p alice123 | tail -n1)
kintsugi doctor   # verifies health + token
```

## Common workflows

### List what's in an app

```bash
kintsugi dataset list -a app-demo0001
kintsugi sql list -a app-demo0001
kintsugi bff list -a app-demo0001
```

### Inspect a dataset's DO (fields + relations)

```bash
kintsugi dataset detail -c <datasetCode>
```

### Write + save + execute a Custom SQL

```bash
cat > q.sql <<EOF
select count(*) as n from goods where type = #{type};
EOF
kintsugi sql validate -f q.sql                       # returns riskLevel + placeholders
kintsugi sql save -a app-demo0001 -d <dsId> -n goods-by-type -f q.sql
kintsugi sql exec -c <sqlCode> -p '{"type":"2"}'
```

`riskLevel`:

- **low**: SELECT only — any actor can exec.
- **medium**: INSERT/UPDATE/DELETE on single table — human actor only by default.
- **critical**: DROP/TRUNCATE/ALTER — refused unless explicit human confirmation.

### Push a BFF endpoint

```bash
cat > bff/notify-low-stock.js <<'EOF'
module.exports = async function handler(ctx) {
  const hits = await ctx.client.models.goods.filter({
    where: [{ field: 'stock', op: 'lt', value: 10 }],
    pageSize: 50,
  });
  ctx.logger.log(`${hits.total} low-stock items`);
  return { count: hits.total, items: hits.data };
};
EOF
kintsugi bff push -a app-demo0001 -n notify-low-stock -t ENDPOINT -f bff/notify-low-stock.js --dry-run
kintsugi bff push -a app-demo0001 -n notify-low-stock -t ENDPOINT -f bff/notify-low-stock.js --yes
kintsugi bff exec -a app-demo0001 -n notify-low-stock
```

### Pull the OpenAPI doc (and regenerate SDKs / clients)

```bash
kintsugi api-pull -a app-demo0001 -o openapi.json
```

## Safety constraints

- **Never run `kintsugi sql exec` on a SQL you haven't `validate`d first**; `riskLevel` decides whether you're allowed to exec.
- **Never run `kintsugi bff push` without `--dry-run`** first; always diff if remote script is newer.
- **Never push secrets into SQL / BFF files** — they end up in the database and in audit logs.

## Error handling

All commands exit non-zero on failure. Errors from the server arrive as `HTTP <status>: <body>`. The mapped taxonomy lives in `@kintsugi/shared`:

- `UNAUTHENTICATED` → token missing or expired; re-run `auth login`.
- `FORBIDDEN` → actor lacks permission OR SQL risk too high.
- `BLOCKED_BY_CONCURRENT_EDIT` → a colleague edited between your read and write; re-pull and retry.
- `RATE_LIMITED` → respect `Retry-After` header.
