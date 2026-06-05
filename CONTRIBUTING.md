# Contributing to Kintsugi

Thanks for your interest in contributing! This document explains how to get set up and what we expect in a pull request.

## Development setup

Prerequisites: Node.js ≥ 20.10 (22 LTS recommended) and pnpm ≥ 9 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`).

```bash
pnpm install
cp .env.example .env   # fill in METADATA_DATABASE_URL, LLM_API_KEY, and the secrets
pnpm --filter @kintsugi/server prisma:generate
pnpm --filter @kintsugi/server prisma:migrate
pnpm dev:server   # http://localhost:4000
pnpm dev:web      # http://localhost:5173
```

See the [README](./README.md) for more detail.

## Before opening a pull request

Please make sure the following pass locally:

```bash
pnpm lint        # eslint, zero-warning gate
pnpm typecheck   # whole workspace
pnpm test        # vitest
```

- Keep changes focused — one logical change per PR.
- Match the style and conventions of the surrounding code.
- For new behavior, add or update tests.
- For larger or architectural changes, please open an issue to discuss the design first.

## Commit messages

We loosely follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat(dbagent): …`, `fix(web): …`). Encouraged, not enforced.

## License

By contributing, you agree that your contributions will be licensed under the project's [AGPL-3.0](./LICENSE) license.
