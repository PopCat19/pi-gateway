#!/usr/bin/env bash
# Watchdog for pi-gateway
# Usage: ./watchdog.sh [--once]
#   --once: Check once and exit (for cron)
#   No args: Run as daemon (for systemd)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_GATEWAY="$SCRIPT_DIR/bin/pi-gateway.mjs"
PID_DIR="$(dirname "$SCRIPT_DIR")/run"
STATUS_FILE="$PID_DIR/status.json"

# Cooldown between restart attempts (seconds)
RESTART_COOLDOWN=30
MAX_RESTARTS=5
RESTART_WINDOW=300

mkdir -p "$PID_DIR"

log() {
	echo "[$(date -Iseconds)] $1"
}

get_pid() {
	if [ -f "$STATUS_FILE" ]; then
		local pid=$(jq -r '.pid // empty' "$STATUS_FILE" 2>/dev/null)
		if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
			echo "$pid"
			return 0
		fi
	fi
	echo ""
	return 1
}

is_running() {
	local pid=$(get_pid)
	[ -n "$pid" ]
}

get_restart_count() {
	local count_file="$PID_DIR/gateway.restarts"
	local count=0
	local now=$(date +%s)
	
	if [ -f "$count_file" ]; then
		while IFS=' ' read -r ts; do
			if [ $((now - ts)) -lt $RESTART_WINDOW ]; then
				((count++))
			fi
		done < "$count_file" 2>/dev/null || true
	fi
	echo $count
}

record_restart() {
	local count_file="$PID_DIR/gateway.restarts"
	local now=$(date +%s)
	
	echo "$now" >> "$count_file"
	
	local tmp=$(mktemp)
	while IFS=' ' read -r ts; do
		if [ $((now - ts)) -lt $RESTART_WINDOW ]; do
			echo "$ts" >> "$tmp"
		fi
	done < "$count_file" 2>/dev/null || true
	mv "$tmp" "$count_file"
}

start_gateway() {
	# Check restart limit
	local restarts=$(get_restart_count)
	if [ "$restarts" -ge $MAX_RESTARTS ]; then
		log "ERROR: Gateway exceeded max restarts ($MAX_RESTARTS in ${RESTART_WINDOW}s)"
		return 1
	fi
	
	log "Starting gateway..."
	
	node "$PI_GATEWAY" start 2>&1 | while read -r line; do
		log "[gateway] $line"
	done
	
	record_restart
	sleep 2
	
	if is_running; then
		log "Gateway started"
		return 0
	else
		log "ERROR: Failed to start gateway"
		return 1
	fi
}

stop_gateway() {
	local pid=$(get_pid)
	
	if [ -n "$pid" ]; then
		log "Stopping gateway (pid: $pid)..."
		node "$PI_GATEWAY" stop 2>/dev/null || true
		
		# Wait for graceful shutdown
		local timeout=10
		while [ $timeout -gt 0 ] && kill -0 "$pid" 2>/dev/null; do
			sleep 1
			((timeout--))
		done
		
		# Force kill if still running
		if kill -0 "$pid" 2>/dev/null; then
			kill -9 "$pid" 2>/dev/null || true
		fi
	fi
}

# Main loop
watchdog_daemon() {
	log "Gateway watchdog started"
	
	while true; do
		if ! is_running; then
			log "Gateway is down, restarting..."
			start_gateway
		fi
		sleep 10
	done
}

watchdog_once() {
	if ! is_running; then
		log "Gateway is down, restarting..."
		node "$PI_GATEWAY" start >/dev/null 2>&1 &
	fi
}

case "${1:-}" in
	--once)
		watchdog_once
		;;
	start)
		watchdog_daemon
		;;
	stop)
		stop_gateway
		log "Gateway watchdog stopped"
		;;
	status)
		if is_running; then
			local pid=$(get_pid)
			local port=$(jq -r '.port // "unknown"' "$STATUS_FILE" 2>/dev/null)
			echo "gateway: running (pid: $pid, port: $port)"
		else
			echo "gateway: stopped"
		fi
		;;
	*)
		echo "Usage: $0 {start|stop|status|--once}"
		echo "  start   - Run as daemon"
		echo "  stop    - Stop gateway"
		echo "  status  - Show status"
		echo "  --once  - Check once (for cron)"
		exit 1
		;;
esac