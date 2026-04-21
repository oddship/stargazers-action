---
title: Discord notifications
description: Send only new stargazer events to Discord.
---

# Discord notifications

Discord delivery is diff-based. A new event is identified as:

```text
{repo.nameWithOwner}:{user.login}:{starredAt}
```

That lets the notifier send only events it has not seen before.

## Choose a state backend

| Backend | Best for |
| --- | --- |
| `file` | local scripts and cron jobs |
| `feed-url` | post-deploy checks against an already-published feed |
| `github-branch` | GitHub Actions runs that need durable state in the repo |

Defaults:

- `discord_bootstrap: silent`
- `discord_notify_mode: summary`
- Discord mentions disabled via `allowed_mentions.parse = []`

## Recommended GitHub Actions pattern

For production sites, the safest pattern is:

1. generate JSON + RSS
2. deploy the site
3. wait until the live feed matches the built artifact
4. run `mode: discord`

That avoids notifying on a feed that is not live yet.

```yaml
permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5

      - name: Generate stargazer feed
        uses: oddship/stargazers-action@73dbb983970054b2e815acfed65bf163d9e0ebde
        with:
          config: .github/stargazers.yml
          token: ${{ github.token }}

      # build + deploy your site here

      - name: Notify Discord about new stargazers
        uses: oddship/stargazers-action@73dbb983970054b2e815acfed65bf163d9e0ebde
        with:
          mode: discord
          config: .github/stargazers.yml
          state_backend: github-branch
          state_branch: stargazers-state
          discord_bootstrap: silent
          discord_notify_mode: summary
          discord_webhook_url: ${{ secrets.DISCORD_STARGAZERS_WEBHOOK }}
          token: ${{ github.token }}
```

`github-branch` needs `permissions: contents: write` because it persists state in the repo.

## Bootstrap and notify modes

### `discord_bootstrap`

| Value | Behavior |
| --- | --- |
| `silent` | initialize baseline without backfilling old events |
| `send-all` | send the initial batch immediately |

### `discord_notify_mode`

| Value | Behavior |
| --- | --- |
| `summary` | one message summarizing the new events |
| `per-star` | one message per star event |

## Failure handling

Writable backends (`file` and `github-branch`) use a pending marker before delivery and only finalize state after Discord succeeds. If a run is interrupted mid-flight, the next run stops on unresolved pending state instead of guessing and risking duplicates.
