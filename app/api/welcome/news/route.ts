import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";

const RSS_URL = "https://feeds.bbci.co.uk/news/business/rss.xml";

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

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const res = await fetch(RSS_URL, {
      headers: { "User-Agent": "UnzeCockpit/1.0" },
      next: { revalidate: 900 }, // cache 15 min server-side
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const xml = await res.text();
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
    const stories = itemBlocks.slice(0, 6).map(block => ({
      title: extract("title", block),
      link:  extract("link",  block),
      ago:   timeAgo(extract("pubDate", block)),
    })).filter(s => s.title);
    return Response.json({ stories });
  } catch (err) {
    console.error("News RSS error:", err instanceof Error ? err.message : err);
    return Response.json({ stories: [] });
  }
}
