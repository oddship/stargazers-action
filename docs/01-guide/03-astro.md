---
title: Astro integration
description: Render stargazer data in Astro, using the oddship.net pattern.
---

# Astro integration

The `oddship.net` integration writes:

- JSON → `src/generated/github-stars.json`
- RSS → `public/feeds/github-stars.xml`

## Config

```yaml
owner: oddship
repo_exclude:
  - oddship.net
  - stargazers-action
json_output: src/generated/github-stars.json
feed_output: public/feeds/github-stars.xml
site_url: https://oddship.net
feed_title: Oddship GitHub stargazers
feed_description: Recent GitHub stargazers across selected Oddship projects.
```

## Workflow

```yaml
- name: Generate stargazer feed
  uses: oddship/stargazers-action@73dbb983970054b2e815acfed65bf163d9e0ebde
  with:
    config: .github/stargazers.yml
    token: ${{ github.token }}

- name: Stage generated files for the Astro build
  run: git add -f src/generated/github-stars.json public/feeds/github-stars.xml
```

The explicit `git add -f` step matters when the build reads from the checked-out workspace and the generated paths are ignored by Git.

## Page example

A simple Astro page can read the generated JSON at build time:

```astro
---
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const dataPath = path.resolve(process.cwd(), "src/generated/github-stars.json");
const starsData = existsSync(dataPath)
  ? JSON.parse(readFileSync(dataPath, "utf8"))
  : { stars: [], feed: { path: "/feeds/github-stars.xml" } };

const stars = starsData.stars ?? [];
const feedPath = starsData.feed?.path ?? "/feeds/github-stars.xml";
---

<h1>Signals</h1>
<p><a href={feedPath}>RSS feed</a></p>

{stars.map((star) => (
  <article>
    <a href={star.user.url}>@{star.user.login}</a>
    {" "}starred{" "}
    <a href={star.repo.url}>{star.repo.nameWithOwner}</a>
  </article>
))}
```

That keeps the action generic: it produces data, while Astro owns the page copy, markup, and styling.
