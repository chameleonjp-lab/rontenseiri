#!/usr/bin/env python3
"""Verify a recorded run's complete raw log against its SHA-256 metadata."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path, help="Path to a run's metadata.json")
    args = parser.parse_args()
    try:
        metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
        raw = args.metadata.parent / "raw.log"
        with raw.open("rb") as original:
            digest = hashlib.file_digest(original, "sha256").hexdigest()
        if digest != metadata["raw_sha256"] or raw.stat().st_size != metadata["raw_size_bytes"]:
            print("EVIDENCE_MISMATCH: raw.log differs from recorded SHA-256 or size")
            return 1
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"EVIDENCE_UNAVAILABLE: {type(exc).__name__}")
        return 2
    print(f"EVIDENCE_OK: {raw}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
