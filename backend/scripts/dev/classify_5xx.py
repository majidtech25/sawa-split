"""Lists every 5xx the API logged, with its exception, and classifies it.

A DB/network timeout (asyncpg TimeoutError, httpx ConnectTimeout, a closed connection) is
'timeout'; anything else is 'FAILURE', even if the suite's retry then succeeded.
Usage (from backend/): python3 scripts/dev/classify_5xx.py <api log>
The API log is uvicorn's output (or a verify_split_model.sh log, where the API runs in-process).
"""
import re
import sys

TIMEOUT = re.compile(
    r"^(builtins\.)?TimeoutError\b|^asyncio\.(exceptions\.)?TimeoutError\b|httpx\.(Connect|Read|Write|Pool)Timeout\b"
    r"|ConnectionDoesNotExistError|connection (was )?closed|ConnectionResetError|ConnectionRefusedError"
    r"|asyncpg\.exceptions\._base\.InterfaceError: connection is closed",
    re.I,
)
EXC_LINE = re.compile(r"^([A-Za-z_][\w.]*(Error|Exception|Timeout|Exit|Interrupt))(: .*)?$")


def blocks(lines):
    """Yields (header, traceback lines) for each 'Unhandled error on ...' record."""
    i = 0
    while i < len(lines):
        m = re.search(r"Unhandled error on (\S+ \S+)", lines[i])
        if not m:
            i += 1
            continue
        j = i + 1
        body = []
        while j < len(lines) and not re.match(r"^(INFO|WARNING|ERROR|CRITICAL|DEBUG):", lines[j]):
            body.append(lines[j].rstrip("\n"))
            j += 1
        yield m.group(1), body
        i = j


def main():
    lines = open(sys.argv[1], errors="replace").readlines()
    results = []
    for call, body in blocks(lines):
        excs = [l.strip() for l in body if EXC_LINE.match(l.strip())]
        frames = [l.strip() for l in body if l.strip().startswith('File "')]
        app_frames = [f for f in frames if "/sawa-split/backend/app/" in f]
        origin = (app_frames[-1] if app_frames else frames[-1] if frames else "?")
        kind = "timeout" if any(TIMEOUT.search(e) for e in excs) else "FAILURE"
        results.append((call, kind, excs[-1] if excs else "(no exception line)", origin))
    status_5xx = [l.strip() for l in lines if re.search(r'" 5\d\d ', l)]
    print(f"5xx responses logged: {len(status_5xx)}; unhandled-error records: {len(results)}")
    for call, kind, exc, origin in results:
        print(f"  [{kind}] {call}: {exc}\n      at {origin}")
    if len(status_5xx) > len(results):
        print("  5xx responses without an unhandled-error record (deliberate 5xx, e.g. 502 from Daraja handling):")
        for l in status_5xx:
            print("   ", l[:160])
    bad = sum(1 for r in results if r[1] == "FAILURE")
    print(f"FAILURES (non-timeout 5xx): {bad}")


main()
