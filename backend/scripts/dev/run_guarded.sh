#!/usr/bin/env bash
# Runs one command (a verify_* suite or the local API) under a wall-clock guard.
#
# `timeout` counts monotonic time, which stops while the host sleeps: on 2026-10-22 a run
# froze from ~16:00 to 23:33 and resumed long past the agreed 17:30 EAT cutoff, with its
# database connections dead. This guard watches the real clock instead:
#   - the cutoff is the next HH:MM EAT; it refuses to start between the cutoff and 18:00, or if
#     the run could still be going at the cutoff (now + limit > cutoff);
#   - it stops the run (TERM to its process group, KILL only after up to 3 minutes for the
#     suite's own cleanup trap) at the cutoff, or once the limit has passed
#     in wall-clock time, whichever comes first;
#   - it stops the run if the host slept (the wall clock jumped more than 2 minutes between
#     two checks 15 seconds apart): connections opened before a sleep can't be trusted;
#   - it prints a STALL line if the log hasn't grown for 10 minutes (and keeps running).
# Its own lines start with "GUARD", so a monitor can watch for them.
#
# Usage (from backend/): export GUARD_LAUNCHED_AT=$(date +%s); <setup, e.g. source .env>; scripts/dev/run_guarded.sh <cutoff HH:MM, EAT> <limit seconds | 0 = until the cutoff> <log> -- <command...>
# Exit: the command's own exit code, or 125 if refused, 124 if stopped by the guard.
set -uo pipefail

[ $# -ge 5 ] && [ "$4" = "--" ] || { echo "usage: $0 <HH:MM> <limit s|0> <log> -- <command...>" >&2; exit 2; }
CUTOFF_HM=$1 LIMIT=$2 LOG=$3
shift 4
# The cutoff is the NEXT HH:MM EAT (tomorrow's once today's has passed), but nothing starts
# between it and the 18:00 sweep: a run must never overlap 17:30-18:00.
NOW=$(date +%s)
CUTOFF=$(TZ=Africa/Nairobi date -d "today $CUTOFF_HM" +%s) || exit 2
SWEEP=$(TZ=Africa/Nairobi date -d "today 18:00" +%s)
if [ "$NOW" -ge "$CUTOFF" ] && [ "$NOW" -lt "$SWEEP" ]; then
  echo "GUARD refused: '$*' would run between $CUTOFF_HM and the 18:00 EAT sweep" | tee -a "$LOG"
  exit 125
fi
[ "$NOW" -ge "$CUTOFF" ] && CUTOFF=$(TZ=Africa/Nairobi date -d "tomorrow $CUTOFF_HM" +%s)
# A sleep before the loop below starts (2026-10-23: launched 23:03, started 23:48) is caught
# only if the launcher records its own time first: GUARD_LAUNCHED_AT=$(date +%s) as the very
# first thing in the launch command. More than 2 minutes between that and now means the host slept.
if [ -n "${GUARD_LAUNCHED_AT:-}" ] && [ $((NOW - GUARD_LAUNCHED_AT)) -gt 120 ]; then
  echo "GUARD refused: the host slept before the guard started (launched $(TZ=Africa/Nairobi date -d @"$GUARD_LAUNCHED_AT" +%H:%M:%S), started $(TZ=Africa/Nairobi date +%H:%M:%S) EAT)" | tee -a "$LOG"
  exit 125
fi
[ -n "${GUARD_LAUNCHED_AT:-}" ] || echo "GUARD note: GUARD_LAUNCHED_AT not set; a sleep before the start can't be detected" >>"$LOG"
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
  # The suites clean up from an EXIT trap (a fresh psql connection), which TERM starts:
  # give it up to 3 minutes before KILL, which would cut it off (2026-10-24, run 4's rows left).
  for _ in $(seq 36); do kill -0 "$PID" 2>/dev/null || break; sleep 5; done
  kill -0 "$PID" 2>/dev/null && echo "GUARD cleanup did not finish in 3 minutes; killed, the run's rows may be left" | tee -a "$LOG"
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
