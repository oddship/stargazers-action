import assert from "node:assert/strict";
import test from "node:test";
import { diffSnapshotAgainstState, ensureNoPendingState, extractEventIdsFromFeedXml, planNotification } from "../src/state.js";
import type { LoadedState, StarEvent, StarsSnapshot } from "../src/types.js";

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
      repoCount: 1,
      starCount: stars.length,
    },
    repos: [
      {
        name: "moat",
        nameWithOwner: "oddship/moat",
        url: "https://github.com/oddship/moat",
        description: "A docs tool.",
        isArchived: false,
        isFork: false,
        stargazerCount: 10,
        fetchedRecentStars: stars.length,
      },
    ],
    stars,
  };
}

test("extractEventIdsFromFeedXml reads RSS guid values", () => {
  const ids = extractEventIdsFromFeedXml(`
    <rss>
      <channel>
        <item><guid isPermaLink="false">one</guid></item>
        <item><guid isPermaLink="false">two</guid></item>
      </channel>
    </rss>
  `);

  assert.deepEqual(ids, [
    { id: "one", starredAt: "" },
    { id: "two", starredAt: "" },
  ]);
});

test("diffSnapshotAgainstState suppresses first-run notifications in silent bootstrap mode", () => {
  const snapshot = makeSnapshot([makeStar("new", "2026-04-21T11:00:00Z")]);
  const loaded: LoadedState = {
    exists: false,
    source: "file:.stargazers/state.json",
    state: {
      version: 1,
      updatedAt: "1970-01-01T00:00:00.000Z",
      events: [],
    },
  };

  const diff = diffSnapshotAgainstState(snapshot, loaded, {
    bootstrap: "silent",
    maxEntries: 500,
  });

  assert.equal(diff.newEvents.length, 0);
  assert.equal(diff.nextState.events.length, 1);
});

test("diffSnapshotAgainstState emits unseen events and retains prior state", () => {
  const snapshot = makeSnapshot([
    makeStar("new", "2026-04-21T11:00:00Z"),
    makeStar("old", "2026-04-20T11:00:00Z"),
  ]);
  const loaded: LoadedState = {
    exists: true,
    source: "file:.stargazers/state.json",
    state: {
      version: 1,
      updatedAt: "2026-04-20T12:00:00Z",
      events: [{ id: "old", starredAt: "2026-04-20T11:00:00Z" }],
    },
  };

  const diff = diffSnapshotAgainstState(snapshot, loaded, {
    bootstrap: "silent",
    maxEntries: 500,
  });

  assert.deepEqual(
    diff.newEvents.map((event) => event.id),
    ["new"],
  );
  assert.deepEqual(
    diff.nextState.events.map((event) => event.id),
    ["new", "old"],
  );
});

test("ensureNoPendingState rejects unresolved pending batches", () => {
  const loaded: LoadedState = {
    exists: true,
    source: "file:.stargazers/state.json",
    state: {
      version: 1,
      updatedAt: "2026-04-20T12:00:00Z",
      events: [],
      pending: {
        batchId: "batch-1",
        preparedAt: "2026-04-20T12:00:00Z",
        events: [{ id: "new", starredAt: "2026-04-20T11:00:00Z" }],
      },
    },
  };

  assert.throws(() => ensureNoPendingState(loaded), /unresolved pending batch batch-1/);
});

test("planNotification creates a pending pre-send state and committed post-send state", () => {
  const snapshot = makeSnapshot([
    makeStar("new", "2026-04-21T11:00:00Z"),
    makeStar("old", "2026-04-20T11:00:00Z"),
  ]);
  const loaded: LoadedState = {
    exists: true,
    source: "file:.stargazers/state.json",
    state: {
      version: 1,
      updatedAt: "2026-04-20T12:00:00Z",
      events: [{ id: "old", starredAt: "2026-04-20T11:00:00Z" }],
    },
  };

  const plan = planNotification(snapshot, loaded, {
    bootstrap: "silent",
    maxEntries: 500,
  });

  assert.deepEqual(
    plan.newEvents.map((event) => event.id),
    ["new"],
  );
  assert.equal(plan.preSendState.pending?.events[0]?.id, "new");
  assert.equal(plan.preSendState.events.length, 1);
  assert.equal(plan.postSendState.pending, undefined);
  assert.deepEqual(
    plan.postSendState.events.map((event) => event.id),
    ["new", "old"],
  );
});
