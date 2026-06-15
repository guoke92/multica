#!/usr/bin/env bash
# Bootstrap a local PostgreSQL for Multica dev without Docker (macOS + Homebrew).
#
# Creates role/database from .env (default multica/multica) and starts the service.
# Requires: Homebrew. PostgreSQL 17 recommended (postgresql@17 formula).
#
# Usage:
#   cp .env.example .env   # if needed
#   bash scripts/setup-native-postgres.sh
#   MULTICA_POSTGRES_SKIP_DOCKER=1 make dev
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${1:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy from .env.example first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

POSTGRES_DB="${POSTGRES_DB:-multica}"
POSTGRES_USER="${POSTGRES_USER:-multica}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-multica}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This helper targets macOS + Homebrew. On Linux, create role/database manually:"
  echo "  CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD';"
  echo "  CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"
  exit 1
fi

if ! command -v brew > /dev/null 2>&1; then
  echo "✗ Homebrew not found. Install from https://brew.sh"
  exit 1
fi

BREW_PG_FORMULA=""
for candidate in postgresql@17 postgresql@16 postgresql; do
  if brew list --formula "$candidate" > /dev/null 2>&1; then
    BREW_PG_FORMULA="$candidate"
    break
  fi
done

if [ -z "$BREW_PG_FORMULA" ]; then
  echo "==> Installing PostgreSQL 17 (postgresql@17)..."
  brew install postgresql@17
  BREW_PG_FORMULA="postgresql@17"
fi

echo "==> Using Homebrew formula: $BREW_PG_FORMULA"
brew services start "$BREW_PG_FORMULA"

PG_PREFIX="$(brew --prefix "$BREW_PG_FORMULA")"
export PATH="$PG_PREFIX/bin:$PATH"

if ! command -v psql > /dev/null 2>&1; then
  echo "✗ psql not found after installing $BREW_PG_FORMULA"
  exit 1
fi

# Homebrew Postgres superuser is typically the macOS login user (peer/trust locally).
SUPERUSER="${PGSETUP_SUPERUSER:-$(whoami)}"

echo "==> Waiting for PostgreSQL on port $POSTGRES_PORT..."
for _ in $(seq 1 60); do
  if pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" -q 2>/dev/null; then
    break
  fi
  sleep 1
done

if ! pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" -q 2>/dev/null; then
  echo "✗ PostgreSQL did not become ready on port $POSTGRES_PORT."
  echo "  Check: brew services list"
  echo "  Logs:  brew services info $BREW_PG_FORMULA"
  exit 1
fi

echo "==> Creating role and database (superuser: $SUPERUSER)..."
psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$SUPERUSER" -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$POSTGRES_USER') THEN
    CREATE ROLE $POSTGRES_USER WITH LOGIN PASSWORD '$POSTGRES_PASSWORD';
  ELSE
    ALTER ROLE $POSTGRES_USER WITH LOGIN PASSWORD '$POSTGRES_PASSWORD';
  END IF;
END
\$\$;
SQL

db_exists="$(psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$SUPERUSER" -d postgres -Atqc \
  "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")"
if [ "$db_exists" != "1" ]; then
  psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$SUPERUSER" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""
fi

# Optional extensions used by migrations (best-effort; migrations skip if missing).
for ext in pgcrypto; do
  psql -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$SUPERUSER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=0 \
    -c "CREATE EXTENSION IF NOT EXISTS \"$ext\";" > /dev/null 2>&1 || true
done

echo ""
echo "✓ Native PostgreSQL is ready."
echo "  DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=disable"
echo ""
echo "Add to $ENV_FILE (if not already set):"
echo "  MULTICA_POSTGRES_SKIP_DOCKER=1"
echo ""
echo "Then start the app:"
echo "  make dev"
echo ""
echo "Shell PATH (add to ~/.zshrc for new terminals):"
echo "  export PATH=\"$PG_PREFIX/bin:\$PATH\""
