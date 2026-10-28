#!/usr/bin/env bash
# Local service manager, following AgentGuard's start/stop/status/logs interface.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$ROOT/.run"
mkdir -p "$RUN"
command_name=${1:-start}
target=${2:-all}
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
  case "$command_name" in
    start)
      if pid=$(owned_pid "$service"); then echo "$service already running (PID $pid)"; continue; fi
      [[ -d "$ROOT/$service/node_modules" ]] || { echo "Run npm ci in $service first" >&2; exit 1; }
      if [[ "$service" == backend ]]; then
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
