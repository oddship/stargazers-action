import { consoleLogger } from "./logger.js";
import { resolveConfig } from "./config.js";
import { execute } from "./run.js";

type RawInputMap = Record<string, string | undefined>;

const HELP = `stargazers-action

Usage:
  stargazers [generate|discord|generate-and-discord] [--config path] [--key value]

Examples:
  stargazers generate --config .github/stargazers.yml --token "$GITHUB_TOKEN"
  stargazers discord --config .github/stargazers.yml --discord-webhook-url "$DISCORD_WEBHOOK_URL"
  stargazers generate-and-discord --config .github/stargazers.yml

Flags map directly to action/config keys using kebab-case or snake_case:
  --owner oddship
  --json-output src/generated/github-stars.json
  --feed-output public/feeds/github-stars.xml
  --state-backend github-branch
  --state-path .stargazers/state.json
  --baseline-feed-url https://oddship.net/feeds/github-stars.xml
  --discord-webhook-url "$DISCORD_WEBHOOK_URL"
`;

function normalizeFlagName(flag: string): string {
  return flag.slice(2).replaceAll("-", "_");
}

function parseArgs(argv: string[]): RawInputMap {
  const inputs = {} as RawInputMap;
  let index = 0;

  if (argv[0] && !argv[0].startsWith("-")) {
    inputs.mode = argv[0];
    index = 1;
  }

  while (index < argv.length) {
    const arg = argv[index];

    if (!arg) {
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = normalizeFlagName(arg);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      inputs[key] = "true";
      index += 1;
      continue;
    }

    inputs[key] = next;
    index += 2;
  }

  return inputs;
}

async function main(): Promise<void> {
  const inputs = parseArgs(process.argv.slice(2));
  const config = await resolveConfig(inputs);
  const result = await execute(config, consoleLogger);

  console.log(
    JSON.stringify(
      {
        mode: config.mode,
        repoCount: result.snapshot.stats.repoCount,
        starCount: result.snapshot.stats.starCount,
        newEventCount: result.newEvents.length,
        discordMessageCount: result.discordMessagesSent,
        jsonPath: config.generation?.jsonOutput,
        feedPath: config.generation?.feedOutput,
        feedUrl: config.generation?.feedUrl,
        stateBackend: config.state?.backend,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
