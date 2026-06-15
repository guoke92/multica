#!/usr/bin/env bash
# Check and guide local dev prerequisites (no Docker required when using native Postgres).
#
# Node: v20+ required; v24+ is fine for this repo (CI uses 22).
# Usage: bash scripts/setup-local-dev.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ok=true

check() {
  local name="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "✓ $name"
    return 0
  fi
  echo "✗ $name — missing"
  ok=false
  return 1
}

echo "==> Local dev prerequisites"
echo ""

if command -v node > /dev/null 2>&1; then
  node_ver="$(node -p "process.versions.node")"
  node_major="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$node_major" -ge 20 ] 2>/dev/null; then
    echo "✓ Node.js $node_ver (v20+; v24 is supported)"
  else
    echo "✗ Node.js $node_ver — need v20 or newer"
    ok=false
  fi
else
  echo "✗ Node.js — not found"
  ok=false
fi

if command -v pnpm > /dev/null 2>&1; then
  echo "✓ pnpm $(pnpm -v)"
else
  echo "✗ pnpm — install: npm install -g pnpm@10.28.2  (or: corepack enable && corepack prepare pnpm@10.28.2 --activate)"
  ok=false
fi

if command -v go > /dev/null 2>&1; then
  echo "✓ $(go version | awk '{print $1, $3}')"
else
  echo "✗ Go — install 1.26+: brew install go"
  ok=false
fi

if command -v docker > /dev/null 2>&1; then
  echo "○ Docker $(docker -v | awk '{print $3}' | tr -d ',') — optional if using native PostgreSQL"
else
  echo "○ Docker — not installed (OK with native PostgreSQL + MULTICA_POSTGRES_SKIP_DOCKER=1)"
fi

if command -v psql > /dev/null 2>&1 && command -v pg_isready > /dev/null 2>&1; then
  if pg_isready -h 127.0.0.1 -p "${POSTGRES_PORT:-5432}" -q 2>/dev/null; then
    echo "✓ PostgreSQL client tools; server ready on port ${POSTGRES_PORT:-5432}"
  else
    echo "○ PostgreSQL client tools installed; server not listening on ${POSTGRES_PORT:-5432}"
    echo "  Run: bash scripts/setup-native-postgres.sh"
  fi
else
  echo "○ PostgreSQL — not configured yet"
  echo "  Run: bash scripts/setup-native-postgres.sh"
fi

echo ""
if [ "$ok" = true ]; then
  echo "Core toolchain looks good. Next steps:"
  echo "  1. cp .env.example .env   # if needed"
  echo "  2. bash scripts/setup-native-postgres.sh   # skip if Postgres already set up"
  echo "  3. echo 'MULTICA_POSTGRES_SKIP_DOCKER=1' >> .env"
  echo "  4. make dev"
else
  echo "Install missing items above, then re-run this script."
  exit 1
fi
