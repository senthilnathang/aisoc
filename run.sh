#!/usr/bin/env bash
# Local service manager, following AgentGuard's start/stop/status/logs interface.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$ROOT/.run"
mkdir -p "$RUN"
command_name=${1:-start}
target=${2:-all}
backend_mode=go
runtime_profile=release
if [[ -f "$RUN/runtime-profile" ]]; then read -r runtime_profile < "$RUN/runtime-profile"; fi
runtime_profile=${AISOC_RUNTIME_PROFILE:-$runtime_profile}
case "$runtime_profile" in release|foundation) ;; *) echo 'Runtime profile must be release or foundation' >&2; exit 2;; esac
if [[ -f "$RUN/backend-mode" ]]; then read -r backend_mode < "$RUN/backend-mode"; fi
case "$backend_mode" in node|go) ;; *) echo 'Invalid .run/backend-mode; expected node or go' >&2; exit 2;; esac
if [[ "$runtime_profile" == foundation && "$backend_mode" != go ]]; then echo 'Foundation requires the Go backend' >&2; exit 2; fi
case "$target" in all|both) services=(backend frontend);; backend|frontend) services=("$target");; *) echo 'Target must be backend, frontend, or all' >&2; exit 2;; esac
owned_pid() {
  local service=$1 pid
  [[ -f "$RUN/$service.pid" ]] || return 1
  read -r pid < "$RUN/$service.pid"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null || return 1
  [[ "$(readlink "/proc/$pid/cwd")" == "$ROOT/$service" ]] || return 1
  printf '%s' "$pid"
}
for service in "${services[@]}"; do
  if [[ "$service" == backend && "$backend_mode" == go ]]; then
    if [[ "$runtime_profile" == foundation ]]; then
      python3 "$ROOT/scripts/framework/manage.py" "$command_name"
      continue
    fi
    case "$command_name" in
      start) python3 "$ROOT/scripts/runtime/manage.py" start --workers;;
      stop|status) python3 "$ROOT/scripts/runtime/manage.py" "$command_name";;
      logs) tail -n 60 "$RUN/go-runtime/api.log";;
      *) echo 'Usage: ./run.sh {start|stop|status|logs} [all|backend|frontend]' >&2; exit 2;;
    esac
    continue
  fi
  case "$command_name" in
    start)
      if pid=$(owned_pid "$service"); then echo "$service already running (PID $pid)"; continue; fi
      [[ -d "$ROOT/$service/node_modules" ]] || { echo "Run npm ci in $service first" >&2; exit 1; }
      if [[ "$service" == frontend ]]; then
        if [[ "$runtime_profile" == foundation ]]; then
          export AISOC_API_PROXY_TARGET="http://127.0.0.1:3003"
        elif [[ "$backend_mode" == go ]]; then
          release_port=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["api_port"]))' "$RUN/go-runtime/settings.json")
          export AISOC_API_PROXY_TARGET="http://127.0.0.1:$release_port"
        else
          export AISOC_API_PROXY_TARGET="http://127.0.0.1:3002"
        fi
      fi
      if [[ "$service" == backend ]]; then
        if [[ -f "$RUN/node-database-path" ]]; then
          read -r restored_database < "$RUN/node-database-path"
          restored_database=$(readlink -f "$restored_database")
          case "$restored_database" in "$RUN/"*) ;; *) echo 'Rollback database must be inside .run' >&2; exit 2;; esac
          [[ -f "$restored_database" ]] || { echo 'Rollback database is missing' >&2; exit 2; }
          export DATABASE_PATH="$restored_database"
        fi
        # Keep local app validation login-free; authentication remains opt-in.
        if [[ "${NODE_ENV:-}" == production ]]; then
          export AUTH_MODE="${AUTH_MODE:-token}"
        else
          export AUTH_MODE="${AUTH_MODE:-local}"
        fi
        if [[ -f "$RUN/auth/operators.json" ]]; then
          export AUTH_OPERATORS_FILE="${AUTH_OPERATORS_FILE:-$RUN/auth/operators.json}"
        fi
      fi
      if [[ "$service" == backend ]]; then url=http://127.0.0.1:3002/health; else url=http://127.0.0.1:8080; fi
      if curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then echo "$url is already occupied by an unmanaged service" >&2; exit 1; fi
      (cd "$ROOT/$service"; if [[ "$service" == backend ]]; then nohup setsid ./node_modules/.bin/tsx src/server.ts >"$RUN/$service.log" 2>&1 & else nohup setsid ./node_modules/.bin/vite --host 0.0.0.0 --port 8080 --strictPort >"$RUN/$service.log" 2>&1 & fi; echo $! >"$RUN/$service.pid")
      ready=false
      for attempt in {1..40}; do
        if curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then ready=true; break; fi
        sleep 0.25
      done
      if [[ "$ready" != true ]]; then echo "$service failed; see $RUN/$service.log" >&2; exit 1; fi
      echo "$service ready: $url";;
    stop)
      if pid=$(owned_pid "$service"); then
        kill -- "-$pid"
        for attempt in {1..40}; do
          if ! kill -0 -- "-$pid" 2>/dev/null; then break; fi
          sleep 0.25
        done
        if kill -0 -- "-$pid" 2>/dev/null; then echo "$service is still stopping; try status shortly" >&2; exit 1; fi
        rm -f "$RUN/$service.pid"
        echo "$service stopped"
      else echo "$service is not running"; fi;;
    status)
      if pid=$(owned_pid "$service"); then echo "$service running (PID $pid)"; else echo "$service stopped"; fi;;
    logs) tail -n 60 "$RUN/$service.log";;
    *) echo 'Usage: ./run.sh {start|stop|status|logs} [all|backend|frontend]' >&2; exit 2;;
  esac
done
