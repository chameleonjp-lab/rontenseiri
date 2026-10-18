#!/usr/bin/env python3
"""Run a command once, preserve its full output, and optionally summarize using RTK.

No external Python packages required. Designed for Codex Cloud/CLI and Work shells.
The complete unfiltered log is NEVER written to git automatically.
"""
from __future__ import annotations

import argparse
from collections import deque
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

MAX_DISPLAY_CHARS = 32000
MAX_TEST_TAIL_LINES = 24
MAX_TEST_TAIL_CHARS = 4000

# Only a warning/suppression safety net, NOT a comprehensive secret scanner.
SECRET_MARKERS = [
    re.compile(rb"(?i)(?:authorization\s*:\s*bearer\s+)[A-Za-z0-9._~+/-]{8,}"),
    re.compile(rb"(?i)\b(?:OPENAI_API_KEY|GITHUB_TOKEN|SUPABASE_SERVICE_ROLE_KEY|AWS_SECRET_ACCESS_KEY|PRIVATE_KEY|PASSWORD|ACCESS_TOKEN|API_KEY)\s*[:=]\s*[^\s]{8,}"),
    re.compile(rb"(?i)\b(?:ghp_|gho_|github_pat_|sb_secret_|sk-proj-)[A-Za-z0-9_\-]{8,}"),
]


def utc_stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def evidence_root(path: str | None) -> Path:
    if path:
        return Path(path).expanduser().resolve()
    if os.environ.get("RTK_SAFE_EVIDENCE_DIR"):
        return Path(os.environ["RTK_SAFE_EVIDENCE_DIR"]).expanduser().resolve()
    if os.environ.get("RUNNER_TEMP"):
        return Path(os.environ["RUNNER_TEMP"]).resolve() / "rtk-safe-evidence"
    # Outside the checkout, so `git add -A` will not include these logs.
    state = Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local" / "state")))
    return state / "rtk-safe-execution"


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def maybe_contains_secret(path: Path) -> bool:
    with path.open("rb") as stream:
        for line in stream:
            if any(p.search(line) for p in SECRET_MARKERS):
                return True
    return False


def make_label(s: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", s)[:42].strip("-")
    return cleaned or "run"


def execute(argv: list[str], log_path: Path, timeout: float | None) -> tuple[int, bool]:
    started = time.monotonic()
    timed_out = False
    with log_path.open("xb") as log:
        print("[rtk-safe] Command started; full stdout/stderr is saved outside git.", flush=True)
        try:
            proc = subprocess.Popen(
                argv,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=(os.name == "posix"),
            )
        except FileNotFoundError:
            log.write(b"Command executable not found.\n")
            return 127, False
        except PermissionError:
            log.write(b"Command executable not permitted.\n")
            return 126, False
        except OSError:
            log.write(b"Command could not be executed.\n")
            return 125, False

        last_notice = started
        try:
            while proc.poll() is None:
                elapsed = time.monotonic() - started
                if timeout is not None and elapsed > timeout:
                    timed_out = True
                    stop_process(proc)
                    break
                if elapsed - (last_notice - started) >= 60:
                    print(f"[rtk-safe] Still running ({int(elapsed)} s); output is being saved.", flush=True)
                    last_notice = time.monotonic()
                try:
                    proc.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    continue
        except KeyboardInterrupt:
            stop_process(proc)
            return 130, False
        return (124 if timed_out else normalize_status(proc.returncode)), timed_out


def stop_process(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(proc.pid, signal.SIGTERM)
        else:
            proc.terminate()
        proc.wait(timeout=5)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        if proc.poll() is None:
            if os.name == "posix":
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            else:
                proc.kill()
            proc.wait()


def normalize_status(rc: int | None) -> int:
    if rc is None:
        return 125
    return rc if rc >= 0 else 128 + abs(rc)


def summarize(raw: Path, destination: Path) -> tuple[str | None, str]:
    if not shutil.which("rtk"):
        return None, "RTK_NOT_INSTALLED"
    try:
        result = subprocess.run(
            ["rtk", "log", str(raw)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=45,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None, "RTK_SUMMARY_ERROR"
    if result.returncode != 0:
        return None, "RTK_SUMMARY_ERROR"
    destination.write_bytes(result.stdout)
    return result.stdout.decode("utf-8", "replace"), "RTK_LOG"


def display_summary(s: str) -> None:
    if len(s) <= MAX_DISPLAY_CHARS:
        print(s, end="\n" if not s.endswith("\n") else "")
    else:
        front = s[:6000]
        end = s[-20000:]
        print(front)
        print("\n[RTK-SAFE VIEW LIMIT: middle omitted from display only; full raw and RTK summary saved.]\n")
        print(end)


def bounded_test_tail(raw: Path) -> str:
    """Show a small raw test footer so RTK log cannot hide pass/fail totals.

    This is a convenience preview, never a replacement for reviewing raw.log.
    """
    with raw.open("r", encoding="utf-8", errors="replace") as source:
        tail = "".join(deque(source, maxlen=MAX_TEST_TAIL_LINES))
    if len(tail) > MAX_TEST_TAIL_CHARS:
        tail = "[Raw footer shortened for display only]\n" + tail[-MAX_TEST_TAIL_CHARS:]
    return tail


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("test", "list", "raw"), default="test")
    parser.add_argument("--label", default="run")
    parser.add_argument("--timeout", type=float, default=None, help="Optional seconds; timeout exits 124")
    parser.add_argument("--evidence-dir", default=None)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    argv = args.command[1:] if args.command and args.command[0] == "--" else args.command
    if not argv:
        parser.error("Provide a command after --, e.g. -- npm test")
    if args.timeout is not None and args.timeout <= 0:
        parser.error("--timeout must be greater than zero")

    os.umask(0o077)
    root = evidence_root(args.evidence_dir)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    run_dir = root / f"{utc_stamp()}-{make_label(args.label)}-{uuid.uuid4().hex[:8]}"
    run_dir.mkdir(mode=0o700)
    raw = run_dir / "raw.log"
    summary_path = run_dir / "rtk-summary.txt"
    metadata_path = run_dir / "metadata.json"
    start = now_iso()
    code, timed_out = execute(argv, raw, args.timeout)
    end = now_iso()

    raw_sha256 = hash_file(raw)
    warning_secret = maybe_contains_secret(raw)
    status = "RAW_MODE" if args.kind == "raw" else "UNPROCESSED"
    compact = None
    if not warning_secret and args.kind != "raw":
        compact, status = summarize(raw, summary_path)
    if warning_secret:
        status = "POSSIBLE_SECRET_DETECTED"

    metadata = {
        "schema_version": 1,
        "label": args.label,
        "kind": args.kind,
        "command_executable": Path(argv[0]).name,  # intentionally omits args (may contain secrets)
        "started_at_utc": start,
        "finished_at_utc": end,
        "exit_code": code,
        "timed_out": timed_out,
        "raw_sha256": raw_sha256,
        "raw_size_bytes": raw.stat().st_size,
        "summary_status": status,
        "possible_secret_marker": warning_secret,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"[rtk-safe] Exit code (original command): {code}")
    print(f"[rtk-safe] Unfiltered raw log: {raw}")
    print(f"[rtk-safe] Evidence metadata: {metadata_path}")
    print(f"[rtk-safe] SHA-256: {raw_sha256}")
    if warning_secret:
        print("[rtk-safe] WARNING: Possible credential found in raw output. Display suppressed; review privately. Do NOT upload/share automatically.")
    elif args.kind == "raw":
        print("[rtk-safe] RAW MODE: output below is NOT compressed by RTK.")
        print(raw.read_text(encoding="utf-8", errors="replace"))
    elif compact is not None:
        print(f"[rtk-safe] Condensed output (RTK log): {summary_path}")
        display_summary(compact)
    else:
        print(f"[rtk-safe] {status}: summary unavailable. Inspect the raw log; do NOT assume the command passed based on missing output.")
    # RTK's generic `log` filter groups severity lines and can omit Vitest or
    # Playwright result totals. Show a bounded raw footer for test commands.
    # Never display it when the limited secret-pattern guard warns.
    if args.kind == "test" and not warning_secret:
        footer = bounded_test_tail(raw)
        if footer:
            print("[rtk-safe] Raw test footer (bounded preview, not formal evidence):")
            print(footer, end="" if footer.endswith("\n") else "\n")
    if code != 0:
        print("[rtk-safe] FAILURE: inspect raw.log when condensed output is insufficient; do NOT rerun solely to recover output.")
    return code


if __name__ == "__main__":
    sys.exit(main())
