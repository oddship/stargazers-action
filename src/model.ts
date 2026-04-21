import type {
  GeneratedStarsData,
  OwnerSummary,
  RepositorySummary,
  RepositoryWithFetchInfo,
  ResolvedConfig,
  StarEvent,
} from "./types.js";

export function selectRepositories(repos: RepositorySummary[], config: ResolvedConfig): RepositorySummary[] {
  const include = new Set(config.repoInclude);
  const exclude = new Set(config.repoExclude);

  return repos.filter((repo) => {
    const repoName = repo.name.toLowerCase();
    const repoNameWithOwner = repo.nameWithOwner.toLowerCase();

    if (!config.includeForks && repo.isFork) {
      return false;
    }

    if (!config.includeArchived && repo.isArchived) {
      return false;
    }

    if (include.size > 0 && !include.has(repoName) && !include.has(repoNameWithOwner)) {
      return false;
    }

    if (exclude.has(repoName) || exclude.has(repoNameWithOwner)) {
      return false;
    }

    return true;
  });
}

export function normalizeStars(stars: StarEvent[], recentLimit: number): StarEvent[] {
  const seen = new Set<string>();

  const uniqueStars = stars.filter((star) => {
    if (seen.has(star.id)) {
      return false;
    }
    seen.add(star.id);
    return true;
  });

  uniqueStars.sort((left, right) => right.starredAt.localeCompare(left.starredAt));
  return uniqueStars.slice(0, recentLimit);
}

export function buildGeneratedData(params: {
  config: ResolvedConfig;
  owner: OwnerSummary;
  repos: RepositorySummary[];
  starEvents: StarEvent[];
  fetchedCounts: Map<string, number>;
}): GeneratedStarsData {
  const repos: RepositoryWithFetchInfo[] = params.repos.map((repo) => ({
    ...repo,
    fetchedRecentStars: params.fetchedCounts.get(repo.nameWithOwner) ?? 0,
  }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    owner: params.owner,
    site: {
      url: params.config.siteUrl,
    },
    feed: {
      title: params.config.feedTitle,
      description: params.config.feedDescription,
      path: params.config.feedSitePath,
      url: params.config.feedUrl,
      format: "rss",
    },
    stats: {
      repoCount: repos.length,
      starCount: params.starEvents.length,
    },
    repos,
    stars: params.starEvents,
  };
}
