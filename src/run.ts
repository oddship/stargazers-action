import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DiscordDeliveryError, buildDiscordMessages, sendDiscordMessages } from "./discord.js";
import { renderRssFeed } from "./feed.js";
import { fetchRecentStarsForRepository, listOwnedRepositories } from "./github.js";
import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";
import { buildGeneratedData, buildStarsSnapshot, normalizeStars, selectRepositories } from "./model.js";
import { ensureNoPendingState, loadState, planNotification, saveState } from "./state.js";
import type { ResolvedConfig, RunResult, StarsSnapshot } from "./types.js";

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function fetchStarsSnapshot(config: ResolvedConfig, logger: Logger = silentLogger): Promise<StarsSnapshot> {
  logger.info(`Discovering public repositories for ${config.owner}...`);
  const { owner, repos } = await listOwnedRepositories(config, logger);

  if (config.repoInclude.length > 0) {
    const discoveredRepoNames = new Set(repos.map((repo) => repo.name.toLowerCase()));
    const missingIncludes = config.repoInclude.filter((repoName) => !discoveredRepoNames.has(repoName));
    if (missingIncludes.length > 0) {
      logger.warn(`Requested repos not found or not public: ${missingIncludes.join(", ")}`);
    }
  }

  const selectedRepos = selectRepositories(repos, config);

  if (selectedRepos.length === 0) {
    logger.warn("No repositories matched the current stargazer configuration.");
  }

  logger.info(`Selected ${selectedRepos.length} repositories out of ${repos.length}.`);

  const fetchedCounts = new Map<string, number>();
  const allStars = [] as Awaited<ReturnType<typeof fetchRecentStarsForRepository>>;

  for (const repo of selectedRepos) {
    const stars = await fetchRecentStarsForRepository(config, repo, logger);
    fetchedCounts.set(repo.nameWithOwner, stars.length);
    allStars.push(...stars);
  }

  return buildStarsSnapshot({
    owner,
    repos: selectedRepos,
    starEvents: normalizeStars(allStars, config.recentLimit),
    fetchedCounts,
  });
}

export async function execute(config: ResolvedConfig, logger: Logger = silentLogger): Promise<RunResult> {
  const snapshot = await fetchStarsSnapshot(config, logger);
  const generatedData = config.generation ? buildGeneratedData(snapshot, config.generation) : undefined;

  if (config.generation && generatedData) {
    await ensureParentDirectory(config.generation.jsonOutputPath);
    await ensureParentDirectory(config.generation.feedOutputPath);

    await writeFile(config.generation.jsonOutputPath, `${JSON.stringify(generatedData, null, 2)}\n`, "utf8");
    await writeFile(config.generation.feedOutputPath, renderRssFeed(generatedData), "utf8");

    logger.info(
      `Wrote ${generatedData.stats.starCount} star events to ${config.generation.jsonOutput} and ${config.generation.feedOutput}.`,
    );
  }

  let newEvents = [] as StarsSnapshot["stars"];
  let discordMessagesSent = 0;

  if (config.state && config.discord) {
    const loaded = await loadState(config.state, logger);
    const writableState = config.state.backend !== "feed-url";

    if (writableState) {
      ensureNoPendingState(loaded);
    }

    const plan = planNotification(snapshot, loaded, {
      bootstrap: config.discord.bootstrap,
      maxEntries: config.state.maxEntries,
    });
    newEvents = plan.newEvents;

    if (newEvents.length > 0) {
      if (writableState) {
        await saveState(config.state, plan.preSendState, logger);
      }

      const messages = buildDiscordMessages({
        snapshot,
        newEvents,
        config: config.discord,
        feedUrl: generatedData?.feed.url,
      });

      try {
        await sendDiscordMessages(config.discord.webhookUrl, messages, logger);
      } catch (error: unknown) {
        if (
          writableState &&
          error instanceof DiscordDeliveryError &&
          error.sentCount === 0 &&
          error.confirmedNotDelivered
        ) {
          try {
            await saveState(config.state, loaded.state, logger);
            logger.warn("Rolled back pending notification state because Discord confirmed no messages were delivered.");
          } catch (rollbackError: unknown) {
            const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
            logger.warn(`Could not roll back pending notification state automatically: ${rollbackMessage}`);
          }
        } else if (writableState) {
          logger.warn(
            `Notification state remains pending after Discord delivery interruption. Resolve the state backend before retrying to avoid duplicates.`,
          );
        }

        throw error;
      }

      discordMessagesSent = messages.length;
      logger.info(`Sent ${messages.length} Discord message(s) covering ${newEvents.length} new event(s).`);
    } else {
      logger.info("No new Discord events to emit.");
    }

    if (writableState) {
      await saveState(config.state, plan.postSendState, logger);
    }
  }

  return {
    snapshot,
    generatedData,
    newEvents,
    discordMessagesSent,
  };
}
