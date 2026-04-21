# stargazers-action

Generate recent GitHub stargazer data and optional Discord notifications.

**Docs:** https://oddship.github.io/stargazers-action/

This project now works in three forms:

- **GitHub Action** for scheduled builds and deploy workflows
- **CLI** for cron jobs and local scripts
- **library** for custom Node/TypeScript integrations

It discovers public repositories for a GitHub user or organization, fetches recent stargazer events, and can:

- write a JSON file for site templates
- write an RSS feed for feed readers
- diff the current snapshot against prior state
- post only **new** events to Discord

## Why this exists

GitHub does not offer a built-in account-wide feed for “people recently starred one of my repos”. This project fills that gap with reusable fetch, render, diff, and notify primitives.

## Execution modes

| Mode | What it does |
|---|---|
| `generate` | fetch snapshot and write JSON + RSS |
| `discord` | fetch snapshot, diff against baseline, send Discord only |
| `generate-and-discord` | do both |

Default mode is `generate`.

## State backends

Discord delivery is diff-based, not firehose-based.

A **new event** is determined by the stable event id:

```text
{repo.nameWithOwner}:{user.login}:{starredAt}
```

The notifier compares the current snapshot against one of these baseline backends:

| Backend | Best for |
|---|---|
| `file` | local scripts, cron, generic CLI usage |
| `feed-url` | deployed sites that already publish the RSS feed |
| `github-branch` | Discord-only GitHub Action users with no site/feed |

Defaults:

- bootstrap mode: `silent`
- notify mode: `summary`
- Discord mentions disabled via `allowed_mentions.parse = []`

Notes:

- `github-branch` requires workflow `permissions: contents: write`.
- Writable backends (`file`, `github-branch`) keep a bounded seen-id list in `state_path`; `state_max_entries` defaults to `500` and is capped at `5000`.
- The state file is intentionally not an unbounded event log; oldest ids are dropped when the cap is reached.
- Writable backends (`file`, `github-branch`) use a pending marker before Discord delivery so a failed state-finalization step does not resend duplicates on the next run.
- If a writable backend is left with a pending batch, the next run stops instead of guessing whether Discord already received the prior notification.
- `feed-url` is read-only; if you rerun before the published feed baseline advances, duplicates are still possible.

## GitHub Action usage

### Generate JSON + RSS for a site

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Generate stargazer feed
        uses: oddship/stargazers-action@<pinned-sha>
        with:
          config: .github/stargazers.yml
          token: ${{ github.token }}

      - name: Stage generated files for Nix flakes
        run: git add -f src/generated/github-stars.json public/feeds/github-stars.xml

      - name: Build site
        run: nix build .#default
```

Example config:

```yaml
owner: oddship
repo_exclude:
  - oddship.net
  - stargazers-action
recent_limit: 40
per_repo_limit: 40
json_output: src/generated/github-stars.json
feed_output: public/feeds/github-stars.xml
site_url: https://oddship.net
feed_title: Oddship GitHub stargazers
feed_description: Recent GitHub stargazers across selected Oddship projects.
```

### Discord-only GitHub Action

This is the default path for people who want notifications but do **not** have a site/feed.

```yaml
jobs:
  notify:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v5

      - name: Notify Discord about new stargazers
        uses: oddship/stargazers-action@<pinned-sha>
        with:
          mode: discord
          owner: oddship
          repo_exclude: oddship.net,stargazers-action
          state_backend: github-branch
          state_branch: stargazers-state
          discord_webhook_url: ${{ secrets.DISCORD_STARGAZERS_WEBHOOK }}
          token: ${{ github.token }}
```

The `github-branch` backend stores seen event ids in a tiny state file on a dedicated branch so reruns do not resend old events. It must have `contents: write` permission.

### Post-deploy Discord notifications using the deployed feed as baseline

If you already publish the feed, run Discord after a successful deploy:

```yaml
- name: Notify Discord
  if: success()
  uses: oddship/stargazers-action@<pinned-sha>
  with:
    mode: discord
    config: .github/stargazers.yml
    state_backend: feed-url
    baseline_feed_url: https://oddship.net/feeds/github-stars.xml
    discord_webhook_url: ${{ secrets.DISCORD_STARGAZERS_WEBHOOK }}
    token: ${{ github.token }}
```

## CLI usage

Build first:

```bash
npm install
npm run build
```

Then run:

```bash
./dist/cli.cjs generate --config .github/stargazers.yml --token "$GITHUB_TOKEN"
./dist/cli.cjs discord --config .github/stargazers.yml --discord-webhook-url "$DISCORD_WEBHOOK_URL"
./dist/cli.cjs generate-and-discord --config .github/stargazers.yml
```

The installed bin name is:

```bash
stargazers
```

Useful local-script pattern:

```bash
stargazers discord \
  --owner oddship \
  --repo-exclude oddship.net,stargazers-action \
  --state-backend file \
  --state-path .stargazers/state.json \
  --discord-webhook-url "$DISCORD_WEBHOOK_URL" \
  --token "$GITHUB_TOKEN"
```

## Library usage

This repo is **not published to npm yet**. The library surface is meant for repo-local or workspace use.

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

Important exports:

- `resolveConfig(...)`
- `execute(...)`
- `fetchStarsSnapshot(...)`
- `renderRssFeed(...)`
- `buildDiscordMessages(...)`
- `loadState(...)`
- `saveState(...)`
- `diffSnapshotAgainstState(...)`

## Configuration

All settings can come from either:

- action inputs / CLI flags
- a YAML or JSON config file

Direct inputs override config-file values.

### Common keys

| Key | Notes |
|---|---|
| `owner` | required |
| `owner_type` | `user`, `organization`, or `auto` |
| `repo_include` | comma/newline list |
| `repo_exclude` | comma/newline list |
| `recent_limit` | global emitted event cap |
| `per_repo_limit` | per-repo GraphQL fetch cap, max `100` |
| `include_forks` | default `false` |
| `include_archived` | default `false` |
| `token` | GitHub token for GraphQL |

### Generate keys

| Key | Notes |
|---|---|
| `json_output` | relative to workspace |
| `feed_output` | relative to workspace |
| `site_url` | required for RSS metadata |
| `feed_title` | optional |
| `feed_description` | optional |

### Discord keys

| Key | Notes |
|---|---|
| `discord_webhook_url` | required when mode includes Discord |
| `discord_bootstrap` | `silent` or `send-all` |
| `discord_notify_mode` | `summary` or `per-star` |
| `discord_username` | optional |
| `discord_avatar_url` | optional |

### State keys

| Key | Notes |
|---|---|
| `state_backend` | `file`, `feed-url`, or `github-branch` (`github-branch` needs `contents: write`) |
| `state_path` | state file path for `file` / `github-branch` |
| `state_max_entries` | retained seen-id cap for writable state (`file` / `github-branch`); default `500`, max `5000` |
| `baseline_feed_url` | required for `feed-url` |
| `state_repository` | defaults to `GITHUB_REPOSITORY` for `github-branch` |
| `state_branch` | defaults to `stargazers-state` |
| `state_token` | defaults to `token` |
| `state_commit_message` | optional |

## Example configs

See:

- `examples/oddship.net.stargazers.yml`
- `examples/rohanverma.net.stargazers.yml`
- `examples/discord-only.stargazers.yml`

## Outputs

The GitHub Action sets:

- `mode`
- `json-path`
- `feed-path`
- `feed-url`
- `repo-count`
- `star-count`
- `new-event-count`
- `discord-message-count`
- `state-backend`

## JSON shape

```json
{
  "version": 1,
  "generatedAt": "2026-04-21T12:00:00.000Z",
  "owner": {
    "login": "oddship",
    "url": "https://github.com/oddship",
    "type": "Organization"
  },
  "site": {
    "url": "https://oddship.net"
  },
  "feed": {
    "title": "Oddship GitHub stargazers",
    "description": "Recent GitHub stargazers across selected repositories owned by oddship.",
    "path": "/feeds/github-stars.xml",
    "url": "https://oddship.net/feeds/github-stars.xml",
    "format": "rss"
  },
  "stats": {
    "repoCount": 4,
    "starCount": 40
  },
  "repos": [],
  "stars": []
}
```

## Security notes

- Do **not** commit Discord webhook URLs.
- Use GitHub Secrets or local environment variables.
- If a webhook URL is pasted into chat, logs, or a public repo, rotate it.

## Development

```bash
npm install
npm run lint
TMPDIR=/dev/shm npm test
npm run build
```

Local generate-only run:

```bash
GITHUB_WORKSPACE=/path/to/site \
INPUT_CONFIG=.github/stargazers.yml \
INPUT_TOKEN="$(gh auth token)" \
node dist/index.cjs
```
