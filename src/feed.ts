import type { GeneratedStarsData } from "./types.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderDescription(repoDescription: string | null, repoUrl: string, userUrl: string): string {
  const parts = [] as string[];
  if (repoDescription) {
    parts.push(repoDescription);
  }
  parts.push(`Repo: ${repoUrl}`);
  parts.push(`Profile: ${userUrl}`);
  return parts.join("\n");
}

export function renderRssFeed(data: GeneratedStarsData): string {
  const items = data.stars
    .map((star) => {
      const title = `${star.user.login} starred ${star.repo.nameWithOwner}`;
      const description = renderDescription(star.repo.description, star.repo.url, star.user.url);

      return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(star.repo.url)}</link>
      <guid isPermaLink="false">${escapeXml(star.id)}</guid>
      <pubDate>${escapeXml(new Date(star.starredAt).toUTCString())}</pubDate>
      <description>${escapeXml(description)}</description>
      <category>${escapeXml(star.repo.nameWithOwner)}</category>
    </item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(data.feed.title)}</title>
    <link>${escapeXml(data.site.url)}</link>
    <description>${escapeXml(data.feed.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${escapeXml(new Date(data.generatedAt).toUTCString())}</lastBuildDate>
    <atom:link href="${escapeXml(data.feed.url)}" rel="self" type="application/rss+xml" />${items}
  </channel>
</rss>
`;
}
