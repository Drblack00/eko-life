// ============================================================
// news.js — News tab aggregator (Phase 3, Gist phone app).
//
// Headline-aggregator hygiene (like Google News): title + source +
// link + a short RSS-provided snippet only. Never scrape article bodies.
// The cache table is the only state; refreshNewsFeeds() is idempotent
// (dedupe by link) and skips failed feeds gracefully.
// ============================================================
import { XMLParser } from 'fast-xml-parser';
import { upsertNewsItem, pruneNewsItems, NEWS_CACHE_MS } from './db.js';

/** Verified working feed URLs — do not guess others. */
export const NEWS_FEEDS = [
  { source: 'Vanguard', url: 'https://www.vanguardngr.com/feed/' },
  { source: 'Punch', url: 'https://rss.punchng.com/v1/category/latest_news' },
  { source: 'Premium Times', url: 'https://www.premiumtimesng.com/feed' },
  { source: 'Channels TV', url: 'https://www.channelstv.com/feed/' },
  { source: 'Legit.ng', url: 'https://www.legit.ng/rss/all.rss' },
  { source: 'Forbes', url: 'https://www.forbes.com/most-popular/feed/' },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // Keep CDATA content: fast-xml-parser folds it into the value by default
  // with cdataTagName; we read both plain and object shapes below.
  cdataTagName: '__cdata',
});

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if (v.__cdata != null) return String(v.__cdata);
    if (v['#text'] != null) return String(v['#text']);
  }
  return '';
}

function linkOf(item) {
  // RSS 2.0: <link>url</link>; Atom: <link href="url"/>
  const l = item.link;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) {
    const alt = l.find(x => typeof x === 'object' && x['@_href']) || l[0];
    return alt && typeof alt === 'object' ? String(alt['@_href'] || '') : String(alt || '');
  }
  if (l && typeof l === 'object' && l['@_href']) return String(l['@_href']);
  return '';
}

/** Strip HTML tags + entities down to plain text. */
export function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(Number(n)); } catch { return ''; } })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse one RSS 2.0 / Atom feed body into plain headline objects.
 * Pure — unit-tested against fixture strings.
 */
export function parseFeedXml(xml, source) {
  let doc;
  try {
    doc = parser.parse(String(xml || ''));
  } catch {
    return [];
  }
  let rawItems = [];
  if (doc.rss && doc.rss.channel) {
    const ch = Array.isArray(doc.rss.channel) ? doc.rss.channel[0] : doc.rss.channel;
    rawItems = ch && ch.item ? (Array.isArray(ch.item) ? ch.item : [ch.item]) : [];
  } else if (doc.feed && doc.feed.entry) {
    rawItems = Array.isArray(doc.feed.entry) ? doc.feed.entry : [doc.feed.entry];
  } else if (doc['rdf:RDF'] && doc['rdf:RDF'].item) {
    const r = doc['rdf:RDF'].item;
    rawItems = Array.isArray(r) ? r : [r];
  }
  const out = [];
  for (const it of rawItems.slice(0, 30)) {
    const title = stripHtml(textOf(it.title));
    const link = String(linkOf(it) || '').trim();
    if (!title || !link) continue;
    const dateRaw = textOf(it.pubDate || it.published || it.updated || it['dc:date']);
    let published_at = null;
    if (dateRaw) {
      const t = Date.parse(dateRaw);
      if (Number.isFinite(t)) published_at = t;
    }
    const snippet = stripHtml(textOf(it.description || it.summary)).slice(0, 160);
    out.push({ source, title: title.slice(0, 300), link, snippet, published_at });
  }
  return out;
}

/** Fetch one feed with a 10s timeout. Throws on failure (caller skips). */
export async function fetchFeed(feed, fetchFn = fetch) {
  const res = await fetchFn(feed.url, {
    signal: AbortSignal.timeout(10000),
    headers: {
      'User-Agent': 'EkoLife-NewsBot/1.0 (+https://ekolife.onrender.com)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!xml || xml.length < 100) throw new Error('empty body');
  return parseFeedXml(xml, feed.source);
}

/**
 * Refresh every feed; upsert headlines (dedupe by link); prune stale rows.
 * Failures are logged and skipped — one dead outlet never blocks the rest.
 */
export async function refreshNewsFeeds({ feeds = NEWS_FEEDS, fetchFn = fetch, log = console } = {}) {
  let stored = 0;
  const errors = [];
  for (const feed of feeds) {
    try {
      const items = await fetchFeed(feed, fetchFn);
      for (const item of items) {
        try {
          await upsertNewsItem(item);
          stored++;
        } catch (e) {
          log.error('[news] upsert:', feed.source, e.message);
        }
      }
    } catch (e) {
      errors.push(`${feed.source}: ${e.message}`);
      log.error('[news] feed failed:', feed.source, '-', e.message);
    }
  }
  try {
    await pruneNewsItems();
  } catch (e) {
    log.error('[news] prune:', e.message);
  }
  return { stored, errors, feeds: feeds.length };
}

export { NEWS_CACHE_MS };
