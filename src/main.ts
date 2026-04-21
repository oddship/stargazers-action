import * as core from "@actions/core";
import { resolveConfig } from "./config.js";
import { execute } from "./run.js";

const actionLogger = {
  info(message: string): void {
    core.info(message);
  },
  warn(message: string): void {
    core.warning(message);
  },
  error(message: string): void {
    core.error(message);
  },
};

async function run(): Promise<void> {
  const inputNames = [
    "mode",
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
    "state_backend",
    "state_path",
    "state_max_entries",
    "baseline_feed_url",
    "state_repository",
    "state_branch",
    "state_token",
    "state_commit_message",
    "discord_webhook_url",
    "discord_username",
    "discord_avatar_url",
    "discord_bootstrap",
    "discord_notify_mode",
    "config",
    "token",
  ];

  const rawInputs = Object.fromEntries(inputNames.map((name) => [name, core.getInput(name)]));
  const config = await resolveConfig(rawInputs);
  const result = await execute(config, actionLogger);

  core.setOutput("mode", config.mode);
  core.setOutput("repo-count", String(result.snapshot.stats.repoCount));
  core.setOutput("star-count", String(result.snapshot.stats.starCount));
  core.setOutput("new-event-count", String(result.newEvents.length));
  core.setOutput("discord-message-count", String(result.discordMessagesSent));

  if (config.state) {
    core.setOutput("state-backend", config.state.backend);
  }

  if (config.generation) {
    core.setOutput("json-path", config.generation.jsonOutput);
    core.setOutput("feed-path", config.generation.feedOutput);
    core.setOutput("feed-url", config.generation.feedUrl);
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
