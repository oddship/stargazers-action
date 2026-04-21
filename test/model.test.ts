import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStars } from "../src/model.js";
import type { StarEvent } from "../src/types.js";

function makeStar(id: string, starredAt: string): StarEvent {
  return {
    id,
    starredAt,
    repo: {
      name: "moat",
      nameWithOwner: "oddship/moat",
      url: "https://github.com/oddship/moat",
      description: "A docs tool.",
    },
    user: {
      login: id,
      url: `https://github.com/${id}`,
      avatarUrl: null,
    },
  };
}

test("normalizeStars sorts descending and removes duplicate ids", () => {
  const stars = normalizeStars(
    [
      makeStar("older", "2026-04-01T00:00:00Z"),
      makeStar("newer", "2026-04-02T00:00:00Z"),
      makeStar("newer", "2026-04-02T00:00:00Z"),
    ],
    10,
  );

  assert.equal(stars.length, 2);
  assert.equal(stars[0]?.user.login, "newer");
  assert.equal(stars[1]?.user.login, "older");
});
