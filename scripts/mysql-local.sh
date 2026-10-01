#!/usr/bin/env bash
# Local MySQL for development. Data lives in ./.mysql (gitignored), listens on 127.0.0.1 only.
# Usage: scripts/mysql-local.sh start|stop|status|shell
set -euo pipefail

MYSQL_HOME="${MYSQL_HOME:-$HOME/.local/opt/mysql-8.4.9-macos15-arm64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.mysql/data"
SOCK="$ROOT/.mysql/mysql.sock"
PID="$ROOT/.mysql/mysql.pid"
PORT="${DB_PORT:-3306}"

DB_NAME="tableqr"
DB_USER="tableqr"
DB_PASSWORD="tableqr_local" # local only, never used outside this machine

client() { "$MYSQL_HOME/bin/mysql" --socket="$SOCK" -uroot "$@"; }

running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }

case "${1:-}" in
  start)
    if running; then echo "MySQL already running on 127.0.0.1:$PORT"; exit 0; fi
    first_run=0
    if [ ! -d "$DATA" ]; then
      mkdir -p "$DATA"
      "$MYSQL_HOME/bin/mysqld" --initialize-insecure --datadir="$DATA" --basedir="$MYSQL_HOME" 2>"$ROOT/.mysql/init.log"
      first_run=1
    fi
    "$MYSQL_HOME/bin/mysqld" --daemonize --datadir="$DATA" --basedir="$MYSQL_HOME" \
      --bind-address=127.0.0.1 --port="$PORT" --socket="$SOCK" --pid-file="$PID" \
      --mysqlx=OFF --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci \
      --default-time-zone=+00:00 --log-error="$ROOT/.mysql/error.log" >/dev/null
    for _ in $(seq 1 30); do client -e "SELECT 1" >/dev/null 2>&1 && break; sleep 0.5; done
    if [ "$first_run" = 1 ]; then
      client -e "CREATE DATABASE IF NOT EXISTS $DB_NAME;
        CREATE DATABASE IF NOT EXISTS ${DB_NAME}_test;
        CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
        CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
        GRANT ALL ON $DB_NAME.* TO '$DB_USER'@'127.0.0.1';
        GRANT ALL ON $DB_NAME.* TO '$DB_USER'@'localhost';
        GRANT ALL ON ${DB_NAME}_test.* TO '$DB_USER'@'127.0.0.1';
        GRANT ALL ON ${DB_NAME}_test.* TO '$DB_USER'@'localhost';"
      echo "Created databases '$DB_NAME' and '${DB_NAME}_test' and user '$DB_USER'"
    fi
    echo "MySQL running on 127.0.0.1:$PORT"
    ;;
  stop)
    if running; then kill "$(cat "$PID")"; echo "MySQL stopped"; else echo "MySQL not running"; fi
    ;;
  status)
    if running; then echo "running (pid $(cat "$PID"))"; else echo "stopped"; fi
    ;;
  shell)
    client "$DB_NAME"
    ;;
  *)
    echo "Usage: $0 start|stop|status|shell" >&2
    exit 1
    ;;
esac
