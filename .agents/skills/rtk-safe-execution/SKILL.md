---
name: rtk-safe-execution
description: Safely run verbose tests and read long file lists in Codex Cloud, Codex CLI, or ChatGPT Work. Preserve complete unfiltered stdout/stderr and real exit codes while showing shorter RTK output. Use for tests and non-sensitive lists; do not compress security audits, credential-bearing output, or official CI evidence.
---

# RTK Safe Execution

## Purpose

Minimize command output supplied to an AI assistant **without sacrificing original evidence**. The included Python runner executes each command exactly once, writes complete stdout/stderr to a private file *outside the Git working tree* by default, and then calls `rtk log` on that file for a shorter AI-facing report. The command's **original** exit status controls success/failure. RTK's generic `log` filter mainly deduplicates lines; do not claim the same savings or semantic test filtering as `rtk test` without measurement.

## Activation and boundaries

- Use this skill for long `npm test`, `pnpm test`, `pytest` etc. output and safe, non-secret lists such as `git ls-files`.
- Start with `--kind test` and `--kind list` only. Do not automatically rewrite arbitrary commands or install RTK hooks.
- Security audits, authorization changes, deployment evidence, GitHub Actions' official tests, credential inspection and irreversible operations must continue through their established workflows, with unfiltered evidence. Do not claim that a shortened report is an authoritative audit result.
- Never run commands that dump environment variables, `.env`, credentials, access tokens, or private keys using this skill. A limited credential-pattern check exists, but is NOT complete sanitization.
- Do not upload, commit, or share `raw.log` unless privacy and access control have been reviewed. On public repos, GitHub Actions artifacts may be readable by anyone.
- Installing or enabling external programs, GitHub workflows, network access, or account billing requires separately authorized setup. This skill itself has no installation side effects.

## Workflow

1. Resolve this skill's directory (`SKILL_DIR`) from the location of its `SKILL.md`; work from the repository root.
2. Confirm Python 3 and whether `rtk --version` succeeds. If RTK is missing, **do not silently install it**. The runner still captures a full log and tells you no summary was made.
3. Choose the existing approved test command from `package.json`, documented repo instructions, or workflows. **Do not invent or expand the test matrix.**
4. Run a command once, with arguments separated after `--` (no shell interpolation). Examples:

   ```bash
   python3 "$SKILL_DIR/scripts/run.py" --kind test --label unit -- npm test
   python3 "$SKILL_DIR/scripts/run.py" --kind list --label tracked-files -- git ls-files
   python3 "$SKILL_DIR/scripts/run.py" --kind test --label regression --timeout 1200 -- pnpm test
   ```

5. Read the status and short RTK output. An exit code other than zero remains a failure, regardless of whether RTK prints an error. Check the command's `raw.log` if there is a failure, mismatch, ambiguous summary, missing stack trace, or any reason to suspect omitted information. Inspect the raw file selectively (e.g. known error line and neighboring lines); do not immediately rerun the command.
6. Verify the raw SHA-256 and the metadata file when reporting findings, using `python3 "$SKILL_DIR/scripts/verify.py" /path/to/metadata.json` when appropriate. The raw log is **local evidence**, not guaranteed durable across separate cloud tasks.
7. Keep official CI test and audit results unchanged. For long-lived evidence use the repository's existing trusted CI artifacts/archives after checking sensitivity and retention. Do not substitute this runner for official CI.
8. When finishing, report: test command (if safe to disclose), original exit status, whether RTK was available, complete log path, what evidence was inspected, and any verification gap. **Do not report measured savings without actually measuring them.**

## Failure handling

- Missing RTK: the command still runs once, raw output is retained, and a clear warning is printed; no automatic fallback to a misleading summary.
- RTK's generic `log` filter may omit test summaries such as `Tests 3 failed`. For `--kind test`, this runner also displays the last 24 raw-output lines (up to 4,000 characters) after RTK filtering. This is a bounded preview only; on failure, inspect the complete raw log before diagnosis.
- RTK failure: the original command status remains authoritative. Inspect raw output; do not label the run successful solely because filtering failed.
- Possible credential marker: the runner suppresses showing the log and summary. Review locally before any sharing; pattern matching cannot guarantee the log is safe.
- Timeout: optional `--timeout SECONDS` returns code 124 and records the raw log. Do not silently reinterpret a timeout as a passing test.
- A change in the runner or skill requires rerunning its bundled self-tests (below).

## Validate the bundled helper

```bash
python3 -m unittest discover -s "$SKILL_DIR/tests" -v
```

## Additional instructions

Read `references/usage-and-ci.md` only when configuring GitHub Actions, longer-term evidence retention, or a Codex Cloud environment. Avoid duplicating this skill's full contents in `AGENTS.md`; instead refer to it by name and use case.
