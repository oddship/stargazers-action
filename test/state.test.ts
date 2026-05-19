import assert from "node:assert/strict";
import test from "node:test";
import { diffSnapshotAgainstState, ensureNoPendingState, extractEventIdsFromFeedXml, planNotification, saveState } from "../src/state.js";
import type { GitHubBranchStateConfig, LoadedState, SeenEventsState, StarEvent, StarsSnapshot } from "../src/types.js";

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

test("saveState retries github-branch writes after a 409 conflict", async () => {
  const config: GitHubBranchStateConfig = {
    backend: "github-branch",
    repository: "oddship/stargazers-action",
    branch: "stargazers-state",
    statePath: ".stargazers/state.json",
    token: "test-token",
    commitMessage: "chore: update stargazers notification state",
    maxEntries: 500,
  };
  const state: SeenEventsState = {
    version: 1,
    updatedAt: "2026-05-19T00:00:00Z",
    events: [{ id: "new", starredAt: "2026-05-18T23:59:00Z" }],
  };

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    new Response(JSON.stringify({ object: { sha: "branch-sha" } }), { status: 200 }),
    new Response(JSON.stringify({ sha: "stale-sha", content: "e30=", encoding: "base64" }), { status: 200 }),
    new Response(JSON.stringify({ message: "sha mismatch" }), { status: 409, statusText: "Conflict" }),
    new Response(JSON.stringify({ sha: "fresh-sha", content: "e30=", encoding: "base64" }), { status: 200 }),
    new Response(JSON.stringify({ content: { sha: "saved-sha" } }), { status: 200 }),
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    assert.ok(response, `unexpected fetch call for ${String(input)}`);
    return response;
  };

  try {
    await saveState(config, state);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 5);

  const putCalls = calls.filter((call) => call.init?.method === "PUT");
  assert.equal(putCalls.length, 2);

  const firstBody = JSON.parse(String(putCalls[0]?.init?.body));
  const secondBody = JSON.parse(String(putCalls[1]?.init?.body));
  assert.equal(firstBody.sha, "stale-sha");
  assert.equal(secondBody.sha, "fresh-sha");
});
