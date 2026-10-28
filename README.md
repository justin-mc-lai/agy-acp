<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/header-image-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/header-image-light.png">
    <img alt="agy-acp" src="docs/assets/header-image-light.png">
  </picture>
  <br>
  agy-acp
</h1>

[ACP](https://agentclientprotocol.com) adapter for [Google Antigravity CLI](https://antigravity.google/product/antigravity-cli), bringing full Agent Client Protocol support to **Paseo**, **Zed**, and other ACP-compatible clients.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-161%20passed-brightgreen.svg)]()

---

## Highlights

- **Native SQLite Protobuf Streaming**: Decodes `agy` internal conversation state directly with sub-second latency, avoiding brittle terminal screen-scraping.
- **Interactive Permission Bridge**: Seamlessly translates sandbox permissions, bash execution approval, and `ask_question` menus to native ACP client dialogs.
- **Resilient Turn Lifecycle**: Accurately tracks multi-step tool execution loops and PTY idle prompts to prevent premature turn disconnection during long workflows.
- **ACP v1 & Draft v2**: Full support for both standard ACP v1 streaming and modern ACP v2 draft specs (session resume, message ID tracking, and live usage metrics).

---

## Installation

```sh
# Install globally
npm install -g agy-acp

# Or run directly on demand with npx
npx agy-acp
```

### Prerequisites

`agy-acp` uses your local `agy` CLI binary. If not found, it can auto-install the latest official release into `~/.local/bin/agy`.

You can also install `agy` manually:

```sh
# Official script
curl -fsSL https://antigravity.google/cli/install.sh | bash

# Homebrew
brew install antigravity-cli
```

---

## Client Configuration

### Paseo

Add Google Antigravity as an ACP Agent in Paseo:

```json
{
  "name": "Google Antigravity",
  "command": "agy-acp",
  "args": []
}
```

Or run via `npx`:

```json
{
  "name": "Google Antigravity",
  "command": "npx",
  "args": ["-y", "agy-acp"]
}
```

### Zed

Add `agy-acp` as a custom agent in Zed's `settings.json`:

```json
{
  "agent_servers": {
    "Google Antigravity": {
      "command": "agy-acp",
      "args": []
    }
  }
}
```

### Environment

| Variable | Default / notes |
|---|---|
| `PATH` | Must include `agy` if the editor doesn't inherit your shell `PATH` |
| `AGY_BIN` | Override the `agy` binary path |

## Architecture

```text
Zed / ACP client
  -> agy-acp (v1 or draft v2 from initialize)
  -> AcpAgent (sessions, config, prompt lifecycle)
  -> AgyCliSession (interactive agy PTY, --conversation id)
  -> agy --prompt-interactive ... --conversation <id> --sandbox ...
       \-> ~/.gemini/antigravity-cli/conversations/<id>.db
  -> StreamPoller + Translator -> ACP session/update notifications
```

- One interactive `agy` PTY per ACP session; conversation id is learned on the first turn
  and reused. PTY output is a diagnostic tail only — never parsed as agent text.
- Steps come from agy's conversation SQLite DB (structured protobuf records), not stdout.
- Config options: `mode` → `--mode`, `model` → `--model`, `reasoningEffort` → `--effort`
- Cancel: `SIGINT` then `SIGKILL`. `--sandbox` on by default; skip-permissions is opt-in.
- Session bindings persist under `~/.agy-acp-state` so list/load/resume survive restarts.
- **v1:** `session/load` replays history; `session/resume` reattaches without replay.
  **v2:** only `session/resume` — pass `replayFrom: { "type": "start" }` to replay.

Wire format decoding was cross-referenced with
[shubzkothekar/antigravity-acp](https://github.com/shubzkothekar/antigravity-acp) (MIT);
decoding code is our own.

## Development

```sh
npm run build && npm test
node dist/main.js

# smoke initialize
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' | node dist/main.js
```

## Disclaimer

Google's FAQ states that third-party tools to access Antigravity violate their
[Terms of Service](https://antigravity.google/terms) and may lead to account suspension.  
Prefer Vertex / AI Studio API keys for lower-risk use. Use this only on test/secondary
accounts.  

Provided as-is, no warranty. By using `agy-acp` you accept this notice and Google's ToS.  

**Use at your own risk.**