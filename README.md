# agent-cv

Generate a technical CV from your local project directories using AI.

Your real project history lives on your filesystem, not on GitHub. Pet projects that never got pushed, corporate work behind VPNs, weekend experiments in obscure frameworks. `agent-cv` scans your directories, delegates analysis to AI, and generates a structured CV that captures work you'd otherwise forget.

## Quick start

```bash
# Install
npm install -g agent-cv

# One command — scan, analyze, publish
agent-cv publish ~/Projects
# → Your portfolio is live at https://agent-cv.dev/yourusername

# Or generate a markdown CV (offline)
agent-cv generate ~/Projects --output cv.md

# Edit your profile
agent-cv config

# See your tech evolution
agent-cv stats

# What changed since last scan
agent-cv diff ~/Projects
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development (Bun, tests, workspace layout).

## How it works

```
agent-cv generate ~/Projects
  │
  ├── Scan: walks directories, detects projects by markers
  │   (package.json, Cargo.toml, go.mod, pyproject.toml, ...)
  │
  ├── Email picker: shows all git emails found, you confirm yours
  │   (saved for next time, supports multiple identities)
  │
  ├── Project selector: grouped by folder, searchable
  │   ★ = your commits, 💎 = forgotten gem, gray = not yours
  │
  ├── Agent picker: choose AI backend (Claude Code, Codex, Cursor, API)
  │
  ├── Analyze: each project sent to AI for summary + tech stack
  │   (results cached, only re-analyzes when code changes)
  │
  ├── Profile insights: AI generates bio, highlights, career narrative, skills
  │
  └── Render: structured markdown CV grouped by year
```

## Features

**Discovery**
- Detects 15+ project types (Node, Rust, Go, Python, Ruby, Java, Swift, Elixir, PHP, Docker...)
- Skips noise directories (node_modules, .git, dist, build, vendor, __pycache__)
- Nested project dedup (monorepo with sub-packages counted once)
- Parallel git operations (10 repos at a time)
- Language detection by file extensions when no project marker found

**Identity**
- Multiple git email support (work, personal, old addresses)
- Auto-discovers emails from git config (global + per-repo)
- Interactive email picker with search on every run
- `--email` flag for generating someone else's CV

**Project selection**
- Grouped by directory with group-level toggle
- Instant search (just start typing)
- Pre-selects your projects, grays out forks/clones
- Detects uncommitted changes as sign of your work
- Forgotten gems: flags old projects with real work you probably forgot

**Analysis**
- Auto-detects available AI: Claude Code → Codex → Cursor → API
- Claude Code gets full file access (richer analysis)
- API mode: OpenRouter, Anthropic, OpenAI, Ollama (any OpenAI-compatible endpoint)
- Privacy audit: .env files and hardcoded secrets excluded before AI sees anything
- Smart cache: re-analyzes only when code or prompt changes
- `--dry-run` to preview what would be sent

**Profile insights** (one LLM call after analysis)
- Professional bio (3-4 sentences, third person)
- Highlighted projects (best showcase picks)
- Career narrative arc
- Strongest skills (beyond just languages)
- Unique traits

**Output**
- Markdown CV grouped by year with Featured badges
- Career narrative and skills in header
- Social links (GitHub, LinkedIn, Twitter, Telegram, website)
- All data in one file: `~/.agent-cv/inventory.json`

## Commands

| Command | Description |
|---------|-------------|
| `agent-cv generate <dir>` | Full flow: scan → pick emails → pick projects → analyze → CV |
| `agent-cv publish [dir]` | Publish your portfolio to [agent-cv.dev](https://agent-cv.dev) |
| `agent-cv unpublish` | Remove your portfolio from agent-cv.dev |
| `agent-cv config` | Edit your profile: name, bio, socials, email privacy |
| `agent-cv diff [dir]` | Show new/updated/removed projects since last scan |
| `agent-cv stats` | Tech evolution timeline, language breakdown, framework ranking |

## Flags

```
generate:
  --output <file>    Write to file instead of stdout
  --agent <name>     Force agent: claude, codex, cursor, api, auto (default: auto)
  --dry-run          Preview what would be sent to AI, no actual calls
  --no-cache         Force fresh analysis, ignore cached results
  --all              Skip project picker, include everything
  --email <emails>   Override emails (comma-separated)

publish:
  --all              Skip project picker, include everything
  --agent <name>     Force agent: claude, codex, cursor, api, auto
  --email <emails>   Override emails (comma-separated)
  --no-open          Don't open browser after publish
```

## AI setup

`agent-cv` auto-detects what you have. In priority order:

| Agent | How to set up |
|-------|--------------|
| Claude Code | [Install Claude Code](https://claude.ai/claude-code). Best results (reads files directly). |
| Codex CLI | `npm install -g @openai/codex` |
| Cursor Agent | [Install Cursor](https://cursor.com). Uses `agent --trust -p` headless mode. |
| OpenRouter | `export OPENROUTER_API_KEY=...` (one key, all models) |
| Anthropic | `export ANTHROPIC_API_KEY=...` |
| OpenAI | `export OPENAI_API_KEY=...` |
| Ollama | `export AGENT_CV_BASE_URL=http://localhost:11434/v1` (no key needed) |

## Tech stack

Built with [Bun](https://bun.sh), [Ink](https://github.com/vadimdemedes/ink) (React for terminal), [Commander](https://github.com/tj/commander.js), [Zod](https://zod.dev), and [simple-git](https://github.com/steveukx/git-js).

## License

[Proprietary](LICENSE). Source available for reference. Use is subject to the [agent-cv Terms of Service](https://agent-cv.dev/terms).
