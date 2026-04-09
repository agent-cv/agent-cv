# OpenRouter Insights Generator

This script generates project insights using OpenRouter API. It allows testing different models and calculating costs.

## Setup

1. Install dependencies:
```bash
npm install @openrouter/client
```

2. Set your OpenRouter API key:
```bash
export OPENROUTER_API_KEY=your_api_key_here
```

3. Configure models in `config/openrouter.json` (already set up with common models)

## Usage

### Basic usage (uses default model - claude-3-haiku):
```bash
node scripts/generate-insights.ts
```

### Specify a model:
```bash
# Claude 3 Haiku (cheapest)
node scripts/generate-insights.ts claude-3-haiku

# GPT-4o Mini (very cheap)
node scripts/generate-insights.ts gpt-4o-mini

# Claude 3 Opus (most capable)
node scripts/generate-insights.ts claude-3-opus

# Gemini 1.5 Flash
node scripts/generate-insights.ts gemini-1.5-flash
```

### Available models:
- `claude-3-haiku` - $0.25/M tokens (fastest, cheapest)
- `gpt-4o-mini` - $0.15/M tokens (very cost-effective)
- `gemini-1.5-flash` - $0.35/M tokens
- `gpt-3.5-turbo` - $0.50/M tokens
- `claude-3-opus` - $15.00/M tokens (most capable)

## Output

The script generates a new inventory file with insights:
- `inventory-with-insights-claude-3-haiku.json`
- `inventory-with-insights-gpt-4o-mini.json`
- etc.

## Cost Analysis
The script automatically calculates:
- Total tokens used
- Cost per project
- Total cost for all projects

## Example Output

```bash
Using model: Claude 3 Haiku ($0.25/M tokens)
Loaded inventory with 25 projects
Generating insights for: agent-cv
Generating insights for: agent-cv-web
...

Saved inventory with insights to: inventory-with-insights-claude-3-haiku.json
Processing time: 12.4 seconds

Cost analysis for claude-3-haiku:
- Projects: 25
- Tokens per project: ~5000
- Total tokens: 125,000
- Cost per project: $0.00125
- Total cost: $0.0313
```

## Requirements

- Node.js 18+
- OpenRouter API key
- inventory.json file in project root