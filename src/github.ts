import * as core from "@actions/core";
import type { OwnerSummary, RepositorySummary, ResolvedConfig, StarEvent } from "./types.js";

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

type RepositoryOwnerResponse = {
  repositoryOwner: {
    __typename: "Organization" | "User";
    login: string;
    url: string;
    repositories: {
      nodes: Array<{
        name: string;
        nameWithOwner: string;
        url: string;
        description: string | null;
        isArchived: boolean;
        isFork: boolean;
        stargazerCount: number;
      }>;
      pageInfo: {
        endCursor: string | null;
        hasNextPage: boolean;
      };
    };
  } | null;
};

type RepositoryStarsResponse = {
  repository: {
    stargazers: {
      edges: Array<{
        starredAt: string;
        node: {
          login: string;
          url: string;
          avatarUrl: string | null;
        } | null;
      }>;
    };
  } | null;
};

async function requestGraphQL<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "User-Agent": "oddship-stargazers-action",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed with ${response.status} ${response.statusText}.`);
  }

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  if (!payload.data) {
    throw new Error("GitHub GraphQL request returned no data.");
  }

  return payload.data;
}

function normalizeOwnerType(value: string): OwnerSummary["type"] {
  if (value === "User" || value === "Organization") {
    return value;
  }
  return "Unknown";
}

export async function listOwnedRepositories(
  config: ResolvedConfig,
): Promise<{ owner: OwnerSummary; repos: RepositorySummary[] }> {
  const repos: RepositorySummary[] = [];
  let cursor: string | null = null;
  let owner: OwnerSummary | null = null;

  const query = /* GraphQL */ `
    query ListOwnedRepositories($login: String!, $cursor: String) {
      repositoryOwner(login: $login) {
        __typename
        login
        url
        ... on Organization {
          repositories(first: 100, after: $cursor, privacy: PUBLIC, orderBy: { field: PUSHED_AT, direction: DESC }) {
            nodes {
              name
              nameWithOwner
              url
              description
              isArchived
              isFork
              stargazerCount
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
        ... on User {
          repositories(
            first: 100
            after: $cursor
            privacy: PUBLIC
            ownerAffiliations: OWNER
            orderBy: { field: PUSHED_AT, direction: DESC }
          ) {
            nodes {
              name
              nameWithOwner
              url
              description
              isArchived
              isFork
              stargazerCount
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    }
  `;

  do {
    const data: RepositoryOwnerResponse = await requestGraphQL<RepositoryOwnerResponse>(
      query,
      { login: config.owner, cursor },
      config.token,
    );
    const ownerNode: RepositoryOwnerResponse["repositoryOwner"] = data.repositoryOwner;

    if (!ownerNode) {
      throw new Error(`Could not find GitHub owner ${config.owner}.`);
    }

    owner = {
      login: ownerNode.login,
      url: ownerNode.url,
      type: normalizeOwnerType(ownerNode.__typename),
    };

    repos.push(
      ...ownerNode.repositories.nodes.map((repo: RepositorySummary) => ({
        name: repo.name,
        nameWithOwner: repo.nameWithOwner,
        url: repo.url,
        description: repo.description,
        isArchived: repo.isArchived,
        isFork: repo.isFork,
        stargazerCount: repo.stargazerCount,
      })),
    );

    cursor = ownerNode.repositories.pageInfo.hasNextPage ? ownerNode.repositories.pageInfo.endCursor : null;
  } while (cursor);

  if (!owner) {
    throw new Error(`Could not resolve owner metadata for ${config.owner}.`);
  }

  if (config.ownerTypeHint !== "auto") {
    const normalizedHint = config.ownerTypeHint === "user" ? "User" : "Organization";
    if (owner.type !== normalizedHint) {
      core.warning(`owner_type=${config.ownerTypeHint} but GitHub returned ${owner.type}. Continuing with GitHub's value.`);
    }
  }

  return { owner, repos };
}

export async function fetchRecentStarsForRepository(
  config: ResolvedConfig,
  repo: RepositorySummary,
): Promise<StarEvent[]> {
  if (repo.stargazerCount === 0) {
    return [];
  }

  core.info(`Fetching recent stargazers for ${repo.nameWithOwner}...`);

  const query = /* GraphQL */ `
    query RepositoryRecentStars($owner: String!, $name: String!, $limit: Int!) {
      repository(owner: $owner, name: $name) {
        stargazers(last: $limit) {
          edges {
            starredAt
            node {
              login
              url
              avatarUrl(size: 96)
            }
          }
        }
      }
    }
  `;

  const data = await requestGraphQL<RepositoryStarsResponse>(
    query,
    {
      owner: config.owner,
      name: repo.name,
      limit: config.perRepoLimit,
    },
    config.token,
  );

  if (!data.repository) {
    core.warning(`Skipping ${repo.nameWithOwner}: repository no longer available.`);
    return [];
  }

  return data.repository.stargazers.edges
    .filter((edge) => edge.node)
    .map((edge) => ({
      id: `${repo.nameWithOwner}:${edge.node!.login}:${edge.starredAt}`,
      starredAt: edge.starredAt,
      repo: {
        name: repo.name,
        nameWithOwner: repo.nameWithOwner,
        url: repo.url,
        description: repo.description,
      },
      user: {
        login: edge.node!.login,
        url: edge.node!.url,
        avatarUrl: edge.node!.avatarUrl,
      },
    }));
}
