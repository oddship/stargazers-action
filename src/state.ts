import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";
import { buildStateRecords, createEmptyState, mergeSeenEvents } from "./model.js";
import type {
  DiffResult,
  FileStateConfig,
  GitHubBranchStateConfig,
  LoadedState,
  NotificationPlan,
  PendingNotificationBatch,
  ResolvedStateConfig,
  SeenEventRecord,
  SeenEventsState,
  StarsSnapshot,
} from "./types.js";

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function collectTagValues(xml: string, tagName: string): string[] {
  const matches = xml.matchAll(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi"));
  return Array.from(matches)
    .map((match) => decodeXmlEntities(match[1]?.trim() ?? ""))
    .filter(Boolean);
}

export function extractEventIdsFromFeedXml(xml: string): SeenEventRecord[] {
  const guidValues = collectTagValues(xml, "guid");
  const values = guidValues.length > 0 ? guidValues : collectTagValues(xml, "id");

  return values.map((id) => ({
    id,
    starredAt: "",
  }));
}

function normalizePendingBatch(value: unknown, source: string): PendingNotificationBatch | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Pending notification state from ${source} must be an object.`);
  }

  const raw = value as { batchId?: unknown; preparedAt?: unknown; events?: unknown };
  if (typeof raw.batchId !== "string" || typeof raw.preparedAt !== "string" || !Array.isArray(raw.events)) {
    throw new Error(`Pending notification state from ${source} is invalid.`);
  }

  return {
    batchId: raw.batchId,
    preparedAt: raw.preparedAt,
    events: raw.events.map((event) => {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new Error(`Pending notification state from ${source} contains an invalid event.`);
      }

      const rawEvent = event as { id?: unknown; starredAt?: unknown };
      if (typeof rawEvent.id !== "string" || typeof rawEvent.starredAt !== "string") {
        throw new Error(`Pending notification state from ${source} contains an invalid event record.`);
      }

      return {
        id: rawEvent.id,
        starredAt: rawEvent.starredAt,
      };
    }),
  };
}

function normalizeState(value: unknown, source: string): SeenEventsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`State from ${source} must be an object.`);
  }

  const raw = value as { version?: unknown; updatedAt?: unknown; events?: unknown; pending?: unknown };
  if (raw.version !== 1) {
    throw new Error(`State from ${source} must have version=1.`);
  }
  if (typeof raw.updatedAt !== "string") {
    throw new Error(`State from ${source} must include updatedAt.`);
  }
  if (!Array.isArray(raw.events)) {
    throw new Error(`State from ${source} must include an events array.`);
  }

  return {
    version: 1,
    updatedAt: raw.updatedAt,
    events: raw.events.map((event) => {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new Error(`State from ${source} contains an invalid event.`);
      }

      const rawEvent = event as { id?: unknown; starredAt?: unknown };
      if (typeof rawEvent.id !== "string" || typeof rawEvent.starredAt !== "string") {
        throw new Error(`State from ${source} contains an invalid event record.`);
      }

      return {
        id: rawEvent.id,
        starredAt: rawEvent.starredAt,
      };
    }),
    pending: normalizePendingBatch(raw.pending, source),
  };
}

function serializeState(state: SeenEventsState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

async function loadStateFromFile(config: FileStateConfig): Promise<LoadedState> {
  try {
    const raw = await readFile(config.statePathAbsolute, "utf8");
    return {
      exists: true,
      state: normalizeState(JSON.parse(raw), config.statePath),
      source: `file:${config.statePath}`,
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        exists: false,
        state: createEmptyState(),
        source: `file:${config.statePath}`,
      };
    }
    throw error;
  }
}

async function saveStateToFile(config: FileStateConfig, state: SeenEventsState): Promise<void> {
  await mkdir(path.dirname(config.statePathAbsolute), { recursive: true });
  await writeFile(config.statePathAbsolute, serializeState(state), "utf8");
}

async function loadStateFromFeedUrl(url: string): Promise<LoadedState> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
      "User-Agent": "oddship-stargazers-action",
    },
  });

  if (response.status === 404) {
    return {
      exists: false,
      state: createEmptyState(),
      source: `feed-url:${url}`,
    };
  }

  if (!response.ok) {
    throw new Error(`Could not load baseline feed ${url}: ${response.status} ${response.statusText}.`);
  }

  const xml = await response.text();
  return {
    exists: true,
    state: {
      version: 1,
      updatedAt: new Date().toISOString(),
      events: extractEventIdsFromFeedXml(xml),
    },
    source: `feed-url:${url}`,
  };
}

type GitHubRepoMetadata = {
  default_branch: string;
};

type GitHubRefResponse = {
  object: {
    sha: string;
  };
};

type GitHubContentResponse = {
  sha: string;
  content: string;
  encoding: string;
};

function githubBranchPermissionHint(status: number): string {
  return status === 403 ? " Ensure workflow permissions include contents: write when using state_backend=github-branch." : "";
}

function buildGitHubApiUrl(repository: string, suffix: string): string {
  return `https://api.github.com/repos/${repository}${suffix}`;
}

function buildGitHubContentsUrl(repository: string, filePath: string, ref?: string): string {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = new URL(buildGitHubApiUrl(repository, `/contents/${encodedPath}`));
  if (ref) {
    url.searchParams.set("ref", ref);
  }
  return url.toString();
}

async function requestGitHubJson(url: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "oddship-stargazers-action",
      ...(init?.headers ?? {}),
    },
  });
}

async function ensureBranchExists(config: GitHubBranchStateConfig): Promise<void> {
  const refResponse = await requestGitHubJson(
    buildGitHubApiUrl(config.repository, `/git/ref/heads/${encodeURIComponent(config.branch)}`),
    config.token,
  );

  if (refResponse.ok) {
    return;
  }

  if (refResponse.status !== 404) {
    throw new Error(
      `Could not inspect branch ${config.repository}@${config.branch}: ${refResponse.status} ${refResponse.statusText}.${githubBranchPermissionHint(refResponse.status)}`,
    );
  }

  const repoResponse = await requestGitHubJson(buildGitHubApiUrl(config.repository, ""), config.token);
  if (!repoResponse.ok) {
    throw new Error(
      `Could not inspect repository ${config.repository}: ${repoResponse.status} ${repoResponse.statusText}.${githubBranchPermissionHint(repoResponse.status)}`,
    );
  }
  const repo = (await repoResponse.json()) as GitHubRepoMetadata;

  const defaultRefResponse = await requestGitHubJson(
    buildGitHubApiUrl(config.repository, `/git/ref/heads/${encodeURIComponent(repo.default_branch)}`),
    config.token,
  );
  if (!defaultRefResponse.ok) {
    throw new Error(
      `Could not read default branch ${repo.default_branch} for ${config.repository}: ${defaultRefResponse.status} ${defaultRefResponse.statusText}.${githubBranchPermissionHint(defaultRefResponse.status)}`,
    );
  }
  const defaultRef = (await defaultRefResponse.json()) as GitHubRefResponse;

  const createResponse = await requestGitHubJson(buildGitHubApiUrl(config.repository, "/git/refs"), config.token, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${config.branch}`,
      sha: defaultRef.object.sha,
    }),
  });

  if (!createResponse.ok && createResponse.status !== 422) {
    throw new Error(
      `Could not create branch ${config.branch} in ${config.repository}: ${createResponse.status} ${createResponse.statusText}.${githubBranchPermissionHint(createResponse.status)}`,
    );
  }
}

async function loadStateFromGitHubBranch(config: GitHubBranchStateConfig): Promise<LoadedState> {
  const response = await requestGitHubJson(
    buildGitHubContentsUrl(config.repository, config.statePath, config.branch),
    config.token,
  );

  if (response.status === 404) {
    return {
      exists: false,
      state: createEmptyState(),
      source: `github-branch:${config.repository}@${config.branch}:${config.statePath}`,
    };
  }

  if (!response.ok) {
    throw new Error(
      `Could not load state from ${config.repository}@${config.branch}:${config.statePath}: ${response.status} ${response.statusText}.${githubBranchPermissionHint(response.status)}`,
    );
  }

  const payload = (await response.json()) as GitHubContentResponse;
  if (payload.encoding !== "base64") {
    throw new Error(`Unsupported content encoding for ${config.repository}@${config.branch}:${config.statePath}.`);
  }

  const raw = Buffer.from(payload.content.replaceAll("\n", ""), "base64").toString("utf8");
  return {
    exists: true,
    state: normalizeState(JSON.parse(raw), `${config.repository}@${config.branch}:${config.statePath}`),
    source: `github-branch:${config.repository}@${config.branch}:${config.statePath}`,
  };
}

async function saveStateToGitHubBranch(config: GitHubBranchStateConfig, state: SeenEventsState): Promise<void> {
  await ensureBranchExists(config);

  const existingResponse = await requestGitHubJson(
    buildGitHubContentsUrl(config.repository, config.statePath, config.branch),
    config.token,
  );

  let sha: string | undefined;
  if (existingResponse.ok) {
    const payload = (await existingResponse.json()) as GitHubContentResponse;
    sha = payload.sha;
  } else if (existingResponse.status !== 404) {
    throw new Error(
      `Could not inspect existing state file ${config.repository}@${config.branch}:${config.statePath}: ${existingResponse.status} ${existingResponse.statusText}.${githubBranchPermissionHint(existingResponse.status)}`,
    );
  }

  const response = await requestGitHubJson(buildGitHubContentsUrl(config.repository, config.statePath), config.token, {
    method: "PUT",
    body: JSON.stringify({
      message: config.commitMessage,
      content: Buffer.from(serializeState(state), "utf8").toString("base64"),
      branch: config.branch,
      sha,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Could not save state to ${config.repository}@${config.branch}:${config.statePath}: ${response.status} ${response.statusText}.${githubBranchPermissionHint(response.status)}`,
    );
  }
}

export async function loadState(config: ResolvedStateConfig, logger: Logger = silentLogger): Promise<LoadedState> {
  logger.info(`Loading notification state via ${config.backend}...`);

  if (config.backend === "file") {
    return loadStateFromFile(config);
  }
  if (config.backend === "feed-url") {
    return loadStateFromFeedUrl(config.baselineFeedUrl);
  }
  return loadStateFromGitHubBranch(config);
}

export async function saveState(
  config: ResolvedStateConfig,
  state: SeenEventsState,
  logger: Logger = silentLogger,
): Promise<void> {
  if (config.backend === "feed-url") {
    logger.info(`State backend ${config.backend} is read-only; skipping persistence.`);
    return;
  }

  logger.info(`Persisting notification state via ${config.backend}...`);

  if (config.backend === "file") {
    await saveStateToFile(config, state);
    return;
  }

  await saveStateToGitHubBranch(config, state);
}

export function diffSnapshotAgainstState(
  snapshot: StarsSnapshot,
  loaded: LoadedState,
  options: {
    bootstrap: "silent" | "send-all";
    maxEntries: number;
  },
): DiffResult {
  const seenIds = new Set(loaded.state.events.map((event) => event.id));
  const rawNewEvents = snapshot.stars.filter((star) => !seenIds.has(star.id));
  const newEvents = !loaded.exists && options.bootstrap === "silent" ? [] : rawNewEvents;

  return {
    newEvents,
    nextState: {
      version: 1,
      updatedAt: snapshot.generatedAt,
      events: mergeSeenEvents(buildStateRecords(snapshot.stars), loaded.state.events, options.maxEntries),
    },
  };
}

export function ensureNoPendingState(loaded: LoadedState): void {
  const pending = loaded.state.pending;
  if (!pending || pending.events.length === 0) {
    return;
  }

  throw new Error(
    `Notification state at ${loaded.source} has unresolved pending batch ${pending.batchId}. A previous run may have already sent Discord notifications. Resolve or clear the pending state before retrying to avoid duplicates.`,
  );
}

function buildPendingBatch(snapshot: StarsSnapshot, newEvents: StarsSnapshot["stars"]): PendingNotificationBatch {
  const records = buildStateRecords(newEvents);
  return {
    batchId: `${snapshot.generatedAt}:${records.length}:${records[0]?.id ?? "none"}`,
    preparedAt: snapshot.generatedAt,
    events: records,
  };
}

export function planNotification(
  snapshot: StarsSnapshot,
  loaded: LoadedState,
  options: {
    bootstrap: "silent" | "send-all";
    maxEntries: number;
  },
): NotificationPlan {
  const diff = diffSnapshotAgainstState(snapshot, loaded, options);

  if (diff.newEvents.length === 0) {
    return {
      newEvents: [],
      preSendState: diff.nextState,
      postSendState: diff.nextState,
    };
  }

  return {
    newEvents: diff.newEvents,
    preSendState: {
      version: 1,
      updatedAt: snapshot.generatedAt,
      events: loaded.state.events,
      pending: buildPendingBatch(snapshot, diff.newEvents),
    },
    postSendState: diff.nextState,
  };
}
