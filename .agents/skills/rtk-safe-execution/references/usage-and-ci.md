# Installation and CI integration (read when needed)

## What is installed where

- Codex looks for repository-scoped skills in `.agents/skills/<skill-name>/SKILL.md`. The repository copy can be reviewed in a PR before merging.
- Skill files are **instructions and helper code**, not the RTK binary. The runner requires Python 3; shortened reports require a working `rtk` executable on PATH.
- On Codex Cloud, prepare and publish an environment that has RTK installed from its reviewed official upstream release/build and verify `rtk --version`. No RTK installer is bundled here. Cloud setups and internet policies vary.
- RTK currently offers `rtk init --codex` for native Codex CLI hooks, but this skill deliberately does not turn on automatic hooks; combining a global hook with per-command evidence capture needs separate compatibility testing.
- In ChatGPT Work, the instructions can be useful even if a particular execution backend lacks a shell; do not promise that the Python runner can execute unless a suitable shell is available.

## Local evidence locations

1. Set `RTK_SAFE_EVIDENCE_DIR=/absolute/private/path` to choose the destination.
2. In GitHub Actions the default is `$RUNNER_TEMP/rtk-safe-evidence/`.
3. Otherwise the default is `$XDG_STATE_HOME/rtk-safe-execution/` or `~/.local/state/rtk-safe-execution/`.
4. Each command creates a unique directory with `raw.log`, `metadata.json` (includes SHA-256, time, real exit code), and `rtk-summary.txt` when filtering succeeds.
5. The files remain only as long as their local runtime and its storage. There is no automatic cross-task or long-term backup.

## Use with existing GitHub Actions

- First keep current Actions jobs and raw reports **unchanged**. Do not add redundant test jobs to achieve RTK output savings in Codex.
- If you later choose to archive a runner's `raw.log` in Actions, put it in a reviewed, existing workflow and upload it with an access-controlled artifact action. Review the log for credentials, privacy, and repo visibility before any upload.
- Public repository artifacts are available to people who can read the repo. An artifact is not an appropriate secret archive.
- Artifact retention policies expire, and upload artifacts are not an indefinite backup. If immutable long-term records are required, use an approved separate store with an explicit retention and access policy.
- Preserve test command exit status and existing quality gates; compression of AI-facing output must not alter the CI status.

## Compatibility and limits

- `rtk log <file>` works as an after-the-fact, duplicate-removing filter for one recorded execution. It does **not** necessarily output only failed tests. Do not imply this skill automatically saves a certain percentage of tokens.
- RTK `recall` may recover inputs from RTK's own store, but the runner's independent `raw.log` is the primary recovery evidence. Do not rely on RTK recall retention for formal archival.
- Avoid running interactive prompts, watch-mode tests, dev servers, or commands that require stdin: the runner deliberately uses a closed stdin.
- Combined stdout and stderr are captured byte-for-byte as sent to one output file, but the order when distinct streams are buffered may differ from what a human sees in a terminal.
- Do not use the runner for destructive commands or commands that print secrets. Its simple warning patterns are defense-in-depth, not a security guarantee.
