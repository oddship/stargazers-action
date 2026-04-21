export interface ResolvedConfig {
  workspace: string;
  owner: string;
  ownerTypeHint: "auto" | "user" | "organization";
  repoInclude: string[];
  repoExclude: string[];
  recentLimit: number;
  perRepoLimit: number;
  includeForks: boolean;
  includeArchived: boolean;
  jsonOutput: string;
  jsonOutputPath: string;
  feedOutput: string;
  feedOutputPath: string;
  feedSitePath: string;
  siteUrl: string;
  feedUrl: string;
  feedTitle: string;
  feedDescription: string;
  token: string;
  configPath?: string;
}

export interface OwnerSummary {
  login: string;
  url: string;
  type: "User" | "Organization" | "Unknown";
}

export interface RepositorySummary {
  name: string;
  nameWithOwner: string;
  url: string;
  description: string | null;
  isArchived: boolean;
  isFork: boolean;
  stargazerCount: number;
}

export interface RepositoryWithFetchInfo extends RepositorySummary {
  fetchedRecentStars: number;
}

export interface StarEvent {
  id: string;
  starredAt: string;
  repo: {
    name: string;
    nameWithOwner: string;
    url: string;
    description: string | null;
  };
  user: {
    login: string;
    url: string;
    avatarUrl: string | null;
  };
}

export interface GeneratedStarsData {
  version: 1;
  generatedAt: string;
  owner: OwnerSummary;
  site: {
    url: string;
  };
  feed: {
    title: string;
    description: string;
    path: string;
    url: string;
    format: "rss";
  };
  stats: {
    repoCount: number;
    starCount: number;
  };
  repos: RepositoryWithFetchInfo[];
  stars: StarEvent[];
}
