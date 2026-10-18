"""Regression tests: RTK log may omit Vitest / Playwright pass/fail totals."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

RUNNER = Path(__file__).resolve().parents[1] / "scripts" / "run.py"

class BoundedTestFooterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.evidence = self.base / "evidence"
        self.env = os.environ.copy()
        self.env["RTK_SAFE_EVIDENCE_DIR"] = str(self.evidence)
        rtk = self.bin / "rtk"
        rtk.write_text(f"#!{sys.executable}\nimport sys\nprint('Log Summary: 0 errors, 0 warnings, 0 info')\n", encoding="utf-8")
        rtk.chmod(0o755)
        self.env["PATH"] = f"{self.bin}:{self.env.get('PATH','')}"

    def run_child(self, code, kind="test"):
        return subprocess.run([sys.executable, str(RUNNER), "--kind", kind, "--", sys.executable, "-c", code], env=self.env, capture_output=True, text=True)

    def test_footer_preserves_test_totals_even_when_rtk_omits_them(self):
        result = self.run_child("import sys; print('Tests 3 failed / 120 passed'); sys.exit(7)")
        self.assertEqual(result.returncode, 7, result.stdout)
        self.assertIn("Log Summary: 0 errors", result.stdout)
        self.assertIn("Tests 3 failed / 120 passed", result.stdout)
        self.assertIn("Raw test footer", result.stdout)
        directory = next(self.evidence.iterdir())
        self.assertEqual((directory / "raw.log").read_text(), "Tests 3 failed / 120 passed\n")
        self.assertEqual(json.loads((directory / "metadata.json").read_text())["exit_code"],7)

    def test_footer_is_bounded_without_losing_full_raw_log(self):
        result = self.run_child("for i in range(500): print('run output line %d' % i)")
        self.assertEqual(result.returncode, 0)
        self.assertIn("run output line 499", result.stdout)
        self.assertNotIn("run output line 0\n", result.stdout)
        self.assertIn("run output line 476", result.stdout)
        self.assertNotIn("run output line 475\n", result.stdout)
        directory = next(self.evidence.iterdir())
        self.assertEqual(len((directory / "raw.log").read_text().splitlines()),500)

    def test_very_long_single_footer_line_is_bounded(self):
        result = self.run_child("print('A' * 10000)")
        self.assertEqual(result.returncode, 0)
        self.assertIn("Raw footer shortened for display only", result.stdout)
        self.assertLess(len(result.stdout), 5300)
        directory = next(self.evidence.iterdir())
        self.assertEqual((directory / "raw.log").stat().st_size,10001)

    def test_sensitive_output_suppresses_rtk_and_raw_footer(self):
        token = 'Authorization: Bearer abcdefghijklmnop'
        result = self.run_child(f"print({token!r})")
        self.assertEqual(result.returncode, 0)
        self.assertNotIn(token, result.stdout)
        self.assertNotIn('Raw test footer', result.stdout)
        self.assertIn('Possible credential', result.stdout)
        directory = next(self.evidence.iterdir())
        self.assertIn(token,(directory / 'raw.log').read_text())
        self.assertFalse((directory / 'rtk-summary.txt').exists())

if __name__ == '__main__':
    unittest.main()
