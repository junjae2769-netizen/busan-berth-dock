import { NextResponse } from "next/server";
import { fetchBptRecords } from "@/lib/bpt";
import { sampleRecords } from "@/lib/sample";
import type { BerthFeed } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_MS = 4 * 60 * 1000;
let memo: { at: number; feed: BerthFeed } | null = null;

export async function GET() {
  const now = Date.now();
  if (memo && now - memo.at < CACHE_MS) {
    return respond(memo.feed);
  }
  let feed: BerthFeed;
  try {
    const records = await fetchBptRecords();
    feed = { fetchedAt: new Date(now).toISOString(), source: "live", records };
    memo = { at: now, feed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 이전에 성공한 데이터가 있으면 그걸 유지(stale), 없으면 샘플
    if (memo) {
      feed = { ...memo.feed, error: message };
    } else {
      feed = {
        fetchedAt: new Date(now).toISOString(),
        source: "sample",
        error: message,
        records: sampleRecords(),
      };
    }
  }
  return respond(feed);
}

function respond(feed: BerthFeed) {
  return NextResponse.json(feed, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
    },
  });
}
