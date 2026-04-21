---
title: Configuration reference
description: Inputs, config keys, and outputs.
---

# Configuration reference

Configuration can come from either:

- action inputs / CLI flags
- a YAML or JSON config file

Direct inputs override config-file values.

## Common keys

| Key | Notes |
| --- | --- |
| `owner` | required |
| `owner_type` | `user`, `organization`, or `auto` |
| `repo_include` | comma or newline list |
| `repo_exclude` | comma or newline list |
| `recent_limit` | global emitted event cap |
| `per_repo_limit` | per-repo GraphQL fetch cap, max `100` |
| `include_forks` | default `false` |
| `include_archived` | default `false` |
| `token` | GitHub token for GraphQL |
| `config` | optional YAML/JSON config file path |

## Generate keys

| Key | Notes |
| --- | --- |
| `json_output` | output path relative to `GITHUB_WORKSPACE` |
| `feed_output` | output path relative to `GITHUB_WORKSPACE` |
| `site_url` | required for RSS metadata |
| `feed_title` | optional |
| `feed_description` | optional |

## Discord keys

| Key | Notes |
| --- | --- |
| `discord_webhook_url` | required when mode includes Discord |
| `discord_bootstrap` | `silent` or `send-all` |
| `discord_notify_mode` | `summary` or `per-star` |
| `discord_username` | optional username override |
| `discord_avatar_url` | optional avatar override |

## State keys

| Key | Notes |
| --- | --- |
| `state_backend` | `file`, `feed-url`, or `github-branch` |
| `state_path` | state file path for `file` / `github-branch` |
| `state_max_entries` | retained seen-id cap for writable state (`file` / `github-branch`), default `500`, max `5000` |
| `baseline_feed_url` | required for `feed-url` |
| `state_repository` | defaults to `GITHUB_REPOSITORY` for `github-branch` |
| `state_branch` | defaults to `stargazers-state` |
| `state_token` | defaults to `token` |
| `state_commit_message` | optional |

### State retention behavior

For writable state backends (`file`, `github-branch`), the state file stores a deduplicated list of seen event ids (newest first), not an unbounded event log.

On every run, seen ids from the current snapshot are merged with the previous state and truncated to `state_max_entries`.

- default cap: `500`
- maximum cap: `5000`

When the cap is reached, the oldest ids are dropped.

## Action outputs

| Output | Meaning |
| --- | --- |
| `mode` | effective execution mode |
| `json-path` | relative JSON output path |
| `feed-path` | relative RSS output path |
| `feed-url` | derived public feed URL |
| `repo-count` | selected repository count |
| `star-count` | emitted star event count |
| `new-event-count` | events detected as new against baseline |
| `discord-message-count` | messages sent to Discord |
| `state-backend` | effective state backend |

## Important behavior

- All configured file paths are resolved inside `GITHUB_WORKSPACE`.
- `per_repo_limit` is capped at `100` because that is the practical GraphQL page limit here.
- `github-branch` needs workflow `permissions: contents: write`.
- `feed-url` is read-only; if you rerun before the published feed changes, duplicates are still possible.
