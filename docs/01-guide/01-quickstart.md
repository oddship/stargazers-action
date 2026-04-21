---
title: Quickstart
description: Add stargazers-action to a site build workflow.
---

# Quickstart

`stargazers-action` is usually run in a site deploy workflow:

1. fetch recent star events
2. write JSON + RSS into your repo workspace
3. stage those generated files if your build reads from Git state
4. build and deploy your site

## 1. Add a config file

Create `.github/stargazers.yml` in the consuming repo:

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

All output paths are resolved inside `GITHUB_WORKSPACE`. `per_repo_limit` must be `<= 100`.

## 2. Call the action from your workflow

Pin the action to an immutable ref. Do not use `@main`.

```yaml
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

      - name: Stage generated files for the site build
        run: git add -f src/generated/github-stars.json public/feeds/github-stars.xml

      - name: Build site
        run: your-build-command-here
```

## 3. Render the JSON in your site

The action stays presentation-free on purpose. It generates data; your site decides how to present it.

Use one of the concrete guides next:

- [[Astro integration]]
- [[Zola integration]]

## 4. Link the generated feed

The RSS file is just another static asset. Once deployed, link it from your page:

```html
<a href="/feeds/github-stars.xml">RSS feed</a>
```

## Execution modes

| Mode | Use it when |
| --- | --- |
| `generate` | you only need JSON + RSS |
| `discord` | you only want notifications |
| `generate-and-discord` | you want both in one run |

Default mode is `generate`.
