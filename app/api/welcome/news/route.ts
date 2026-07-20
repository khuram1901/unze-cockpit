import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";

const FEEDS = [
  { source: "BBC",         url: "https://feeds.bbci.co.uk/news/business/rss.xml",       color: "#BB1919" },
  { source: "Sky News",    url: "https://feeds.skynews.com/feeds/rss/business.xml",      color: "#003DA5" },
  { source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml",              color: "#009E49" },
];

function extract(tag: string, block: string): string {
  const cdata = block.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  if (cdata) return cdata[1].trim();
  const plain = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return plain ? plain[1].trim().replace(/<[^>]+>/g, "") : "";
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function fetchFeed(feed: typeof FEEDS[0]) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "UnzeCockpit/1.0" },
      next: { revalidate: 900 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
    return itemBlocks.slice(0, 4).map(block => ({
      title:  extract("title",   block),
      link:   extract("link",    block),
      ago:    timeAgo(extract("pubDate", block)),
      source: feed.source,
      color:  feed.color,
    })).filter(s => s.title);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  // Fetch all three feeds in parallel; failures are silent (returns [])
  const results = await Promise.all(FEEDS.map(fetchFeed));

  // Round-robin interleave: BBC[0], Sky[0], AJ[0], BBC[1], Sky[1], AJ[1]...
  const stories: typeof results[0] = [];
  const maxLen = Math.max(...results.map(r => r.length));
  for (let i = 0; i < maxLen; i++) {
    for (const feed of results) {
      if (feed[i]) stories.push(feed[i]);
    }
  }

  return Response.json({ stories: stories.slice(0, 9) });
}
