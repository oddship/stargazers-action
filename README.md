# stargazers-action

Generate recent GitHub stargazer data for static sites.

This action discovers public repositories for a GitHub user or organization, fetches recent stargazer events, and writes:

- a JSON file for site templates
- an RSS feed for feed readers

It is designed for static sites that build in GitHub Actions, including Astro and Zola.

## Why this exists

GitHub does not offer a built-in account-wide feed for “people starred one of my repos”. This action fills that gap with a build-time generator.

## Outputs

The action writes two files into `GITHUB_WORKSPACE`:

- `json_output` — structured data for templates/pages
- `feed_output` — RSS 2.0 XML

It also sets step outputs:

- `json-path`
- `feed-path`
- `feed-url`
- `repo-count`
- `star-count`

## Inputs

| Input | Required | Notes |
|---|---|---|
| `owner` | yes* | GitHub user or org login |
| `owner_type` | no | `user`, `organization`, or `auto` |
| `repo_include` | no | comma/newline list |
| `repo_exclude` | no | comma/newline list |
| `recent_limit` | no | default `40` |
| `per_repo_limit` | no | default `min(max(recent_limit, 40), 100)`; GitHub GraphQL caps this at `100` |
| `include_forks` | no | default `false` |
| `include_archived` | no | default `false` |
| `json_output` | yes* | relative to workspace |
| `feed_output` | yes* | relative to workspace |
| `site_url` | yes* | canonical site URL |
| `feed_title` | no | defaults to `<owner> GitHub stargazers` |
| `feed_description` | no | sensible default |
| `config` | no | YAML or JSON file relative to workspace |
| `token` | yes* | `${{ github.token }}` is enough for public repos |

`*` Required either directly as an input or via `config`.

All file paths must stay inside `GITHUB_WORKSPACE`. Absolute paths and traversal outside the workspace are rejected.

## Config file example

Create `.github/stargazers.yml` in the consumer repo:

```yaml
owner: oddship
repo_exclude:
  - oddship.net
  - stargazers-action
recent_limit: 40
per_repo_limit: 40
include_forks: false
include_archived: false
json_output: src/generated/github-stars.json
feed_output: public/feeds/github-stars.xml
site_url: https://oddship.net
feed_title: Oddship GitHub stargazers
feed_description: Recent GitHub stargazers across selected Oddship projects.
```

## Astro usage

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Generate stargazer feed
        uses: oddship/stargazers-action@<pinned-ref>
        with:
          config: .github/stargazers.yml
          token: ${{ github.token }}

      - name: Stage generated files for Nix flakes
        run: git add -f src/generated/github-stars.json public/feeds/github-stars.xml

      - name: Build site
        run: nix build .#default
```

## Zola usage

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Generate stargazer feed
        uses: oddship/stargazers-action@<pinned-ref>
        with:
          config: .github/stargazers.yml
          token: ${{ github.token }}

      - name: Stage generated files for Nix flakes
        run: git add -f data/github-stars.json static/feeds/github-stars.xml

      - name: Build site
        run: nix build .#default
```

Pin `<pinned-ref>` to an immutable commit SHA or a release tag.

### Why the `git add -f` step?

If your site builds through a Nix flake, generated files may need to be staged so the flake source includes them during `nix build`.

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

## Development

```bash
npm install
npm run lint
npm test
npm run build
```

To run it locally against a checked-out site repo:

```bash
cd /path/to/stargazers-action
GITHUB_WORKSPACE=/path/to/site \
INPUT_CONFIG=.github/stargazers.yml \
INPUT_TOKEN="$(gh auth token)" \
node dist/index.cjs
```
