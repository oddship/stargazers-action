import assert from "node:assert/strict";
import test from "node:test";
import { renderRssFeed } from "../src/feed.js";
import type { GeneratedStarsData } from "../src/types.js";

const sampleData: GeneratedStarsData = {
  version: 1,
  generatedAt: "2026-04-21T12:00:00Z",
  owner: {
    login: "oddship",
    url: "https://github.com/oddship",
    type: "Organization",
  },
  site: {
    url: "https://oddship.net",
  },
  feed: {
    title: "Oddship GitHub stargazers",
    description: "Recent GitHub stargazers across selected repositories owned by oddship.",
    path: "/feeds/github-stars.xml",
    url: "https://oddship.net/feeds/github-stars.xml",
    format: "rss",
  },
  stats: {
    repoCount: 1,
    starCount: 1,
  },
  repos: [
    {
      name: "moat",
      nameWithOwner: "oddship/moat",
      url: "https://github.com/oddship/moat",
      description: "Docs builder",
      isArchived: false,
      isFork: false,
      stargazerCount: 10,
      fetchedRecentStars: 1,
    },
  ],
  stars: [
    {
      id: "oddship/moat:octocat:2026-04-21T11:00:00Z",
      starredAt: "2026-04-21T11:00:00Z",
      repo: {
        name: "moat",
        nameWithOwner: "oddship/moat",
        url: "https://github.com/oddship/moat",
        description: "Docs builder",
      },
      user: {
        login: "octocat",
        url: "https://github.com/octocat",
        avatarUrl: null,
      },
    },
  ],
};

test("renderRssFeed emits an RSS feed with self link and item title", () => {
  const xml = renderRssFeed(sampleData);

  assert.match(xml, /<rss version="2.0"/);
  assert.match(xml, /atom:link href="https:\/\/oddship.net\/feeds\/github-stars.xml"/);
  assert.match(xml, /<title>octocat starred oddship\/moat<\/title>/);
});
