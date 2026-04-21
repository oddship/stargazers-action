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

test("resolveConfig merges config file values with explicit inputs", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "stargazers-action-"));
  await mkdir(path.join(workspace, ".github"), { recursive: true });
  await writeFile(path.join(workspace, ".placeholder"), "", "utf8");
  await writeFile(
    path.join(workspace, ".github", "stargazers.yml"),
    [
      "owner: oddship",
      "repo_include:",
      "  - moat",
      "json_output: src/generated/github-stars.json",
      "feed_output: public/feeds/github-stars.xml",
      "site_url: https://oddship.net",
      "feed_title: Oddship GitHub stargazers",
    ].join("\n"),
    "utf8",
  );

  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_TOKEN = "test-token";

  const resolved = await resolveConfig({
    config: ".github/stargazers.yml",
    repo_exclude: "oddship.net",
    recent_limit: "25",
  });

  assert.equal(resolved.owner, "oddship");
  assert.deepEqual(resolved.repoInclude, ["moat"]);
  assert.deepEqual(resolved.repoExclude, ["oddship.net"]);
  assert.equal(resolved.recentLimit, 25);
  assert.equal(resolved.feedUrl, "https://oddship.net/feeds/github-stars.xml");
});

test("resolveConfig rejects output paths outside the workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "stargazers-action-"));
  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_TOKEN = "test-token";

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

  await assert.rejects(() => resolveConfig({ config: "../outside.yml" }), /config must stay inside the workspace/);
});

test("resolveConfig rejects per_repo_limit values above GitHub's connection limit", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "stargazers-action-"));
  process.env.GITHUB_WORKSPACE = workspace;
  process.env.GITHUB_TOKEN = "test-token";

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
