import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type {
  DiscordBootstrapMode,
  DiscordConfig,
  DiscordNotifyMode,
  GenerateConfig,
  ResolvedConfig,
  ResolvedStateConfig,
  RunMode,
  StateBackend,
} from "./types.js";

type RawInputMap = Record<string, string | undefined>;
type RawConfigFile = Record<string, unknown>;

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function getRawConfigValue(config: RawConfigFile, key: string): unknown {
  if (key in config) {
    return config[key];
  }

  const camelKey = toCamelCase(key);
  if (camelKey in config) {
    return config[camelKey];
  }

  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseInteger(value: unknown, fallback: number, label: string, maxValue?: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  if (maxValue !== undefined && parsed > maxValue) {
    throw new Error(`${label} must be less than or equal to ${maxValue}.`);
  }

  return parsed;
}

function parseBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${label} must be a boolean.`);
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  label: string,
): T {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase() as T;
  if (!allowed.includes(normalized)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }

  return normalized;
}

export function parseListValue(value: unknown, owner?: string): string[] {
  const values = Array.isArray(value)
    ? value.map((item) => String(item))
    : typeof value === "string"
      ? value
          .split(/[,\n]/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

  const prefix = owner ? `${owner.toLowerCase()}/` : "";

  return values
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase())
    .map((item) => (prefix && item.startsWith(prefix) ? item.slice(prefix.length) : item));
}

function resolveWorkspacePath(
  workspace: string,
  candidatePath: string,
  label: string,
): { relativePath: string; absolutePath: string } {
  const trimmed = candidatePath.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    throw new Error(`${label} must be a relative path inside the workspace.`);
  }

  const absolutePath = path.resolve(workspace, trimmed);
  const relativePath = path.relative(workspace, absolutePath);

  if (
    !relativePath ||
    relativePath === "." ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside the workspace.`);
  }

  return {
    relativePath: relativePath.split(path.sep).join("/"),
    absolutePath,
  };
}

function normalizeRepoRelativePath(candidatePath: string, label: string): string {
  const trimmed = candidatePath.trim();
  if (!trimmed || path.isAbsolute(trimmed)) {
    throw new Error(`${label} must be a relative repository path.`);
  }

  const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must stay inside the repository.`);
  }

  return normalized.replace(/^\/+/, "");
}

function deriveFeedSitePath(feedOutput: string): string {
  if (feedOutput.startsWith("public/")) {
    return `/${feedOutput.slice("public/".length)}`;
  }
  if (feedOutput.startsWith("static/")) {
    return `/${feedOutput.slice("static/".length)}`;
  }
  return `/${feedOutput}`;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function joinUrl(base: string, sitePath: string): string {
  return `${stripTrailingSlash(base)}${sitePath.startsWith("/") ? sitePath : `/${sitePath}`}`;
}

async function readConfigFile(workspace: string, configPath: string): Promise<{ config: RawConfigFile; relativePath: string }> {
  const resolvedConfigPath = resolveWorkspacePath(workspace, configPath, "config");
  const raw = await readFile(resolvedConfigPath.absolutePath, "utf8");
  const parsed = resolvedConfigPath.relativePath.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file ${resolvedConfigPath.relativePath} must contain an object.`);
  }

  return {
    config: parsed as RawConfigFile,
    relativePath: resolvedConfigPath.relativePath,
  };
}

function resolveRawValue(inputs: RawInputMap, config: RawConfigFile, key: string): unknown {
  const inputValue = inputs[key];
  if (isNonEmptyString(inputValue)) {
    return inputValue;
  }
  return getRawConfigValue(config, key);
}

function readOptionalString(inputs: RawInputMap, config: RawConfigFile, key: string): string | undefined {
  const value = resolveRawValue(inputs, config, key);
  return isNonEmptyString(value) ? value.trim() : undefined;
}

function parseMode(value: unknown): RunMode {
  return parseEnum<RunMode>(value, ["generate", "discord", "generate-and-discord"], "generate", "mode");
}

function modeIncludesGenerate(mode: RunMode): boolean {
  return mode === "generate" || mode === "generate-and-discord";
}

function modeIncludesDiscord(mode: RunMode): boolean {
  return mode === "discord" || mode === "generate-and-discord";
}

function resolveGenerationConfig(inputs: RawInputMap, config: RawConfigFile, workspace: string): GenerateConfig {
  const rawJsonOutput = resolveRawValue(inputs, config, "json_output");
  const rawFeedOutput = resolveRawValue(inputs, config, "feed_output");
  const rawSiteUrl = resolveRawValue(inputs, config, "site_url");

  if (!isNonEmptyString(rawJsonOutput)) {
    throw new Error("json_output is required when mode includes generate.");
  }
  if (!isNonEmptyString(rawFeedOutput)) {
    throw new Error("feed_output is required when mode includes generate.");
  }
  if (!isNonEmptyString(rawSiteUrl)) {
    throw new Error("site_url is required when mode includes generate.");
  }

  const siteUrl = stripTrailingSlash(new URL(rawSiteUrl.trim()).toString());
  const resolvedJsonOutput = resolveWorkspacePath(workspace, rawJsonOutput.trim(), "json_output");
  const resolvedFeedOutput = resolveWorkspacePath(workspace, rawFeedOutput.trim(), "feed_output");
  const jsonOutput = resolvedJsonOutput.relativePath;
  const feedOutput = resolvedFeedOutput.relativePath;
  const feedSitePath = deriveFeedSitePath(feedOutput);
  const feedUrl = joinUrl(siteUrl, feedSitePath);

  const rawFeedTitle = resolveRawValue(inputs, config, "feed_title");
  const rawFeedDescription = resolveRawValue(inputs, config, "feed_description");
  const owner = String(resolveRawValue(inputs, config, "owner") ?? "").trim();

  return {
    jsonOutput,
    jsonOutputPath: resolvedJsonOutput.absolutePath,
    feedOutput,
    feedOutputPath: resolvedFeedOutput.absolutePath,
    feedSitePath,
    siteUrl,
    feedUrl,
    feedTitle: isNonEmptyString(rawFeedTitle) ? rawFeedTitle.trim() : `${owner} GitHub stargazers`,
    feedDescription: isNonEmptyString(rawFeedDescription)
      ? rawFeedDescription.trim()
      : `Recent GitHub stargazers across selected repositories owned by ${owner}.`,
  };
}

function resolveStateBackend(inputs: RawInputMap, config: RawConfigFile): StateBackend {
  const explicit = readOptionalString(inputs, config, "state_backend");
  if (explicit) {
    return parseEnum<StateBackend>(explicit, ["file", "feed-url", "github-branch"], "file", "state_backend");
  }

  if (readOptionalString(inputs, config, "baseline_feed_url")) {
    return "feed-url";
  }

  return process.env.GITHUB_ACTIONS === "true" ? "github-branch" : "file";
}

function resolveStateConfig(
  inputs: RawInputMap,
  config: RawConfigFile,
  workspace: string,
  token: string,
): ResolvedStateConfig {
  const backend = resolveStateBackend(inputs, config);
  const maxEntries = parseInteger(resolveRawValue(inputs, config, "state_max_entries"), 500, "state_max_entries", 5000);

  if (backend === "feed-url") {
    const baselineFeedUrl = readOptionalString(inputs, config, "baseline_feed_url");
    if (!baselineFeedUrl) {
      throw new Error("baseline_feed_url is required when state_backend=feed-url.");
    }

    return {
      backend,
      baselineFeedUrl: new URL(baselineFeedUrl).toString(),
      maxEntries,
    };
  }

  const rawStatePath = readOptionalString(inputs, config, "state_path") ?? ".stargazers/state.json";

  if (backend === "file") {
    const resolved = resolveWorkspacePath(workspace, rawStatePath, "state_path");
    return {
      backend,
      statePath: resolved.relativePath,
      statePathAbsolute: resolved.absolutePath,
      maxEntries,
    };
  }

  const repository = readOptionalString(inputs, config, "state_repository") ?? process.env.GITHUB_REPOSITORY ?? "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("state_repository must be in owner/repo format when state_backend=github-branch.");
  }

  return {
    backend,
    repository,
    branch: readOptionalString(inputs, config, "state_branch") ?? "stargazers-state",
    statePath: normalizeRepoRelativePath(rawStatePath, "state_path"),
    token: readOptionalString(inputs, config, "state_token") ?? token,
    commitMessage:
      readOptionalString(inputs, config, "state_commit_message") ?? "chore: update stargazers notification state",
    maxEntries,
  };
}

function resolveDiscordConfig(inputs: RawInputMap, config: RawConfigFile): DiscordConfig {
  const webhookUrl =
    readOptionalString(inputs, config, "discord_webhook_url") ?? process.env.DISCORD_WEBHOOK_URL ?? "";

  if (!webhookUrl) {
    throw new Error("discord_webhook_url is required when mode includes discord.");
  }

  return {
    webhookUrl: new URL(webhookUrl).toString(),
    username: readOptionalString(inputs, config, "discord_username"),
    avatarUrl: readOptionalString(inputs, config, "discord_avatar_url"),
    bootstrap: parseEnum<DiscordBootstrapMode>(
      resolveRawValue(inputs, config, "discord_bootstrap"),
      ["silent", "send-all"],
      "silent",
      "discord_bootstrap",
    ),
    notifyMode: parseEnum<DiscordNotifyMode>(
      resolveRawValue(inputs, config, "discord_notify_mode"),
      ["summary", "per-star"],
      "summary",
      "discord_notify_mode",
    ),
  };
}

export async function resolveConfig(inputs: RawInputMap): Promise<ResolvedConfig> {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const rawConfigPath = inputs.config?.trim();
  const configFile = rawConfigPath ? await readConfigFile(workspace, rawConfigPath) : null;
  const config = configFile?.config ?? {};

  const ownerValue = resolveRawValue(inputs, config, "owner");
  if (!isNonEmptyString(ownerValue)) {
    throw new Error("owner is required.");
  }
  const owner = ownerValue.trim();

  const mode = parseMode(resolveRawValue(inputs, config, "mode"));
  const ownerTypeValue = String(resolveRawValue(inputs, config, "owner_type") ?? "auto").trim().toLowerCase();
  const ownerTypeHint = ownerTypeValue === "user" || ownerTypeValue === "organization" ? ownerTypeValue : "auto";
  const recentLimit = parseInteger(resolveRawValue(inputs, config, "recent_limit"), 40, "recent_limit");
  const perRepoLimit = parseInteger(
    resolveRawValue(inputs, config, "per_repo_limit"),
    Math.min(Math.max(recentLimit, 40), 100),
    "per_repo_limit",
    100,
  );
  const includeForks = parseBoolean(resolveRawValue(inputs, config, "include_forks"), false, "include_forks");
  const includeArchived = parseBoolean(resolveRawValue(inputs, config, "include_archived"), false, "include_archived");

  const token = String(
    resolveRawValue(inputs, config, "token") ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "",
  ).trim();
  if (!token) {
    throw new Error("token is required. Pass the action input or set GITHUB_TOKEN.");
  }

  return {
    workspace,
    owner,
    ownerTypeHint,
    mode,
    repoInclude: parseListValue(resolveRawValue(inputs, config, "repo_include"), owner),
    repoExclude: parseListValue(resolveRawValue(inputs, config, "repo_exclude"), owner),
    recentLimit,
    perRepoLimit,
    includeForks,
    includeArchived,
    token,
    generation: modeIncludesGenerate(mode) ? resolveGenerationConfig(inputs, config, workspace) : undefined,
    state: modeIncludesDiscord(mode) ? resolveStateConfig(inputs, config, workspace, token) : undefined,
    discord: modeIncludesDiscord(mode) ? resolveDiscordConfig(inputs, config) : undefined,
    configPath: configFile?.relativePath,
  };
}
