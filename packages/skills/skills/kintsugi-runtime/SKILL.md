---
name: kintsugi-runtime
description: Execute (but never enumerate) Kintsugi resources on behalf of a runtime AI agent. Use when an agent needs to run a named Custom SQL, trigger a named BFF endpoint, or ask an app a natural-language question.
trigger: Runtime agent sessions (飞书/钉钉 bot). Do NOT use at dev-time — use `kintsugi` instead.
---

# Kintsugi Runtime CLI

`kintsugi-runtime` is intentionally **narrow**. It only exposes three commands:

```bash
kintsugi-runtime sql-exec -c <sqlCode> -p '{"foo":"bar"}'
kintsugi-runtime bff-exec -a <appCode> -n <scriptName> -p '{...}'
kintsugi-runtime chats-ask -a <appCode> -q "本月付款成功但未发货的订单按仓库汇总"
```

No `list`, no `describe`, no `delete`. If the agent needs to know what's available, it should be told via its prompt (or via MCP `list_datasets` / `list_bff_scripts`).

## Why the asymmetry

- **Dev-time** agents (Claude Code / Cursor) run as _you_, with `kintsugi`. They can list everything.
- **Runtime** agents (飞书机器人) run on behalf of an anonymous business user, scoped by tenant/app. They should not crawl the tree — they should pattern-match the user intent to a **named, pre-reviewed** SQL or BFF.
- This is the **GUI → LUI** transition: the pre-reviewed library IS the product.

## Risk level

- `sql-exec` with `actor=ai` refuses any SQL whose content matches `drop|truncate|delete|alter|create table|grant|revoke`.
- `bff-exec` runs the endpoint's code in a sandbox with `client.models.*`, `client.sql.execute`, and `userInfo`. It cannot shell out or network out directly.
- `chats-ask` always produces SELECT-only SQL via the server-side LLM; the server rejects non-SELECT even if the LLM emits it.
