# LLM Wordle Arena

A performance testing arena for Large Language Models (LLMs) playing Wordle. This project simulates multiple rounds of Wordle games across different LLM models to compare their puzzle-solving capabilities.

## Features

- Supports multiple LLM models via OpenRouter API
- Runs configurable number of rounds per model (default: 100)
- Tracks detailed performance metrics:
  - Win rate percentage
  - Average guesses per win
  - Guess distribution (1-6 attempts)
  - Error tracking
- Generates comprehensive rankings and results
- Saves detailed results to JSON files

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up your OpenRouter API key:
```bash
cp .env.example .env
# Edit .env and add your OpenRouter API key
```

3. Get your API key from [OpenRouter](https://openrouter.ai/keys)

## Usage

### Run the full arena (100 rounds per model):
```bash
npm run arena
```

### Run with custom number of rounds:
```bash
node arena.js 50
```

### Test with specific models:
Edit the `models` array in `arena.js` to customize which models to test.

## Models Included

Default models tested:
- Anthropic Claude 3.5 Sonnet
- OpenAI GPT-4o
- OpenAI GPT-4o Mini  
- Meta Llama 3.1 70B
- Google Gemini Pro 1.5
- Mistral 7B Instruct

Additional model configurations available in `config.js`.

## How It Works

1. **Game Simulation**: Each model plays Wordle with randomly selected target words
2. **Prompt Engineering**: Models receive structured prompts with game rules and previous guess feedback
3. **Performance Tracking**: Win rates, guess distributions, and errors are tracked
4. **Ranking System**: Models ranked primarily by win rate, with average guesses as tiebreaker
5. **Results Export**: Detailed game logs saved to timestamped JSON files

## Sample Output

```
Testing anthropic/claude-3.5-sonnet...
  Round 10/100
  Round 20/100
  ...

anthropic/claude-3.5-sonnet Results:
  Win Rate: 85.0% (85/100)
  Average Guesses (wins): 4.2
  Errors: 0
  Guess Distribution: {"1":0,"2":5,"3":25,"4":35,"5":20,"6":0}

=== FINAL RANKINGS ===
1. anthropic/claude-3.5-sonnet
   Win Rate: 85.0%
   Avg Guesses: 4.2
   Errors: 0
```

## Configuration

- **Models**: Modify model lists in `config.js`
- **Rounds**: Change default rounds in `ARENA_CONFIG`
- **Timeouts**: Adjust API timeouts and delays in config
- **Prompts**: Customize the game prompts in `arena.js`

## Files

- `arena.js` - Main arena runner and game logic
- `wordle.js` - Wordle game implementation
- `openrouter.js` - OpenRouter API client
- `config.js` - Model and arena configuration
- `.env` - API keys (create from .env.example)

## Requirements

- Node.js 16+
- OpenRouter API key
- Internet connection for API calls

## Cost Considerations

Running 100 rounds across 6 models = 600 API calls. Estimated costs vary by model:
- Budget models: ~$0.50-1.00 total
- Premium models: ~$5.00-15.00 total

Check OpenRouter pricing for current rates.

## Testing

- Run all tests:
  - `npm test` (uses Node’s built-in test runner)
- Notes:
  - Tests avoid real network calls and run fully in-process.
  - The server does not auto-listen during tests (`NODE_ENV=test`).

## Docker

- Build the runtime image:
  - `docker build -t llm-wordle-arena .`
- Run the server on port 8080:
  - `docker run -p 8080:8080 --env OPENROUTER_API_KEY=... llm-wordle-arena`
- Healthcheck probes `/api/leaderboard` (or `/leaderboard`).
- Optional test target:
  - Build and run tests via the `test` stage:
    - `docker build --target test -t llm-wordle-arena:test .`
    - `docker run --rm llm-wordle-arena:test`

## CI/CD: Auto‑deploy on passing CI

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that deploys to your VM when the `CI` workflow passes on `main`.

How it works:
- The `CI` workflow runs tests on every push/PR.
- On `main` success, `Deploy to VM` triggers via `workflow_run` and SSHes into your VM.
- It clones/updates `/opt/llm-wordle-arena`, ensures a `.env` is present, and runs `docker compose up -d --build`.

VM prerequisites:
- Docker Engine + Compose plugin installed (check with `docker compose version`).
- A `deploy` user with key‑based SSH access from GitHub Actions and in the `docker` group.
- `.env` created in `/opt/llm-wordle-arena` with your runtime secrets (see `.env.example`).

Setup steps:
1) Create deploy user and SSH key
   - `sudo adduser --disabled-password --gecos "" deploy`
   - `sudo usermod -aG docker deploy`
   - Add the public key to `/home/deploy/.ssh/authorized_keys`
   - Add the matching private key to the repo secrets as `DEPLOY_KEY`

2) Install Docker + Compose
   - `curl -fsSL https://get.docker.com | sh`
   - `sudo usermod -aG docker $USER && newgrp docker`
   - Verify: `docker compose version`

3) Prepare app directory and env
   - `sudo mkdir -p /opt/llm-wordle-arena && sudo chown -R deploy:deploy /opt/llm-wordle-arena`
   - `cd /opt/llm-wordle-arena && touch .env` (populate with required vars)

4) Configure GitHub Secrets
   - `DEPLOY_HOST`: VM IP/hostname
   - `DEPLOY_USER`: `deploy`
   - `DEPLOY_KEY`: private key for the deploy user
   - `DEPLOY_PORT` (optional): SSH port (default 22)

That’s it — merges to `main` that pass CI will auto‑deploy.
