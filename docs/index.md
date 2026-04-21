---
title: stargazers-action
layout: landing
description: Generate recent GitHub stargazer feeds and optional Discord notifications.
---

# stargazers-action

<h3 class="tagline text-light">Recent GitHub stargazers as JSON, RSS, and Discord notifications.</h3>

<div class="hstack">
  <a href="guide/quickstart/" class="button">Get started</a>
  <a href="https://github.com/oddship/stargazers-action" class="button outline">GitHub</a>
</div>

<br>

<div class="features">
<article class="card">
<header><h3>Framework-agnostic</h3></header>

Generate JSON and RSS once, then render however you want. The existing production integrations use Astro and Zola, but the generator itself is site-agnostic.
</article>

<article class="card">
<header><h3>Discord without backfill spam</h3></header>

Diff the current snapshot against file, feed, or branch-backed state. First runs can stay silent, and reruns do not have to resend the same events.
</article>

<article class="card">
<header><h3>Three surfaces</h3></header>

Use it as a GitHub Action, a CLI for cron jobs and scripts, or a repo-local Node/TypeScript library surface.
</article>

<article class="card">
<header><h3>Built for real deploys</h3></header>

The docs include concrete integration patterns pulled from the live `oddship.net` (Astro) and `rohanverma.net` (Zola) setups.
</article>
</div>

## What it does

GitHub does not expose an account-wide feed for “people recently starred one of my repos”. `stargazers-action` fills that gap by:

- discovering public repositories for a user or organization
- fetching recent stargazer events via GitHub GraphQL
- writing a normalized JSON snapshot for templates
- writing an RSS feed for feed readers
- diffing against prior state for Discord notifications

## Pick a path

- Start with [[Quickstart]] if you want JSON + RSS in a deploy workflow.
- See [[Discord notifications]] if you want new-star alerts.
- See [[Astro integration]] and [[Zola integration]] for full site examples.
- See [[Configuration reference]] and [[CLI and library usage]] for the lower-level surface.
