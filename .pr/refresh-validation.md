# PR #763 refresh — October 23, 2026

Refreshed PR head `e7ae8404fb37f15e7680d147314a6fe475793aa8` against
`main` at `2e1100eec565e22309ae8c6bd931a4594459b1f1`. This resolves the
merge conflicts, keeps the current SDK/tool/server pins at 1.57.0 and moves the
unreleased profile migration to 196, after main's 195. Released migrations are
unchanged. The two acceptance tracks are enterprise #59 (selected tools survive
launch) and #758 (safe interpretation and rollout of legacy profile data).

## Before and after

The same probe called the production launch builder in separate main/candidate
worktrees, then finalized its result with SDK 1.57.0. Provider and sandbox
services were stubbed for this comparison; it made no model requests.

| Profile selection | Current main | Refreshed PR |
| --- | --- | --- |
| `[]` | Terminal, editor, task tracker, browser | No selected tools |
| Terminal, editor, task tracker | Adds browser | Exactly the three selected tools |

See `tool-selection-comparison.json` and `tool_selection_probe.py`.
The optional child-conversation launcher also leaves explicit tool lists intact.
Default-tool launches can still receive the configured launcher.

## Real HTTP and model validation

`http-profile-refresh-results.json` records nine passing cases on the released
SDK/agent-server 1.57.0. The harness uses real PostgreSQL, organization permissions,
the production profile router/resolver/conversation builder, and a separately
running agent server over HTTP. A generated bearer identity replaces Keycloak.

- Two identically configured profiles preserve empty selections, persona,
  profile/runtime suffixes, MCP selection and allowed secrets.
- A coding profile reaches the runtime with exactly terminal, file editor and
  task tracker; browser tools are absent. A `tools: null` profile still receives
  defaults, including browser tools.
- Dangling MCP references and missing profiles reject launch. Ordinary settings
  remain readable for repair.
- A future-version profile survives saving another profile; selecting it rejects
  launch without a fallback to broader settings.
- An ACP profile creates successfully with empty MCP and secret selections. This
  does not exercise an authenticated external ACP CLI turn.
- Azure-hosted `openai/deepseek-v4-1-flash` executes the real stdio MCP `qa_echo`
  tool, returns `ENTERPRISE_PROFILE_QA_OK`, and finishes. This small task does not
  establish that Azure's 20,000 TPM quota is sufficient for ordinary coding runs.

Runtime conversations, the isolated server, temporary runtime state and the test
PostgreSQL instance were removed. No Replicated instance or production resource
was changed. This is not a deployed Keycloak/Canvas/Kubernetes acceptance test.

The refresh preserves main's Azure DevOps credential-helper masking: setup has
already written that token to the workspace, so it stays registered for masking
even with a scoped profile. Regression tests cover both ordinary and ACP agents,
while excluding an unselected API secret. Profile secret selection does not
revoke credentials already present in a workspace; see the upgrade guide.

## Automated validation

All **8,295 backend tests pass**, with **75.86% branch-aware coverage** against
the 72% CI threshold. The final full run took 241.66 seconds.

- Python 3.12.13, uv 0.13.5, Node 22.23.4, PostgreSQL 16.
- Frontend: production build, lint/typecheck, standalone TypeScript checking and
  translation completeness pass. Tests: 363 files and 3,231 tests pass; 2 files
  skipped, 2 expected failures, 28 skipped tests and 24 todos.
- All Python pre-commit hooks pass, including mypy across the configured backend
  source directories.
- Migration integrity and the workflow's release/image version checks pass.
- `migration-refresh-results.json`: six passing PostgreSQL checks across pg8000
  and psycopg2, each upgrading an empty database to 196, downgrading to 195, and
  upgrading back to 196.
- The PostgreSQL regression test upgrades encrypted profile envelopes from both
  192 (the test pool's database baseline) and 195. Legacy empty selections become
  unset; current intentional empty selections, future/invalid profiles and the
  active pointer survive. The focused upgrade/user-context run passes 16 tests.

The full backend command matches CI's coverage options with four workers:

```sh
TMPDIR=/tmp uv run --locked pytest -q -n 4 --dist worksteal tests/unit \
  --cov --cov-branch --cov-fail-under=72 --tb=short
```

`TMPDIR=/tmp` accommodates a pre-existing Linux-path assumption on macOS. Remote
GitHub Actions have not run on this refresh. The user requested a local commit
and will authorize any push separately.

## Reproduction and rollout

With locked dependencies installed, run the HTTP harness using an existing saved
LLM profile (`QA_LLM_PROFILE_DIR`, `QA_LLM_PROFILE`, `QA_CIPHER_KEY_FILE`), or supply
an LLM configuration through `QA_LLM_JSON` in the environment. Never commit real
credentials. The wrapper creates an isolated loopback server and removes it on
completion; private server logs stay under `.pr/logs/`.

```sh
PYTHONPATH=. uv run --locked python .pr/run_agent_profile_http_qa.py
PYTHONPATH=. uv run --locked python .pr/migration_matrix_qa.py
```

Follow `docs/agent-profile-upgrade.md` before deployment: back up the database and
encryption configuration, freeze profile/settings writes, stop old writers,
audit, migrate, cut over all writers, verify runtime image pins, then unfreeze.
Downgrading Alembic is not a data rollback. Canvas's default-profile/editor work
and exact MCP inheritance within SDK delegates remain separate upstream work.
