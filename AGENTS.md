# Repository Guidelines

This file provides guidance to AI agents when working with code in this repository.

> **Single source of truth:** This file is a concise pointer document.
> All authoritative architecture, coding rules, commands, and conventions
> live in **CLAUDE.md** at the project root. Read that file first.

## Quick Reference

### Architecture

Go backend + monorepo frontend (pnpm workspaces + Turborepo) with shared packages.

- `server/` — Go backend (Chi router, sqlc, gorilla/websocket)
- `apps/web/` — Next.js frontend (App Router)
- `apps/desktop/` — Electron desktop app
- `packages/core/` — Headless business logic (Zustand stores, React Query hooks, API client)
- `packages/ui/` — Atomic UI components (shadcn/Base UI, zero business logic)
- `packages/views/` — Shared business pages/components
- `packages/tsconfig/` — Shared TypeScript config

### State Management (critical)

- **React Query** owns all server state (issues, members, agents, inbox, workspace list)
- **Zustand** owns all client state (current workspace selection, view filters, drafts, modals)
- All Zustand stores live in `packages/core/` — never in `packages/views/` or app directories
- WS events invalidate React Query — never write directly to stores

### Package Boundaries (hard rules)

- `packages/core/` — zero react-dom, zero localStorage, zero process.env
- `packages/ui/` — zero `@multica/core` imports
- `packages/views/` — zero `next/*`, zero `react-router-dom`, use `NavigationAdapter` for routing
- `apps/web/platform/` — only place for Next.js APIs

### Commands

```bash
make dev              # Auto-setup + start everything
pnpm typecheck        # TypeScript check
pnpm test             # TS unit tests (Vitest)
make test             # Go tests
make check            # Full verification pipeline
```

See CLAUDE.md for the complete command reference.

### Testing Quick Reference

```bash
# Single TS test (any package)
pnpm --filter @multica/views exec vitest run auth/login-page.test.tsx
pnpm --filter @multica/core exec vitest run runtimes/version.test.ts

# Single Go test
cd server && go test ./internal/handler/ -run TestName

# E2E test (requires backend + frontend running)
pnpm exec playwright test e2e/tests/specific-test.spec.ts
```

### Non-Obvious Gotchas

- **Reserved slugs:** New global routes MUST use single word (`/login`) or `/{noun}/{verb}` (`/workspaces/new`). Hyphenated root routes (`/new-workspace`) are forbidden. Edit `server/internal/handler/reserved_slugs.json`, run `pnpm generate:reserved-slugs`, commit both.
- **API response parsing:** Never use bare `as` casts on API responses. Use `parseWithFallback` from `packages/core/api/schema.ts` with zod schemas. Desktop app may hit older servers.
- **Desktop drag region:** Every full-window desktop view needs `<DragStrip />` as first flex child. Interactive UI in top 48px needs `WebkitAppRegion: "no-drag"`.
- **pnpm catalog:** All shared deps use `catalog:` references in `pnpm-workspace.yaml`. Add new shared deps to catalog first.
- **Dependency declaration:** Every workspace must explicitly declare all external packages in its own `package.json`. Phantom deps are prohibited.

### Environment Setup

```bash
# Quick start (recommended)
make dev

# Explicit setup
cp .env.example .env
make setup
make start

# Worktree
git worktree add ../multica-feature -b feat/my-change main
cd ../multica-feature
make worktree-env
make dev
```

### Go Backend

```bash
make server           # Run Go server only
make build            # Build binaries to server/bin/
make sqlc             # Regenerate sqlc after editing SQL in server/pkg/db/queries/
make migrate-up       # Run migrations
```

### Frontend

```bash
pnpm dev:web          # Next.js dev server (port 3000)
pnpm dev:desktop      # Electron dev
pnpm build            # Build all frontend apps
```

### Mobile (Expo)

```bash
pnpm dev:mobile                  # Metro, dev env
pnpm dev:mobile:staging          # Metro, staging env
pnpm ios:mobile                  # Native build + install to iOS Simulator
```

See `apps/mobile/CLAUDE.md` for mobile-specific rules.
