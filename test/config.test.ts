import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseListValue, resolveConfig } from "../src/config.js";

test("parseListValue normalizes arrays and owner-qualified repo names", () => {
  assert.deepEqual(parseListValue(["oddship/moat", " stargazers-action "], "oddship"), [
    "moat",
    "stargazers-action",
  ]);
  assert.deepEqual(parseListValue("moat,\nstargazers-action", "oddship"), ["moat", "stargazers-action"]);
});

test("resolveConfig merges config file values with explicit inputs for generate mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "stargazers-action-"));
  await mkdir(path.join(workspace, ".github"), { recursive: true });
  await writeFile(
    path.join(workspace, ".github", "stargazers.yml"),
    [
      "owner: oddship",
      "repo_include:",
      "  - moat",
      "mode: generate",
      "json_output: src/generated/github-stars.json",
      "feed_output: public/feeds/github-stars.xml",
      "site_url: https://oddship.net",
      "feed_title: Oddship GitHub stargazers",
    ].join("\n"),
    "utf8",
  );

  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_ACTIONS = "";

  const resolved = await resolveConfig({
    config: ".github/stargazers.yml",
    repo_exclude: "oddship.net",
    recent_limit: "25",
  });

  assert.equal(resolved.mode, "generate");
  assert.deepEqual(resolved.repoInclude, ["moat"]);
  assert.deepEqual(resolved.repoExclude, ["oddship.net"]);
  assert.equal(resolved.recentLimit, 25);
  assert.equal(resolved.generation?.feedUrl, "https://oddship.net/feeds/github-stars.xml");
  assert.equal(resolved.state, undefined);
  assert.equal(resolved.discord, undefined);
});

test("resolveConfig infers github-branch state backend in GitHub Actions discord mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "stargazers-action-"));
  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_TOKEN = "test-token";
  process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1/abc";
  process.env.GITHUB_ACTIONS = "true";
  process.env.GITHUB_REPOSITORY = "oddship/stargazers-action";

  const resolved = await resolveConfig({
    mode: "discord",
    owner: "oddship",
  });

  assert.equal(resolved.mode, "discord");
  assert.equal(resolved.state?.backend, "github-branch");
  assert.equal(resolved.state && "repository" in resolved.state ? resolved.state.repository : undefined, "oddship/stargazers-action");
  assert.equal(resolved.state && "branch" in resolved.state ? resolved.state.branch : undefined, "stargazers-state");
  assert.equal(resolved.generation, undefined);
  assert.equal(resolved.discord?.webhookUrl, "https://discord.com/api/webhooks/1/abc");
});

test("resolveConfig uses feed-url state backend when baseline_feed_url is provided", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "stargazers-action-"));
  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_TOKEN = "test-token";
  process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1/abc";
  process.env.GITHUB_ACTIONS = "";

  const resolved = await resolveConfig({
    mode: "discord",
    owner: "oddship",
    baseline_feed_url: "https://oddship.net/feeds/github-stars.xml",
  });

  assert.equal(resolved.state?.backend, "feed-url");
  assert.equal(resolved.state && "baselineFeedUrl" in resolved.state ? resolved.state.baselineFeedUrl : undefined, "https://oddship.net/feeds/github-stars.xml");
});

test("resolveConfig rejects output paths outside the workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "stargazers-action-"));
  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_ACTIONS = "";

  await assert.rejects(
    () =>
      resolveConfig({
        owner: "oddship",
        json_output: "src/generated/../../../../tmp/github-stars.json",
        feed_output: "public/feeds/github-stars.xml",
        site_url: "https://oddship.net",
      }),
    /json_output must stay inside the workspace/,
  );
});

test("resolveConfig rejects config paths outside the workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "stargazers-action-"));
  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_ACTIONS = "";

  await assert.rejects(() => resolveConfig({ config: "../outside.yml" }), /config must stay inside the workspace/);
});

test("resolveConfig rejects per_repo_limit values above GitHub's connection limit", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "stargazers-action-"));
  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_ACTIONS = "";

  await assert.rejects(
    () =>
      resolveConfig({
        owner: "oddship",
        per_repo_limit: "101",
        json_output: "src/generated/github-stars.json",
        feed_output: "public/feeds/github-stars.xml",
        site_url: "https://oddship.net",
      }),
    /per_repo_limit must be less than or equal to 100/,
  );
});
