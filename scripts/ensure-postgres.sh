#!/usr/bin/env bash
# Ensure PostgreSQL is reachable and the app database exists.
#
# Local hosts (localhost / 127.0.0.1 / ::1):
#   1. Prefer an already-running native PostgreSQL (no Docker).
#   2. Fall back to the shared Docker Compose postgres service when native
#      is not ready and Docker is available.
#
# Remote DATABASE_URL: skip Docker; only verify connectivity.
#
# Env overrides:
#   MULTICA_POSTGRES_USE_DOCKER=1   Always use Docker on local hosts.
#   MULTICA_POSTGRES_SKIP_DOCKER=1  Never use Docker; fail if native is down.
#
# First-time native setup on macOS: scripts/setup-native-postgres.sh
set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  echo "Create .env from .env.example, or run 'make worktree-env' and use .env.worktree."
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

POSTGRES_DB="${POSTGRES_DB:-multica}"
POSTGRES_USER="${POSTGRES_USER:-multica}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-multica}"
DATABASE_URL="${DATABASE_URL:-}"

export PGPASSWORD="$POSTGRES_PASSWORD"

db_host=""
db_port="${POSTGRES_PORT:-5432}"
db_name="$POSTGRES_DB"

parse_database_url() {
  local rest authority hostport path port_part

  rest="${DATABASE_URL#*://}"
  rest="${rest%%\?*}"
  authority="${rest%%/*}"
  path="${rest#*/}"

  if [ "$authority" = "$rest" ]; then
    path=""
  fi

  hostport="${authority##*@}"

  if [[ "$hostport" == \[* ]]; then
    db_host="${hostport#\[}"
    db_host="${db_host%%]*}"
    port_part="${hostport#*\]}"
    if [[ "$port_part" == :* ]] && [ -n "${port_part#:}" ]; then
      db_port="${port_part#:}"
    fi
  else
    db_host="${hostport%%:*}"
    if [[ "$hostport" == *:* ]] && [ -n "${hostport##*:}" ]; then
      db_port="${hostport##*:}"
    fi
  fi

  if [ -n "$path" ]; then
    db_name="${path%%/*}"
  fi
}

if [ -n "$DATABASE_URL" ]; then
  parse_database_url
fi

is_local() {
  [ -z "$DATABASE_URL" ] || [ "$db_host" = "localhost" ] || [ "$db_host" = "127.0.0.1" ] || [ "$db_host" = "::1" ]
}

postgres_server_ready() {
  if command -v pg_isready > /dev/null 2>&1; then
    pg_isready -h "$db_host" -p "$db_port" -q
    return $?
  fi
  # pg_isready missing: best-effort probe via psql when available.
  if command -v psql > /dev/null 2>&1; then
    psql -h "$db_host" -p "$db_port" -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "SELECT 1" > /dev/null 2>&1
    return $?
  fi
  return 1
}

psql_app() {
  local db="$1"
  shift
  psql -h "$db_host" -p "$db_port" -U "$POSTGRES_USER" -d "$db" -v ON_ERROR_STOP=1 "$@"
}

ensure_local_database_native() {
  echo "==> Using native PostgreSQL at ${db_host:-localhost}:$db_port..."

  if ! postgres_server_ready; then
    return 1
  fi

  if ! command -v psql > /dev/null 2>&1; then
    echo "✗ Native PostgreSQL is up but psql is not on PATH."
    echo "  Install the PostgreSQL client (e.g. brew install libpq && brew link --force libpq)."
    return 1
  fi

  echo "==> Waiting for PostgreSQL to accept connections..."
  for _ in $(seq 1 30); do
    if postgres_server_ready; then
      break
    fi
    sleep 1
  done
  if ! postgres_server_ready; then
    return 1
  fi

  if ! psql_app postgres -c "SELECT 1" > /dev/null 2>&1; then
    echo "✗ Cannot connect as user '$POSTGRES_USER' on native PostgreSQL."
    echo "  Run: bash scripts/setup-native-postgres.sh"
    echo "  Or point DATABASE_URL at a database you can access."
    return 1
  fi

  echo "==> Ensuring database '$POSTGRES_DB' exists..."
  db_exists="$(psql_app postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")"
  if [ "$db_exists" != "1" ]; then
    psql_app postgres -c "CREATE DATABASE \"$POSTGRES_DB\""
  fi

  echo "✓ PostgreSQL ready (native). Database: $POSTGRES_DB"
  return 0
}

ensure_local_database_docker() {
  if ! command -v docker > /dev/null 2>&1; then
    echo "✗ Docker is not installed and native PostgreSQL is not ready."
    echo "  Either install Docker, or set up native Postgres:"
    echo "    bash scripts/setup-native-postgres.sh"
    return 1
  fi

  echo "==> Ensuring shared PostgreSQL container is running on localhost:${db_port}..."
  docker compose up -d postgres

  echo "==> Waiting for PostgreSQL to be ready..."
  until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d postgres > /dev/null 2>&1; do
    sleep 1
  done

  echo "==> Ensuring database '$POSTGRES_DB' exists..."
  db_exists="$(docker compose exec -T postgres \
    psql -U "$POSTGRES_USER" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")"

  if [ "$db_exists" != "1" ]; then
    docker compose exec -T postgres \
      psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE \"$POSTGRES_DB\"" \
      > /dev/null
  fi

  echo "✓ PostgreSQL ready (Docker). Database: $POSTGRES_DB"
  return 0
}

ensure_remote_database() {
  echo "==> Remote database detected (host: $db_host). Skipping Docker."
  if command -v pg_isready > /dev/null 2>&1; then
    echo "==> Waiting for PostgreSQL at $db_host:$db_port to be ready..."
    until pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; do
      sleep 1
    done
    echo "✓ PostgreSQL ready (remote: $db_host:$db_port). Database: $db_name"
  else
    echo "==> pg_isready not found. Skipping remote connectivity preflight."
    echo "✓ PostgreSQL configured (remote: $db_host:$db_port). Database: $db_name"
  fi
}

if ! is_local; then
  ensure_remote_database
  exit 0
fi

# Default local host when DATABASE_URL is unset.
if [ -z "$db_host" ]; then
  db_host="localhost"
fi

if [ "${MULTICA_POSTGRES_USE_DOCKER:-}" = "1" ]; then
  ensure_local_database_docker
  exit $?
fi

if [ "${MULTICA_POSTGRES_SKIP_DOCKER:-}" = "1" ]; then
  ensure_local_database_native
  exit $?
fi

if ensure_local_database_native; then
  exit 0
fi

echo ""
echo "==> Native PostgreSQL not ready; falling back to Docker..."
if ensure_local_database_docker; then
  exit 0
fi

echo ""
echo "To use only native PostgreSQL (no Docker fallback):"
echo "  bash scripts/setup-native-postgres.sh"
echo "  export MULTICA_POSTGRES_SKIP_DOCKER=1"
exit 1
