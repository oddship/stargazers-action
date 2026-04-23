import assert from "node:assert/strict";
import test from "node:test";
import { fetchRecentStarsForRepository, listOwnedRepositories } from "../src/github.js";
import type { Logger } from "../src/logger.js";
import type { RepositorySummary, ResolvedConfig } from "../src/types.js";

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    workspace: "/tmp/stargazers-action",
    owner: "oddship",
    ownerTypeHint: "auto",
    mode: "generate",
    repoInclude: [],
    repoExclude: [],
    recentLimit: 40,
    perRepoLimit: 40,
    includeForks: false,
    includeArchived: false,
    token: "test-token",
    ...overrides,
  };
}

function makeLogger(warnings: string[]): Logger {
  return {
    info() {},
    warn(message: string) {
      warnings.push(message);
    },
    error() {},
  };
}

test("fetchRecentStarsForRepository retries transient GraphQL HTTP failures", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, _timeout?: number, ...args: unknown[]) => {
    handler(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;

    if (attempts < 3) {
      return new Response("temporary upstream failure", {
        status: 504,
        statusText: "Gateway Timeout",
      });
    }

    return new Response(
      JSON.stringify({
        data: {
          repository: {
            stargazers: {
              edges: [
                {
                  starredAt: "2026-04-23T10:00:00Z",
                  node: {
                    login: "alice",
                    url: "https://github.com/alice",
                    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
                  },
                },
              ],
            },
          },
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  const warnings: string[] = [];
  const repo: RepositorySummary = {
    name: "moat",
    nameWithOwner: "oddship/moat",
    url: "https://github.com/oddship/moat",
    description: "A docs tool.",
    isArchived: false,
    isFork: false,
    stargazerCount: 10,
  };

  const stars = await fetchRecentStarsForRepository(makeConfig(), repo, makeLogger(warnings));

  assert.equal(attempts, 3);
  assert.equal(stars.length, 1);
  assert.equal(stars[0]?.user.login, "alice");
  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? "", /504 Gateway Timeout/);
  assert.match(warnings[0] ?? "", /next attempt 2\/4/);
});

test("listOwnedRepositories retries transient fetch errors", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, _timeout?: number, ...args: unknown[]) => {
    handler(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;

    if (attempts === 1) {
      throw new TypeError("fetch failed");
    }

    return new Response(
      JSON.stringify({
        data: {
          repositoryOwner: {
            __typename: "User",
            login: "oddship",
            url: "https://github.com/oddship",
            repositories: {
              nodes: [
                {
                  name: "moat",
                  nameWithOwner: "oddship/moat",
                  url: "https://github.com/oddship/moat",
                  description: "A docs tool.",
                  isArchived: false,
                  isFork: false,
                  stargazerCount: 42,
                },
              ],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  const warnings: string[] = [];
  const result = await listOwnedRepositories(makeConfig(), makeLogger(warnings));

  assert.equal(attempts, 2);
  assert.equal(result.owner.login, "oddship");
  assert.equal(result.repos.length, 1);
  assert.equal(result.repos[0]?.nameWithOwner, "oddship/moat");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /fetch failed/);
  assert.match(warnings[0] ?? "", /next attempt 2\/4/);
});
