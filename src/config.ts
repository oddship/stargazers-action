import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { ResolvedConfig } from "./types.js";

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

  const rawJsonOutput = resolveRawValue(inputs, config, "json_output");
  const rawFeedOutput = resolveRawValue(inputs, config, "feed_output");
  const rawSiteUrl = resolveRawValue(inputs, config, "site_url");

  if (!isNonEmptyString(rawJsonOutput)) {
    throw new Error("json_output is required.");
  }
  if (!isNonEmptyString(rawFeedOutput)) {
    throw new Error("feed_output is required.");
  }
  if (!isNonEmptyString(rawSiteUrl)) {
    throw new Error("site_url is required.");
  }

  const siteUrl = stripTrailingSlash(new URL(rawSiteUrl.trim()).toString());
  const resolvedJsonOutput = resolveWorkspacePath(workspace, rawJsonOutput.trim(), "json_output");
  const resolvedFeedOutput = resolveWorkspacePath(workspace, rawFeedOutput.trim(), "feed_output");
  const jsonOutput = resolvedJsonOutput.relativePath;
  const feedOutput = resolvedFeedOutput.relativePath;
  const feedSitePath = deriveFeedSitePath(feedOutput);
  const feedUrl = joinUrl(siteUrl, feedSitePath);

  const token = String(
    resolveRawValue(inputs, config, "token") ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "",
  ).trim();
  if (!token) {
    throw new Error("token is required. Pass the action input or set GITHUB_TOKEN.");
  }

  const feedTitleValue = resolveRawValue(inputs, config, "feed_title");
  const feedDescriptionValue = resolveRawValue(inputs, config, "feed_description");

  return {
    workspace,
    owner,
    ownerTypeHint,
    repoInclude: parseListValue(resolveRawValue(inputs, config, "repo_include"), owner),
    repoExclude: parseListValue(resolveRawValue(inputs, config, "repo_exclude"), owner),
    recentLimit,
    perRepoLimit,
    includeForks,
    includeArchived,
    jsonOutput,
    jsonOutputPath: resolvedJsonOutput.absolutePath,
    feedOutput,
    feedOutputPath: resolvedFeedOutput.absolutePath,
    feedSitePath,
    siteUrl,
    feedUrl,
    feedTitle: isNonEmptyString(feedTitleValue) ? feedTitleValue.trim() : `${owner} GitHub stargazers`,
    feedDescription: isNonEmptyString(feedDescriptionValue)
      ? feedDescriptionValue.trim()
      : `Recent GitHub stargazers across selected repositories owned by ${owner}.`,
    token,
    configPath: configFile?.relativePath,
  };
}
