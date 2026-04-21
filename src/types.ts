export type RunMode = "generate" | "discord" | "generate-and-discord";
export type StateBackend = "file" | "feed-url" | "github-branch";
export type DiscordBootstrapMode = "silent" | "send-all";
export type DiscordNotifyMode = "summary" | "per-star";

export interface CommonConfig {
  workspace: string;
  owner: string;
  ownerTypeHint: "auto" | "user" | "organization";
  repoInclude: string[];
  repoExclude: string[];
  recentLimit: number;
  perRepoLimit: number;
  includeForks: boolean;
  includeArchived: boolean;
  token: string;
  configPath?: string;
}

export interface GenerateConfig {
  jsonOutput: string;
  jsonOutputPath: string;
  feedOutput: string;
  feedOutputPath: string;
  feedSitePath: string;
  siteUrl: string;
  feedUrl: string;
  feedTitle: string;
  feedDescription: string;
}

export interface FileStateConfig {
  backend: "file";
  statePath: string;
  statePathAbsolute: string;
  maxEntries: number;
}

export interface FeedUrlStateConfig {
  backend: "feed-url";
  baselineFeedUrl: string;
  maxEntries: number;
}

export interface GitHubBranchStateConfig {
  backend: "github-branch";
  repository: string;
  branch: string;
  statePath: string;
  token: string;
  commitMessage: string;
  maxEntries: number;
}

export type ResolvedStateConfig = FileStateConfig | FeedUrlStateConfig | GitHubBranchStateConfig;

export interface DiscordConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
  bootstrap: DiscordBootstrapMode;
  notifyMode: DiscordNotifyMode;
}

export interface ResolvedConfig extends CommonConfig {
  mode: RunMode;
  generation?: GenerateConfig;
  state?: ResolvedStateConfig;
  discord?: DiscordConfig;
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

export interface StarsSnapshot {
  version: 1;
  generatedAt: string;
  owner: OwnerSummary;
  stats: {
    repoCount: number;
    starCount: number;
  };
  repos: RepositoryWithFetchInfo[];
  stars: StarEvent[];
}

export interface GeneratedStarsData extends StarsSnapshot {
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
}

export interface SeenEventRecord {
  id: string;
  starredAt: string;
}

export interface PendingNotificationBatch {
  batchId: string;
  preparedAt: string;
  events: SeenEventRecord[];
}

export interface SeenEventsState {
  version: 1;
  updatedAt: string;
  events: SeenEventRecord[];
  pending?: PendingNotificationBatch;
}

export interface LoadedState {
  exists: boolean;
  state: SeenEventsState;
  source: string;
}

export interface DiffResult {
  newEvents: StarEvent[];
  nextState: SeenEventsState;
}

export interface NotificationPlan {
  newEvents: StarEvent[];
  preSendState: SeenEventsState;
  postSendState: SeenEventsState;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  url?: string;
  description?: string;
  timestamp?: string;
  author?: {
    name: string;
    url?: string;
    icon_url?: string;
  };
  fields?: DiscordEmbedField[];
}

export interface DiscordWebhookBody {
  content?: string;
  username?: string;
  avatar_url?: string;
  allowed_mentions: {
    parse: string[];
  };
  embeds?: DiscordEmbed[];
}

export interface RunResult {
  snapshot: StarsSnapshot;
  generatedData?: GeneratedStarsData;
  newEvents: StarEvent[];
  discordMessagesSent: number;
}
