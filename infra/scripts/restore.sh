#!/bin/sh
# Restore a backup into a NEW database, verify it, and only then switch over manually.
# Usage: infra/scripts/restore.sh /path/to/startup-YYYYMMDDTHHMMSSZ.dump startup_restore
set -eu
DUMP="${1:?dump file}"
TARGET="${2:-startup_restore}"
COMPOSE="docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env"
$COMPOSE exec -T db createdb -U startup "$TARGET"
$COMPOSE exec -T db pg_restore -U startup -d "$TARGET" --no-owner < "$DUMP"
# Ledger integrity check on the restored copy.
$COMPOSE exec -T db psql -U startup -d "$TARGET" -v ON_ERROR_STOP=1 -c "
  SELECT (SELECT COALESCE(SUM(amount),0) FROM postings) AS postings_sum,
         (SELECT count(*) FROM accounts a WHERE a.balance <> COALESCE((SELECT SUM(amount) FROM postings p WHERE p.account_id=a.id),0)) AS drifted_accounts;"
echo "Restored into database '$TARGET'. postings_sum and drifted_accounts must both be 0 before switching DATABASE_URL."
