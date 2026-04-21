---
title: Zola integration
description: Render stargazer data in Zola, using the rohanverma.net pattern.
---

# Zola integration

The `rohanverma.net` integration writes:

- JSON → `data/github-stars.json`
- RSS → `static/feeds/github-stars.xml`

## Config

```yaml
owner: rhnvrm
repo_include:
  - rohanverma.net
  - pi-mesh
  - s3site
  - simples3
json_output: data/github-stars.json
feed_output: static/feeds/github-stars.xml
site_url: https://rohanverma.net
feed_title: Rohan Verma GitHub stargazers
feed_description: Recent GitHub stargazers across selected public projects by Rohan Verma.
```

## Workflow

```yaml
- name: Generate stargazer feed
  uses: oddship/stargazers-action@73dbb983970054b2e815acfed65bf163d9e0ebde
  with:
    config: .github/stargazers.yml
    token: ${{ github.token }}

- name: Stage generated files for the Zola build
  run: git add -f data/github-stars.json static/feeds/github-stars.xml
```

## Content page

Create a content file that points at a custom template:

```toml
+++
title = "Recent GitHub stargazers"
description = "Recent GitHub stargazers across selected public projects."
template = "stars.html"
+++
```

## Template example

In the template, load the generated JSON and render it however you want:

```jinja
{% set stars_data = load_data(path="data/github-stars.json", required=false) %}

<h1>{{ page.title }}</h1>
<p><a href="/feeds/github-stars.xml">RSS feed</a></p>

{% if stars_data and stars_data.stars %}
  {% for star in stars_data.stars %}
    <article>
      <a href="{{ star.user.url }}">@{{ star.user.login }}</a>
      starred
      <a href="{{ star.repo.url }}">{{ star.repo.nameWithOwner }}</a>
    </article>
  {% endfor %}
{% endif %}
```

This works well with Zola because `load_data()` can read the generated JSON directly from the repo workspace during the build.
