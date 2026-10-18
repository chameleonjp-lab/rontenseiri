"""Offline tests for the RTK safe runner. No RTK download or network needed."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

RUNNER = Path(__file__).resolve().parents[1] / "scripts" / "run.py"


class SafeRunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.evidence = self.base / "evidence"
        self.env = dict(os.environ)
        self.env["RTK_SAFE_EVIDENCE_DIR"] = str(self.evidence)

    def add_fake_rtk(self):
        target = self.bin / "rtk"
        target.write_text(
            f"#!{sys.executable}\n"
            "import pathlib, sys\n"
            "if len(sys.argv) == 3 and sys.argv[1] == 'log':\n"
            "    original = pathlib.Path(sys.argv[2]).read_text()\n"
            "    print('MOCK_RTK_SUMMARY:' + str(original.count('passed')) + ':passed-lines')\n"
            "else:\n"
            "    sys.exit(32)\n",
            encoding="utf-8",
        )
        target.chmod(0o755)
        self.env["PATH"] = f"{self.bin}:{os.environ.get('PATH', '')}"

    def run_cmd(self, kind, child, *, name="test", extra=None):
        args = [sys.executable, str(RUNNER), "--kind", kind, "--label", name]
        if extra:
            args.extend(extra)
        args += ["--", sys.executable, "-c", child]
        return subprocess.run(args, env=self.env, capture_output=True, text=True)

    def evidence_paths(self):
        dirs = list(self.evidence.iterdir())
        self.assertEqual(len(dirs), 1)
        return dirs[0], dirs[0] / "raw.log", dirs[0] / "metadata.json"

    def test_success_log_is_complete_and_rtk_is_used_only_afterwards(self):
        self.add_fake_rtk()
        result = self.run_cmd("test", "print('passed'); print('passed'); print('failed')")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("MOCK_RTK_SUMMARY:2:passed-lines", result.stdout)
        directory, raw, meta = self.evidence_paths()
        self.assertEqual(raw.read_text(), "passed\npassed\nfailed\n")
        self.assertTrue((directory / "rtk-summary.txt").exists())
        self.assertEqual(json.loads(meta.read_text())["exit_code"], 0)
        self.assertEqual(json.loads(meta.read_text())["summary_status"], "RTK_LOG")
        self.assertEqual(raw.stat().st_mode & 0o777, 0o600)
        verifier = Path(__file__).resolve().parents[1] / "scripts" / "verify.py"
        good = subprocess.run([sys.executable, str(verifier), str(meta)], capture_output=True, text=True)
        self.assertEqual(good.returncode, 0, good.stdout)
        raw.write_text("tampered evidence\n")
        bad = subprocess.run([sys.executable, str(verifier), str(meta)], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1, bad.stdout)

    def test_failure_keeps_child_exit_status_and_raw_error(self):
        self.add_fake_rtk()
        result = self.run_cmd("test", "import sys; print('failure details'); sys.exit(7)")
        self.assertEqual(result.returncode, 7, result.stdout)
        _, raw, meta = self.evidence_paths()
        self.assertEqual(raw.read_text(), "failure details\n")
        self.assertEqual(json.loads(meta.read_text())["exit_code"], 7)
        self.assertIn("FAILURE", result.stdout)

    def test_no_rtk_does_not_run_command_again_or_fake_summary(self):
        self.env["PATH"] = str(self.bin)
        result = self.run_cmd("list", "print('one time only')")
        self.assertEqual(result.returncode, 0)
        self.assertIn("RTK_NOT_INSTALLED", result.stdout)
        self.assertNotIn("one time only", result.stdout)
        _, raw, meta = self.evidence_paths()
        self.assertEqual(raw.read_text(), "one time only\n")
        self.assertEqual(json.loads(meta.read_text())["summary_status"], "RTK_NOT_INSTALLED")

    def test_raw_mode_does_not_filter(self):
        self.add_fake_rtk()
        result = self.run_cmd("raw", "print('original uncompressed audit line')")
        self.assertEqual(result.returncode, 0)
        self.assertIn("original uncompressed audit line", result.stdout)
        self.assertNotIn("MOCK_RTK_SUMMARY", result.stdout)
        _, raw, meta = self.evidence_paths()
        self.assertEqual(raw.read_text(), "original uncompressed audit line\n")
        self.assertEqual(json.loads(meta.read_text())["summary_status"], "RAW_MODE")

    def test_suspected_secret_does_not_print_or_summarize(self):
        self.add_fake_rtk()
        secret = "Authorization: Bearer abcdefghijklmnop"
        result = self.run_cmd("test", f"print({secret!r})")
        self.assertEqual(result.returncode, 0)
        self.assertNotIn(secret, result.stdout)
        self.assertIn("Possible credential", result.stdout)
        directory, raw, meta = self.evidence_paths()
        self.assertIn(secret, raw.read_text())
        self.assertFalse((directory / "rtk-summary.txt").exists())
        self.assertEqual(json.loads(meta.read_text())["summary_status"], "POSSIBLE_SECRET_DETECTED")

    def test_timeout_reports_124_and_retains_log(self):
        self.add_fake_rtk()
        result = self.run_cmd("test", "import time; print('begun', flush=True); time.sleep(3)", extra=["--timeout", "0.3"])
        self.assertEqual(result.returncode, 124, result.stdout)
        _, raw, meta = self.evidence_paths()
        self.assertIn("begun", raw.read_text())
        self.assertTrue(json.loads(meta.read_text())["timed_out"])


if __name__ == "__main__":
    unittest.main()
