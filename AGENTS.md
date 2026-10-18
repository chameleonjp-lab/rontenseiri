# Repository instructions: rontenseiri

- The authoritative product requirements and quality gates remain in `docs/requirements-and-development-plan.md`, `README.md`, and the existing `.github/workflows/ci.yml`. This file does not supersede them.
- The opt-in helper at `.agents/skills/rtk-safe-execution/SKILL.md` may be used to shorten verbose, non-sensitive local `npm test` output and safe `git ls-files` listings **while preserving the original raw output**.
- Run the existing approved command once. Do not add a second copy of the test run, shorten test coverage, skip failing checks, or change the underlying exit code.
- When tests fail or the brief output omits necessary context, inspect the saved `raw.log` before investigating or reporting. A condensed view is not evidence of success.
- The official CI, `npm audit`, Playwright evidence files, performance measurements, security and privacy checks, and release/approval gates must remain complete and uncompressed.
- Do not auto-install RTK, activate hooks, upload captured raw logs, change billing, or change Codex Cloud environment settings. Report when RTK is not present.
- Do not use this helper for commands that may print credentials, personally identifying information, conversation content, secret environment variables or private files.
- Review the pilot plan at `docs/development/rtk-safe-execution-pilot.md` before considering broader use.
