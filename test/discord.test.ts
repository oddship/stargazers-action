import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscordMessages } from "../src/discord.js";
import type { DiscordConfig, StarEvent, StarsSnapshot } from "../src/types.js";

function makeStar(index: number): StarEvent {
  return {
    id: `star-${index}`,
    starredAt: `2026-04-${String(index).padStart(2, "0")}T12:00:00Z`,
    repo: {
      name: `repo-${index}`,
      nameWithOwner: `oddship/repo-${index}`,
      url: `https://github.com/oddship/repo-${index}`,
      description: `Description ${index}`,
    },
    user: {
      login: `user-${index}`,
      url: `https://github.com/user-${index}`,
      avatarUrl: null,
    },
  };
}

function makeSnapshot(stars: StarEvent[]): StarsSnapshot {
  return {
    version: 1,
    generatedAt: "2026-04-21T12:00:00Z",
    owner: {
      login: "oddship",
      url: "https://github.com/oddship",
      type: "Organization",
    },
    stats: {
      repoCount: stars.length,
      starCount: stars.length,
    },
    repos: stars.map((star) => ({
      name: star.repo.name,
      nameWithOwner: star.repo.nameWithOwner,
      url: star.repo.url,
      description: star.repo.description,
      isArchived: false,
      isFork: false,
      stargazerCount: 1,
      fetchedRecentStars: 1,
    })),
    stars,
  };
}

const discordConfig: DiscordConfig = {
  webhookUrl: "https://discord.com/api/webhooks/1/abc",
  bootstrap: "silent",
  notifyMode: "summary",
};

test("buildDiscordMessages chunks summary embeds and disables mentions", () => {
  const stars = Array.from({ length: 12 }, (_, index) => makeStar(index + 1));
  const messages = buildDiscordMessages({
    snapshot: makeSnapshot(stars),
    newEvents: stars,
    config: discordConfig,
    feedUrl: "https://oddship.net/feeds/github-stars.xml",
  });

  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0]?.allowed_mentions.parse, []);
  assert.match(messages[0]?.content ?? "", /12 new GitHub stargazers/);
  assert.match(messages[0]?.content ?? "", /https:\/\/oddship.net\/feeds\/github-stars.xml/);
  assert.equal(messages[0]?.embeds?.length, 10);
  assert.equal(messages[1]?.embeds?.length, 2);
});

test("buildDiscordMessages emits one message per star in per-star mode", () => {
  const stars = [makeStar(1), makeStar(2)];
  const messages = buildDiscordMessages({
    snapshot: makeSnapshot(stars),
    newEvents: stars,
    config: {
      ...discordConfig,
      notifyMode: "per-star",
    },
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.embeds?.length, 1);
  assert.equal(messages[1]?.embeds?.length, 1);
});
