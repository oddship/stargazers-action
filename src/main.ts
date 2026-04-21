import * as core from "@actions/core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveConfig } from "./config.js";
import { renderRssFeed } from "./feed.js";
import { fetchRecentStarsForRepository, listOwnedRepositories } from "./github.js";
import { buildGeneratedData, normalizeStars, selectRepositories } from "./model.js";

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function run(): Promise<void> {
  const inputNames = [
    "owner",
    "owner_type",
    "repo_include",
    "repo_exclude",
    "recent_limit",
    "per_repo_limit",
    "include_forks",
    "include_archived",
    "json_output",
    "feed_output",
    "site_url",
    "feed_title",
    "feed_description",
    "config",
    "token",
  ];

  const rawInputs = Object.fromEntries(inputNames.map((name) => [name, core.getInput(name)]));
  const config = await resolveConfig(rawInputs);

  core.info(`Discovering public repositories for ${config.owner}...`);
  const { owner, repos } = await listOwnedRepositories(config);

  if (config.repoInclude.length > 0) {
    const discoveredRepoNames = new Set(repos.map((repo) => repo.name.toLowerCase()));
    const missingIncludes = config.repoInclude.filter((repoName) => !discoveredRepoNames.has(repoName));
    if (missingIncludes.length > 0) {
      core.warning(`Requested repos not found or not public: ${missingIncludes.join(", ")}`);
    }
  }

  const selectedRepos = selectRepositories(repos, config);

  if (selectedRepos.length === 0) {
    core.warning("No repositories matched the current stargazer configuration.");
  }

  core.info(`Selected ${selectedRepos.length} repositories out of ${repos.length}.`);

  const fetchedCounts = new Map<string, number>();
  const allStars = [] as Awaited<ReturnType<typeof fetchRecentStarsForRepository>>;

  for (const repo of selectedRepos) {
    const stars = await fetchRecentStarsForRepository(config, repo);
    fetchedCounts.set(repo.nameWithOwner, stars.length);
    allStars.push(...stars);
  }

  const recentStars = normalizeStars(allStars, config.recentLimit);
  const data = buildGeneratedData({
    config,
    owner,
    repos: selectedRepos,
    starEvents: recentStars,
    fetchedCounts,
  });

  await ensureParentDirectory(config.jsonOutputPath);
  await ensureParentDirectory(config.feedOutputPath);

  await writeFile(config.jsonOutputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await writeFile(config.feedOutputPath, renderRssFeed(data), "utf8");

  core.setOutput("json-path", config.jsonOutput);
  core.setOutput("feed-path", config.feedOutput);
  core.setOutput("feed-url", config.feedUrl);
  core.setOutput("repo-count", String(data.stats.repoCount));
  core.setOutput("star-count", String(data.stats.starCount));

  core.info(`Wrote ${data.stats.starCount} star events to ${config.jsonOutput} and ${config.feedOutput}.`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
