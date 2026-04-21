import assert from "node:assert/strict";
import test from "node:test";
import { buildStarsSnapshot, mergeSeenEvents, normalizeStars } from "../src/model.js";
import type { OwnerSummary, RepositorySummary, SeenEventRecord, StarEvent } from "../src/types.js";

function makeStar(id: string, starredAt: string): StarEvent {
  return {
    id,
    starredAt,
    repo: {
      name: "moat",
      nameWithOwner: "oddship/moat",
      url: "https://github.com/oddship/moat",
      description: "A docs tool.",
    },
    user: {
      login: id,
      url: `https://github.com/${id}`,
      avatarUrl: null,
    },
  };
}

test("normalizeStars sorts descending and removes duplicate ids", () => {
  const stars = normalizeStars(
    [
      makeStar("older", "2026-04-01T00:00:00Z"),
      makeStar("newer", "2026-04-02T00:00:00Z"),
      makeStar("newer", "2026-04-02T00:00:00Z"),
    ],
    10,
  );

  assert.equal(stars.length, 2);
  assert.equal(stars[0]?.user.login, "newer");
  assert.equal(stars[1]?.user.login, "older");
});

test("mergeSeenEvents keeps newest unique ids first", () => {
  const merged = mergeSeenEvents(
    [
      { id: "newer", starredAt: "2026-04-02T00:00:00Z" },
      { id: "older", starredAt: "2026-04-01T00:00:00Z" },
    ],
    [
      { id: "older", starredAt: "2026-04-01T00:00:00Z" },
      { id: "oldest", starredAt: "2026-03-01T00:00:00Z" },
    ],
    2,
  );

  assert.deepEqual(merged, [
    { id: "newer", starredAt: "2026-04-02T00:00:00Z" },
    { id: "older", starredAt: "2026-04-01T00:00:00Z" },
  ] satisfies SeenEventRecord[]);
});

test("buildStarsSnapshot preserves repo fetch info and stats", () => {
  const owner: OwnerSummary = {
    login: "oddship",
    url: "https://github.com/oddship",
    type: "Organization",
  };
  const repos: RepositorySummary[] = [
    {
      name: "moat",
      nameWithOwner: "oddship/moat",
      url: "https://github.com/oddship/moat",
      description: "A docs tool.",
      isArchived: false,
      isFork: false,
      stargazerCount: 10,
    },
  ];

  const snapshot = buildStarsSnapshot({
    owner,
    repos,
    starEvents: [makeStar("newer", "2026-04-02T00:00:00Z")],
    fetchedCounts: new Map([["oddship/moat", 1]]),
  });

  assert.equal(snapshot.stats.repoCount, 1);
  assert.equal(snapshot.stats.starCount, 1);
  assert.equal(snapshot.repos[0]?.fetchedRecentStars, 1);
});
