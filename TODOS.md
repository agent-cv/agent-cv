# TODOS

## Agent CLI stability monitoring
**Priority:** P2 | **Effort:** S (human: ~1 day / CC: ~10 min) | **Depends on:** v0b (multiple adapters)

Agent CLIs (`claude -p`, `codex exec`, `cursor`) have no stable contract. Output formats change between versions. Add version detection for each agent adapter:
- Before delegating, run `claude --version` / `codex --version` and check against a tested-versions list in the adapter
- If version is untested, warn: "Claude Code v4.2 detected. Tested with v4.0-4.1. Output parsing may fail."
- Keep tested version ranges in each adapter file (easy to update)

**Why:** The outside voice in the CEO review correctly identified this as a fragile integration point. Without version checking, a Claude Code update could silently break analysis output parsing with no actionable error message.

## Inventory schema migration system
**Priority:** P1 | **Effort:** S (human: ~0.5 day / CC: ~5 min) | **Depends on:** v0a (inventory is core)

Add a `version` field to inventory.json and a migration function that runs on load. When schema changes, bump version and add a migration step. Prevents old inventory files from breaking on upgrade.

## Cost estimation before LLM analysis
**Priority:** P2 | **Effort:** S (human: ~0.5 day / CC: ~5 min) | **Depends on:** v0b (API adapter)

Show estimated API cost before running analysis: "Analyzing 30 projects will use ~120K tokens (~$0.36). Proceed?" Only relevant for API mode (agent delegation has no per-token costs).

## GitHub API token support
**Priority:** P2 | **Effort:** S (human: ~0.5 day / CC: ~5 min) | **Depends on:** none

Support `GITHUB_TOKEN` env var for authenticated GitHub API requests (5000 req/hour vs 60 unauthenticated). Pass as `Authorization: Bearer` header in `enrichGitHubData()`. Rate limit detection already exists (added with pipeline error handling), this just raises the ceiling.

**Why:** Users with 60+ repos hit the unauthenticated rate limit and get partial data. The rate limit detection stops early instead of failing silently, but token support would prevent hitting the limit at all.

## Prompt injection defense for team mode
**Priority:** P3 | **Effort:** M (human: ~3 days / CC: ~30 min) | **Depends on:** team mode (v2+)

When scanning repos you don't own, malicious README/code could inject prompts into the LLM context. Add content sanitization: escape markdown, truncate suspicious patterns, sandbox the analysis prompt.
