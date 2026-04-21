import type { Logger } from "./logger.js";
import { silentLogger } from "./logger.js";
import type {
  DiscordConfig,
  DiscordEmbed,
  DiscordWebhookBody,
  StarEvent,
  StarsSnapshot,
} from "./types.js";

export class DiscordDeliveryError extends Error {
  readonly sentCount: number;
  readonly total: number;
  readonly confirmedNotDelivered: boolean;

  constructor(
    message: string,
    options: {
      sentCount: number;
      total: number;
      confirmedNotDelivered: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "DiscordDeliveryError";
    this.sentCount = options.sentCount;
    this.total = options.total;
    this.confirmedNotDelivered = options.confirmedNotDelivered;
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks = [] as T[][];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildStarEmbed(star: StarEvent): DiscordEmbed {
  const starredAtEpoch = Math.floor(new Date(star.starredAt).getTime() / 1000);

  return {
    title: `${star.user.login} starred ${star.repo.nameWithOwner}`,
    url: star.repo.url,
    description: star.repo.description ? truncate(star.repo.description, 280) : undefined,
    timestamp: star.starredAt,
    author: {
      name: star.user.login,
      url: star.user.url,
      icon_url: star.user.avatarUrl ?? undefined,
    },
    fields: [
      {
        name: "Repository",
        value: `[${star.repo.nameWithOwner}](${star.repo.url})`,
        inline: true,
      },
      {
        name: "Profile",
        value: `[${star.user.login}](${star.user.url})`,
        inline: true,
      },
      {
        name: "Starred",
        value: `<t:${starredAtEpoch}:R>`,
        inline: true,
      },
    ],
  };
}

export function buildDiscordMessages(params: {
  snapshot: StarsSnapshot;
  newEvents: StarEvent[];
  config: DiscordConfig;
  feedUrl?: string;
}): DiscordWebhookBody[] {
  if (params.newEvents.length === 0) {
    return [];
  }

  const messageBase = {
    allowed_mentions: { parse: [] as string[] },
    username: params.config.username,
    avatar_url: params.config.avatarUrl,
  };

  if (params.config.notifyMode === "per-star") {
    return params.newEvents.map((star) => ({
      ...messageBase,
      content: params.feedUrl ? `Feed: ${params.feedUrl}` : undefined,
      embeds: [buildStarEmbed(star)],
    }));
  }

  const repoCount = new Set(params.newEvents.map((star) => star.repo.nameWithOwner)).size;
  const chunks = chunk(params.newEvents, 10);

  return chunks.map((stars, index) => ({
    ...messageBase,
    content:
      index === 0
        ? [
            `**${params.newEvents.length} new GitHub ${pluralize(params.newEvents.length, "stargazer")}** across ${repoCount} ${pluralize(repoCount, "repo")} for \`${params.snapshot.owner.login}\``,
            params.feedUrl ? `Feed: ${params.feedUrl}` : undefined,
          ]
            .filter(Boolean)
            .join("\n")
        : `Continued (${index + 1}/${chunks.length})`,
    embeds: stars.map((star) => buildStarEmbed(star)),
  }));
}

export async function sendDiscordMessages(
  webhookUrl: string,
  messages: DiscordWebhookBody[],
  logger: Logger = silentLogger,
): Promise<void> {
  for (const [index, message] of messages.entries()) {
    const url = new URL(webhookUrl);
    url.searchParams.set("wait", "true");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "oddship-stargazers-action",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new DiscordDeliveryError(
          `Discord webhook request ${index + 1}/${messages.length} failed: ${response.status} ${errorText}`,
          {
            sentCount: index,
            total: messages.length,
            confirmedNotDelivered: true,
          },
        );
      }

      logger.info(`Posted Discord webhook message ${index + 1}/${messages.length}.`);
    } catch (error: unknown) {
      if (error instanceof DiscordDeliveryError) {
        throw error;
      }

      const messageText = error instanceof Error ? error.message : String(error);
      throw new DiscordDeliveryError(
        `Discord webhook request ${index + 1}/${messages.length} failed before completion: ${messageText}`,
        {
          sentCount: index,
          total: messages.length,
          confirmedNotDelivered: false,
          cause: error,
        },
      );
    }
  }
}
