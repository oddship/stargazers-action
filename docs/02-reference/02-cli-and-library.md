---
title: CLI and library usage
description: Run stargazers-action outside a workflow.
---

# CLI and library usage

Besides the GitHub Action surface, this repo also exposes:

- a CLI entrypoint for cron jobs and scripts
- a repo-local library surface for Node/TypeScript code

## Current packaging status

This project is **not published to npm yet**. Treat the CLI and library as repo-local surfaces for a checked-out copy of the repository.

## Build

```bash
npm install
npm run build
```

## CLI

Use the built CommonJS entrypoint directly:

```bash
node dist/cli.cjs generate --config .github/stargazers.yml --token "$GITHUB_TOKEN"
node dist/cli.cjs discord --config .github/stargazers.yml --discord-webhook-url "$DISCORD_WEBHOOK_URL"
node dist/cli.cjs generate-and-discord --config .github/stargazers.yml
```

Example local notification flow with file-backed state:

```bash
node dist/cli.cjs discord \
  --owner oddship \
  --repo-exclude oddship.net,stargazers-action \
  --state-backend file \
  --state-path .stargazers/state.json \
  --discord-webhook-url "$DISCORD_WEBHOOK_URL" \
  --token "$GITHUB_TOKEN"
```

## Library

The reusable code lives behind `dist/lib.js` after a build.

```ts
import { execute, resolveConfig, consoleLogger } from "./dist/lib.js";

const config = await resolveConfig({
  mode: "generate-and-discord",
  owner: "oddship",
  json_output: "src/generated/github-stars.json",
  feed_output: "public/feeds/github-stars.xml",
  site_url: "https://oddship.net",
  state_backend: "file",
  state_path: ".stargazers/state.json",
  discord_webhook_url: process.env.DISCORD_WEBHOOK_URL,
  token: process.env.GITHUB_TOKEN,
});

const result = await execute(config, consoleLogger);
console.log(result.newEvents.length);
```

Useful exports:

- `resolveConfig(...)`
- `execute(...)`
- `fetchStarsSnapshot(...)`
- `renderRssFeed(...)`
- `buildDiscordMessages(...)`
- `loadState(...)`
- `saveState(...)`
- `diffSnapshotAgainstState(...)`
