import type {
  GenerateConfig,
  GeneratedStarsData,
  OwnerSummary,
  RepositorySummary,
  RepositoryWithFetchInfo,
  ResolvedConfig,
  SeenEventRecord,
  SeenEventsState,
  StarEvent,
  StarsSnapshot,
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

export function buildStarsSnapshot(params: {
  owner: OwnerSummary;
  repos: RepositorySummary[];
  starEvents: StarEvent[];
  fetchedCounts: Map<string, number>;
}): StarsSnapshot {
  const repos: RepositoryWithFetchInfo[] = params.repos.map((repo) => ({
    ...repo,
    fetchedRecentStars: params.fetchedCounts.get(repo.nameWithOwner) ?? 0,
  }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    owner: params.owner,
    stats: {
      repoCount: repos.length,
      starCount: params.starEvents.length,
    },
    repos,
    stars: params.starEvents,
  };
}

export function buildGeneratedData(snapshot: StarsSnapshot, generation: GenerateConfig): GeneratedStarsData {
  return {
    ...snapshot,
    site: {
      url: generation.siteUrl,
    },
    feed: {
      title: generation.feedTitle,
      description: generation.feedDescription,
      path: generation.feedSitePath,
      url: generation.feedUrl,
      format: "rss",
    },
  };
}

function dedupeSeenEvents(events: SeenEventRecord[]): SeenEventRecord[] {
  const seen = new Set<string>();
  const unique = [] as SeenEventRecord[];

  for (const event of events) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    unique.push(event);
  }

  unique.sort((left, right) => right.starredAt.localeCompare(left.starredAt));
  return unique;
}

export function createEmptyState(): SeenEventsState {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    events: [],
  };
}

export function buildStateRecords(stars: StarEvent[]): SeenEventRecord[] {
  return stars.map((star) => ({
    id: star.id,
    starredAt: star.starredAt,
  }));
}

export function mergeSeenEvents(current: SeenEventRecord[], previous: SeenEventRecord[], maxEntries: number): SeenEventRecord[] {
  return dedupeSeenEvents([...current, ...previous]).slice(0, maxEntries);
}
