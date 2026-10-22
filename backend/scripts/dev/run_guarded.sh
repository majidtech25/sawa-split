#!/usr/bin/env bash
# Runs one command (a verify_* suite or the local API) under a wall-clock guard.
#
# `timeout` counts monotonic time, which stops while the host sleeps: on 2026-10-22 a run
# froze from ~16:00 to 23:33 and resumed long past the agreed 17:30 EAT cutoff, with its
# database connections dead. This guard watches the real clock instead:
#   - it refuses to start if the run could still be going at the cutoff (now + limit > cutoff);
#   - it stops the run (its whole process group) at the cutoff, or once the limit has passed
#     in wall-clock time, whichever comes first;
#   - it stops the run if the host slept (the wall clock jumped more than 2 minutes between
#     two checks 15 seconds apart): connections opened before a sleep can't be trusted;
#   - it prints a STALL line if the log hasn't grown for 10 minutes (and keeps running).
# Its own lines start with "GUARD", so a monitor can watch for them.
#
# Usage (from backend/): scripts/dev/run_guarded.sh <cutoff HH:MM, EAT> <limit seconds | 0 = until the cutoff> <log> -- <command...>
# Exit: the command's own exit code, or 125 if refused, 124 if stopped by the guard.
set -uo pipefail

[ $# -ge 5 ] && [ "$4" = "--" ] || { echo "usage: $0 <HH:MM> <limit s|0> <log> -- <command...>" >&2; exit 2; }
CUTOFF_HM=$1 LIMIT=$2 LOG=$3
shift 4
CUTOFF=$(TZ=Africa/Nairobi date -d "today $CUTOFF_HM" +%s) || exit 2
NOW=$(date +%s)
[ "$LIMIT" = 0 ] && LIMIT=$((CUTOFF - NOW))
if [ "$NOW" -ge "$CUTOFF" ] || [ $((NOW + LIMIT)) -gt "$CUTOFF" ]; then
  echo "GUARD refused: '$*' could still be running at $CUTOFF_HM EAT (now $(TZ=Africa/Nairobi date +%H:%M), limit ${LIMIT}s)" | tee -a "$LOG"
  exit 125
fi
DEADLINE=$((NOW + LIMIT))

echo "GUARD start $(TZ=Africa/Nairobi date +%H:%M:%S) EAT: '$*' (stops by $(TZ=Africa/Nairobi date -d @"$DEADLINE" +%H:%M:%S))" >>"$LOG"
setsid "$@" >>"$LOG" 2>&1 &
PID=$!

stop() {
  echo "GUARD stopped $(TZ=Africa/Nairobi date +%H:%M:%S) EAT: $1" | tee -a "$LOG"
  kill -TERM -- "-$PID" 2>/dev/null
  sleep 5
  kill -KILL -- "-$PID" 2>/dev/null
  wait "$PID" 2>/dev/null
  exit 124
}

LAST=$(date +%s)
GREW=$LAST
SIZE=0
WARNED=0
while kill -0 "$PID" 2>/dev/null; do
  sleep 15
  T=$(date +%s)
  [ $((T - LAST)) -gt 120 ] && stop "the host slept ~$((T - LAST))s (wall clock jumped); connections opened before it are stale"
  LAST=$T
  [ "$T" -ge "$CUTOFF" ] && stop "the $CUTOFF_HM EAT cutoff"
  [ "$T" -ge "$DEADLINE" ] && stop "the ${LIMIT}s wall-clock limit"
  S=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
  if [ "$S" != "$SIZE" ]; then SIZE=$S; GREW=$T; WARNED=0
  elif [ $((T - GREW)) -ge 600 ] && [ "$WARNED" = 0 ]; then
    echo "GUARD STALL: no output for $(( (T - GREW) / 60 )) minutes" | tee -a "$LOG"; WARNED=1
  fi
done
wait "$PID"
CODE=$?
echo "GUARD done $(TZ=Africa/Nairobi date +%H:%M:%S) EAT: exit $CODE" >>"$LOG"
exit "$CODE"
