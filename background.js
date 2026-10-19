// Service worker: fetches the feeds, normalizes them, caches the result.
// The panel and popup only ever read from that cache, so opening is instant.

importScripts("shared/data.js");

const REFRESH_MINUTES = 30;
// How stale the cache may be before opening the panel triggers a fetch.
// Opening it twice in a minute shouldn't hit every feed twice.
// Measured against our own feeds: only about 1 in 8 publishers honours
// If-None-Match. The rest return a full 200 regardless, so a refresh costs
// real bandwidth and this threshold has to stay conservative.
const STALE_AFTER_MS = 5 * 60 * 1000;
// Refreshing just the topic you're reading is ~4 requests instead of ~35,
// which is cheap enough to do whenever you open or switch tabs.
const TOPIC_STALE_AFTER_MS = 60 * 1000;
// Per-feed item cache, so a 304 can be answered from memory.
const CACHE_PER_FEED = 15;
// How many outlets to offer for one story before it stops being useful.
const MAX_SOURCES_PER_STORY = 5;
// How many stories the Trending tab gathers.
const TRENDING_SIZE = 6;
const MAX_PER_TOPIC = 3;
// The cache holds more than it shows, so each surface can skip what you've
// already seen without going back to the network.
const POOL_PER_TOPIC = 8;
// A week-old item is not "what's new" — better to show nothing than to pad.
const MAX_AGE_HOURS = 168;
// Only this recent earns the "new" marker.
const FRESH_HOURS = 24;
const FETCH_TIMEOUT_MS = 10000;
// Feeds vary wildly — some ship a sentence, some ship the entire article.
// Truncation happens at parse time so a full body never reaches the cache:
// this is a lead to help you decide, not a copy of the piece.
const SUMMARY_MAX = 150;
const ALARM = "drift-refresh";
const DAILY_KEY = "last_daily_open";
const BUBBLE_SCRIPT_ID = "drift-bubble";

// ---------- what isn't news ----------
//
// Feeds carry more than journalism. Wired's RSS ships its affiliate coupon
// pages; CBS Sports ships sportsbook promos. Measured over a day of live
// feeds these are 2% of everything fetched, and every single match was
// checked by hand — none of them is a story.
const NOT_NEWS = new RegExp([
  "\\b(promo|coupon|discount) codes?\\b",
  "\\bgift guide\\b", "\\bbest gifts\\b",
  "\\b\\d+% off\\b", "\\b\\$\\d+ off\\b",
  "\\bdeals?\\b[^.]*\\bfor \\$\\d",
  "\\bprime day\\b",
  "\\b(wordle|quordle|connections|crossword|sudoku|strands)\\b[^.]*\\b(answer|answers|hint|hints|clue|clues)\\b",
  "^crossword\\b", "\\bhoroscope\\b",
  "\\b(parlay|prop bets|best bets|daily fantasy|dfs)\\b",
  "\\bbetting (preview|promo)\\b",
].join("|"), "i");

// Real reporting, but derivative: recaps, rankings, listicles. These are worth
// keeping for a quiet day in their own topic, and never worth a Trending slot.
const LOW_VALUE = new RegExp([
  "\\btakeaways\\b", "\\bwinners and losers\\b", "\\bpower rankings\\b",
  "\\bmock draft\\b", "\\bwaiver wire\\b", "\\bfantasy (football|baseball|basketball)\\b",
  "\\bwhat we learned\\b", "\\bthings we learned\\b",
  "^(the )?\\d+ (best|worst|things|ways|reasons|tips|tricks|gifts|gadgets|alternatives)\\b",
  "\\bhow to watch\\b", "\\bwhere to watch\\b", "\\bwatch live\\b",
  "\\b(review )?roundup\\b", "\\bweek in review\\b",
  "\\bodds, (start )?time\\b", "\\bprediction, odds\\b", "\\bpicks by\\b",
].join("|"), "i");

// ---------- a small RSS/Atom reader ----------
// MV3 service workers have no DOM, so DOMParser isn't available here.
// Feeds are a narrow, predictable shape, so this reads them directly.

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z#0-9]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function clean(text) {
  if (!text) return "";
  return decodeEntities(
    text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function pickTag(block, tag) {
  const match = block.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
  return match ? match[1] : "";
}

function pickLink(block) {
  // Atom puts the URL in an attribute; RSS puts it in the element body.
  const atom = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
    || block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (atom) return decodeEntities(atom[1].trim());

  const rss = clean(pickTag(block, "link"));
  if (rss) return rss;

  return clean(pickTag(block, "guid"));
}

// A one-line lead, taken from whatever the feed offers.
function pickSummary(block, title) {
  let best = "";
  for (const tag of ["description", "summary", "content:encoded", "content"]) {
    const text = clean(pickTag(block, tag));
    if (text.length > best.length) best = text;
  }

  if (!best) return "";

  // Some feeds just repeat the headline; that's noise, not context.
  const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalize(best).startsWith(normalize(title)) && best.length < title.length * 1.4) {
    return "";
  }
  if (best.length < 30) return "";

  if (best.length <= SUMMARY_MAX) return best;

  // cut on a word boundary so it reads as a sentence trailing off
  const cut = best.slice(0, SUMMARY_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > SUMMARY_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:—-]+$/, "") + "…";
}

function pickDate(block) {
  const raw =
    pickTag(block, "pubDate") ||
    pickTag(block, "published") ||
    pickTag(block, "updated") ||
    pickTag(block, "dc:date");

  const parsed = new Date(clean(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseFeed(xml, sourceName) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];

  return blocks
    .map((block, index) => {
      const title = clean(pickTag(block, "title"));
      return {
        title,
        ...(LOW_VALUE.test(title) ? { lowValue: true } : {}),
        summary: pickSummary(block, title),
        url: pickLink(block),
        source: sourceName,
        // Where the outlet placed it. Editors lead with what they think
        // matters, which is free editorial judgement we'd otherwise discard.
        feedPosition: index,
        publishedAt: pickDate(block) || new Date().toISOString(),
      };
    })
    .filter((item) =>
      item.title && /^https?:\/\//i.test(item.url) && !NOT_NEWS.test(item.title)
    );
}

// ---------- ranking ----------
//
// Sorting purely by timestamp surfaces filler: a wallpapers post outranks real
// news just by being newer, and a week-old item leads a slow topic while
// wearing a "new" badge. So: drop the stale, then let agreement between
// independent sources decide what matters.

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "could", "every", "from", "have",
  "into", "more", "most", "nach", "over", "said", "says", "some", "such",
  "than", "that", "their", "them", "then", "there", "these", "they", "this",
  "were", "what", "when", "where", "which", "while", "will", "with", "would",
  "your", "been", "being", "just", "like", "make", "made", "much", "only",
  "other", "still", "take", "very", "year", "years",
]);

function titleTokens(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
  );
}

// Plain word overlap can't tell "both about the NFL" from "the same story":
// two outlets covering one event share rare proper nouns ("Jagex", "Nemotron"),
// while unrelated pieces in a topic share its common vocabulary ("season",
// "predictions"). So weight each word by how rare it is in the batch.
function buildWeights(tokenSets) {
  const docFreq = new Map();
  tokenSets.forEach((set) =>
    set.forEach((word) => docFreq.set(word, (docFreq.get(word) || 0) + 1))
  );

  const total = Math.max(1, tokenSets.length);
  const weights = new Map();
  docFreq.forEach((count, word) => {
    weights.set(word, Math.log(1 + total / count));
  });
  return weights;
}

function weightOf(weights, word) {
  return weights.get(word) ?? Math.log(2);
}

// Weighted Jaccard: shared rare words count for much more than shared common ones.
function similarity(a, b, weights = new Map()) {
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  let union = 0;

  a.forEach((word) => {
    const w = weightOf(weights, word);
    union += w;
    if (b.has(word)) shared += w;
  });
  b.forEach((word) => {
    if (!a.has(word)) union += weightOf(weights, word);
  });

  return union === 0 ? 0 : shared / union;
}

// Tuned empirically against a day of live feeds. Biased toward over-merging:
// losing a story to a false merge is invisible, but the same story twice in a
// three-item list is the redundancy that makes people stop opening this.
const SAME_STORY = 0.30;

// Overlap as a *proportion* of the headline penalises a vivid one. Measured
// live, the Guardian's "Four people killed in 'violent, fast-moving' fire at
// Canadian military base" and NPR's "Carney says 4 service members killed ...
// at Alberta military base" are one story, but the Guardian's extra colour
// dilutes the ratio below the bar — so four outlets were counted as two
// pairs, halving the strongest signal there is. A second test catches these:
// enough rare words in common, close enough in time. Rarity is counted in
// units of a word seen exactly once in the batch, so the bar doesn't drift
// as the batch grows.
const SHARED_WORDS = 3;
const SHARED_RARITY = 2.6;
const SAME_STORY_WINDOW_H = 48;

function sharedRarity(a, b, weights) {
  let weight = 0;
  let count = 0;
  a.forEach((word) => {
    if (!b.has(word)) return;
    weight += weightOf(weights, word);
    count += 1;
  });
  return { weight, count };
}

function hoursApart(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 3.6e6;
}

function sameStory(cluster, tokens, item, weights, singleSighting) {
  if (similarity(cluster.tokens, tokens, weights) >= SAME_STORY) return true;

  const { weight, count } = sharedRarity(cluster.tokens, tokens, weights);
  if (count < SHARED_WORDS) return false;
  if (weight < SHARED_RARITY * singleSighting) return false;
  return hoursApart(item.publishedAt, cluster.item.publishedAt) <= SAME_STORY_WINDOW_H;
}

function ageHours(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / 3.6e6;
}

// Collapse the same story reported by several sources into one item, and
// remember how many sources carried it — agreement is the strongest signal
// we can get without a model.
function cluster(items) {
  const tokenSets = items.map((item) => titleTokens(item.title));
  const weights = buildWeights(tokenSets);
  // What one word is worth if it appears exactly once in this batch.
  const singleSighting = Math.log(1 + Math.max(1, items.length));
  const clusters = [];

  items.forEach((item, index) => {
    const tokens = tokenSets[index];
    const match = clusters.find((c) => sameStory(c, tokens, item, weights, singleSighting));

    if (match) {
      match.sources.add(item.source);
      match.topics.push(item.topicId);
      match.members.push(item);
      // keep the earliest report; it's usually the one that broke it
      if (new Date(item.publishedAt) < new Date(match.item.publishedAt)) {
        match.item = item;
      }
      // but credit the best placement any outlet gave it
      match.bestPosition = Math.min(match.bestPosition, item.feedPosition ?? 9);
    } else {
      clusters.push({
        item,
        tokens,
        sources: new Set([item.source]),
        topics: [item.topicId],
        members: [item],
        bestPosition: item.feedPosition ?? 9,
      });
    }
  });

  return clusters.map((c) => {
    // One row per outlet, newest first, so the reader can pick who to read it
    // from rather than being handed whichever copy we happened to keep.
    const bySource = new Map();
    for (const member of c.members) {
      const existing = bySource.get(member.source);
      if (!existing || new Date(member.publishedAt) > new Date(existing.publishedAt)) {
        bySource.set(member.source, member);
      }
    }

    const coverage = [...bySource.values()]
      .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
      .slice(0, MAX_SOURCES_PER_STORY)
      .map((member) => ({
        source: member.source,
        url: member.url,
        ...(member.paywall ? { paywall: true } : {}),
      }));

    // The earliest report leads — but never let a recap speak for the story
    // it recaps. If any outlet filed the real thing, that's the one shown.
    const reporting = c.members.filter((member) => !member.lowValue);
    const candidates = reporting.length ? reporting : c.members;
    const lead = candidates.reduce((earliest, member) =>
      new Date(member.publishedAt) < new Date(earliest.publishedAt) ? member : earliest
    );

    // If it shipped no summary, borrow one from another outlet rather than
    // showing a bare headline.
    const summary =
      lead.summary || c.members.find((member) => member.summary)?.summary || "";

    return {
      ...lead,
      summary,
      corroboration: c.sources.size,
      feedPosition: c.bestPosition,
      fresh: ageHours(lead.publishedAt) < FRESH_HOURS,
      topics: c.topics,
      coverage: coverage.length > 1 ? coverage : undefined,
    };
  });
}

// Ranking by recency hands every slot to whichever outlet publishes fastest:
// measured live, Dev.to held all ten top slots in Programming, and Axios
// outranked the NYT in World purely on volume. Interleaving by source gives
// each outlet its best story before any outlet gets a second one, so a
// selective publisher isn't buried by a prolific one.
function interleaveBySource(ranked, limit) {
  const bySource = new Map();
  for (const item of ranked) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }

  // Sources are visited in the order their best story ranked.
  const queues = [...bySource.values()];
  const out = [];

  for (let round = 0; out.length < limit; round += 1) {
    let placed = false;
    for (const queue of queues) {
      if (!queue[round]) continue;
      out.push(queue[round]);
      placed = true;
      if (out.length >= limit) break;
    }
    if (!placed) break;
  }

  return out;
}

const LOW_VALUE_DRAG = 6;

// How much a story matters, from signals we can actually observe. Recency used
// to decide this on its own, which is why a wallpaper roundup could outrank
// real news simply by being newer.
function importance(item) {
  // Independent outlets choosing the same story is the strongest signal
  // available without a model, and it outweighs everything else here.
  const agreement = (item.corroboration - 1) * 3.5;

  // A story that belongs to two of your topics is bigger than one that
  // belongs to a single corner of your interests.
  const breadth = (new Set(item.topics || []).size - 1) * 2;

  // Position in the feed: the lead item is the outlet's own front page.
  const placement = Math.max(0, 1.5 - (item.feedPosition ?? 9) * 0.15);

  // Recency still counts, but it no longer wins on its own.
  const age = ageHours(item.publishedAt);
  const freshness = Math.max(0, 3 - age / 10);

  // Agreement shouldn't let a five-day-old story lead a daily digest, so
  // anything past two days carries a growing drag.
  const staleness = age > 48 ? (age - 48) / 36 : 0;

  // A recap of a game is not the game. Heavy enough that derivative pieces
  // sit below real reporting, light enough that a quiet topic can still
  // show one rather than nothing.
  const derivative = item.lowValue ? LOW_VALUE_DRAG : 0;

  return agreement + breadth + placement + freshness - staleness - derivative;
}

function rank(items) {
  return cluster(items)
    .map((item) => ({ ...item, score: Number(importance(item).toFixed(3)) }))
    .sort((a, b) => b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt));
}

// Where a topic sits on your dashboard is a statement about how much you care
// about it, so Trending reads it that way. The weight is a multiplier rather
// than a flat penalty, which is the behaviour worth having: a genuinely big
// story in your last topic still makes it, while a routine one — a contract
// extension, a player ejected for spitting — no longer takes a slot from the
// topics you put first.
// Measured as a fraction of the way down your list rather than a fixed step
// per place, so it reads the same whether you follow three topics or fifteen:
// your first topic counts for its full weight, your last for a little over
// half, everything else in between.
const TOPIC_SPREAD = 0.6;

// The topic a story counts as, for Trending's purposes: the highest one it
// belongs to on your dashboard. A story that is both AI news and sports news
// is judged as AI news if that's what you ranked higher.
function leadTopic(item, order) {
  let best = -1;
  for (const id of new Set(item.topics || [])) {
    const index = order.indexOf(id);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

function topicWeight(item, order) {
  if (order.length < 2) return 1;
  const index = leadTopic(item, order);
  const rank = index < 0 ? order.length - 1 : index;
  return 1 - TOPIC_SPREAD * (rank / (order.length - 1));
}

// How few corroborated stories still makes a tab worth showing. Below this
// the gap is topped up, above it Trending simply runs short — padding six
// slots on a thin day is how a digest fills up with things nobody needed.
const TRENDING_MIN = 3;

// The best of everything you follow, in one place. A story earns a place by
// being covered independently by more than one outlet — that is what makes it
// trending rather than merely recent, and it is the clearest evidence
// available that something actually matters.
function buildTrending(ranked, order = []) {
  // Weighting a negative score by anything would flatter it, so only scores
  // that earned something get scaled.
  const weighted = ranked
    .filter((item) => !item.lowValue)
    .map((item) => ({
      item,
      score: item.score > 0 ? item.score * topicWeight(item, order) : item.score,
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);

  const corroborated = weighted.filter((item) => item.corroboration > 1);
  const rest = weighted.filter((item) => item.corroboration === 1);

  // One topic shouldn't be the whole of Trending even if it is your first:
  // the point of the tab is a look across everything you follow. Capping by
  // topic rejects candidates, so each shortlist has to be longer than the
  // number of slots or the tab comes up short for the wrong reason.
  const shortlist = TRENDING_SIZE * 4;
  const cap = Math.max(2, Math.ceil(TRENDING_SIZE / Math.max(1, order.length)));

  const seen = new Set();
  const perTopic = new Map();
  const out = [];

  function fill(pool, limit) {
    for (const item of interleaveBySource(pool, shortlist)) {
      if (out.length >= limit) return;
      if (seen.has(item.url)) continue;
      const topic = leadTopic(item, order);
      if ((perTopic.get(topic) || 0) >= cap) continue;
      seen.add(item.url);
      perTopic.set(topic, (perTopic.get(topic) || 0) + 1);
      out.push(item);
    }
  }

  fill(corroborated, TRENDING_SIZE);
  // Only if agreement alone can't make a usable tab: enough to be worth
  // opening, and not one story more.
  if (out.length < TRENDING_MIN) fill(rest, TRENDING_MIN);
  return out;
}

// ---------- fetching ----------

// Validators and parsed items from the last fetch of each feed, so an
// unchanged feed costs one 304 and no parsing.
async function readFeedCache() {
  const { feed_cache: cache } = await chrome.storage.local.get({ feed_cache: {} });
  return cache;
}

async function fetchFeed(feed, cache) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const previous = cache[feed.url];

  const headers = {};
  if (previous?.etag) headers["If-None-Match"] = previous.etag;
  if (previous?.lastModified) headers["If-Modified-Since"] = previous.lastModified;

  try {
    const response = await fetch(feed.url, { signal: controller.signal, headers });

    // Nothing new since last time — the publisher sent no body at all.
    if (response.status === 304 && previous?.items) {
      return { items: previous.items, entry: previous, changed: false };
    }

    if (!response.ok) throw new Error("HTTP " + response.status);

    const items = parseFeed(await response.text(), feed.name);
    // Carried through to the UI so a reader knows before clicking, not after.
    if (feed.paywall) items.forEach((item) => { item.paywall = true; });
    return {
      items,
      entry: {
        etag: response.headers.get("ETag") || null,
        lastModified: response.headers.get("Last-Modified") || null,
        items: items.slice(0, CACHE_PER_FEED),
      },
      changed: true,
    };
  } catch (error) {
    // One dead feed shouldn't empty a topic. Fall back to whatever we had.
    console.warn("[Drift] feed failed:", feed.url, error.message);
    return { items: previous?.items || [], entry: previous, changed: false };
  } finally {
    clearTimeout(timer);
  }
}

// Raw items for one topic, tagged so clustering can run across all of them.
async function fetchTopicItems(topic, feeds, cache, nextCache, skipNetwork) {
  // Clustering runs across every topic, so a single-topic refresh still needs
  // the others' items — it just takes them from cache instead of the network.
  const results = skipNetwork
    ? feeds.map((feed) => ({ items: cache[feed.url]?.items || [], entry: cache[feed.url], changed: false }))
    : await Promise.all(feeds.map((feed) => fetchFeed(feed, cache)));

  feeds.forEach((feed, index) => {
    if (results[index].entry) nextCache[feed.url] = results[index].entry;
  });

  const seen = new Set();

  return results.flatMap((result) => result.items).filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    item.topicId = topic.id;
    return ageHours(item.publishedAt) <= MAX_AGE_HOURS;
  });
}

// Clustering runs across every followed topic at once, so a story that is both
// AI news and startup news collapses into one item instead of appearing twice
// in two tabs. The cluster lands in whichever topic carried it most, with the
// user's own topic order breaking ties.
function assignToTopics(clusters, topicOrder) {
  const byTopic = {};
  topicOrder.forEach((id) => {
    byTopic[id] = [];
  });

  for (const cluster of clusters) {
    const counts = new Map();
    for (const id of cluster.topics) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    let best = null;
    let bestCount = -1;
    for (const id of topicOrder) {
      const count = counts.get(id) || 0;
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    }

    if (best && byTopic[best]) byTopic[best].push(cluster);
  }

  return byTopic;
}

async function topicStamps() {
  const { topic_fetched_at: stamps } = await chrome.storage.local.get({ topic_fetched_at: {} });
  return stamps;
}

// Concurrent callers share one fetch rather than each starting their own.
// Keyed so a single-topic refresh doesn't get handed a full refresh's promise.
const inFlight = new Map();

function refresh(only, fromCache) {
  const key = (fromCache ? "cache:" : "") + (only || "*");
  if (!inFlight.has(key)) {
    inFlight.set(key, doRefresh(only, fromCache).finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

// Re-rank what's already been fetched. Dragging a topic to a new place on the
// dashboard changes what Trending thinks is important, which is a question
// about ranking, not about the network — the feeds have nothing new to say.
function rerank() {
  return refresh(undefined, true);
}

// Called when a surface opens or switches tabs: refetches just that topic if
// its own feeds have gone stale.
async function refreshTopicIfStale(topicId) {
  if (!topicId || !getTopic(topicId)) return null;

  const stamps = await topicStamps();
  const { fetched_at: wholeCache } = await chrome.storage.local.get({ fetched_at: 0 });
  const last = Math.max(stamps[topicId] || 0, wholeCache);

  if (Date.now() - last < TOPIC_STALE_AFTER_MS) return null;
  return refresh(topicId);
}

// Refresh only if the cache has gone stale — this is what the panel calls
// each time it opens.
async function refreshIfStale() {
  const { fetched_at: fetchedAt, articles } = await chrome.storage.local.get({
    fetched_at: 0,
    articles: {},
  });

  const isEmpty = Object.keys(articles).length === 0;
  if (isEmpty || Date.now() - fetchedAt > STALE_AFTER_MS) return refresh();
  return articles;
}

async function doRefresh(only, fromCache) {
  const { selected_topics: selected } = await chrome.storage.sync.get({
    selected_topics: DEFAULT_TOPIC_IDS,
  });

  const all = selected.map(getTopic).filter(Boolean);

  // Permission is checked per feed, never per topic. chrome.permissions
  // .contains() is all-or-nothing, so checking a whole topic at once meant
  // adding one new source to an existing topic blacked out that entire topic
  // until the new origin was granted. A topic now uses whichever of its feeds
  // it can reach, and only goes quiet if it can reach none of them.
  const reachable = await Promise.all(
    all.map(async (topic) => {
      const checks = await Promise.all(
        topic.feeds.map((feed) => {
          const origin = originOfFeed(feed.url);
          return origin ? hasOrigins([origin]) : Promise.resolve(false);
        })
      );
      return topic.feeds.filter((_, index) => checks[index]);
    })
  );

  const topics = all.filter((_, index) => reachable[index].length > 0);
  const topicFeeds = reachable.filter((feeds) => feeds.length > 0);

  const cache = await readFeedCache();
  const nextCache = {};
  const fetched = await Promise.all(
    topics.map((topic, index) =>
      fetchTopicItems(topic, topicFeeds[index], cache, nextCache,
                      fromCache || (Boolean(only) && topic.id !== only))
    )
  );

  const order = topics.map((topic) => topic.id);
  const rankedAll = rank(fetched.flat());
  const grouped = assignToTopics(rankedAll, order);

  // Keep empty topics in the map — "quiet today" is a real answer, and
  // dropping the key would make the panel think the fetch failed.
  // A pool rather than exactly three: the surfaces trim it against what
  // you've already seen.
  const articles = {};
  selected.forEach((id) => {
    articles[id] = [];
  });
  articles[TRENDING_ID] = buildTrending(rankedAll, order);
  order.forEach((id) => {
    articles[id] = interleaveBySource(grouped[id] || [], POOL_PER_TOPIC)
      // `topics` carries one entry per source article so assignment can count
      // them; it has done its job by now and shouldn't bloat the cache.
      .map(({ topics, ...article }) => article);
  });

  const stamp = { articles, feed_cache: nextCache };
  // Re-ranking fetched nothing, so it can't make the cache any fresher.
  if (fromCache) delete stamp.fetched_at;
  else if (!only) stamp.fetched_at = Date.now();
  else stamp.topic_fetched_at = { ...(await topicStamps()), [only]: Date.now() };

  await chrome.storage.local.set(stamp);
  await updateBadge(articles);
  return articles;
}

// ---------- host access ----------

async function hasOrigins(origins) {
  if (!origins.length) return true;
  try {
    return await chrome.permissions.contains({ origins });
  } catch (error) {
    return false;
  }
}

// The floating bubble needs to run on every page, which is a big ask. It is
// registered only once the user has actually turned it on and granted access,
// so a toolbar-only install never requests page access at all.
async function syncBubbleScript() {
  const [{ display_mode: mode }, allowed] = await Promise.all([
    chrome.storage.sync.get({ display_mode: DEFAULT_DISPLAY_MODE }),
    hasOrigins(["<all_urls>"]),
  ]);

  let registered = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts({
      ids: [BUBBLE_SCRIPT_ID],
    });
  } catch (error) {
    registered = [];
  }

  const wanted = mode === "bubble" && allowed;

  if (wanted && registered.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: BUBBLE_SCRIPT_ID,
      matches: ["<all_urls>"],
      js: ["shared/data.js", "shared/reorder.js", "content/content.js"],
      runAt: "document_idle",
      allFrames: false,
      persistAcrossSessions: true,
    }]);
  } else if (!wanted && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [BUBBLE_SCRIPT_ID] });
  }
}

// ---------- reading history ----------
//
// Kept locally and never sent anywhere. Pruned so it can't grow without bound.

const HISTORY_LIMIT = 500;
const HISTORY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function prune(record) {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  const entries = Object.entries(record)
    .filter(([, value]) => (value?.t ?? value) > cutoff)
    .sort((a, b) => (b[1]?.t ?? b[1]) - (a[1]?.t ?? a[1]))
    .slice(0, HISTORY_LIMIT);
  return Object.fromEntries(entries);
}

async function markSeen(urls) {
  if (!urls?.length) return;
  const { seen_urls: seen } = await chrome.storage.local.get({ seen_urls: {} });
  const now = Date.now();

  for (const url of urls) {
    const previous = seen[url];
    seen[url] = { n: (previous?.n || 0) + 1, t: now };
  }

  await chrome.storage.local.set({ seen_urls: prune(seen) });
  await updateBadge();
}

async function markOpened(url) {
  if (!url) return;
  const { opened_urls: opened } = await chrome.storage.local.get({ opened_urls: {} });
  opened[url] = { t: Date.now() };
  await chrome.storage.local.set({ opened_urls: prune(opened) });
  await updateBadge();
}

// ---------- what's actually worth your attention ----------
//
// "Fresh" alone isn't enough: a story you already opened isn't news to you.
// This counts topics holding something both recent and unread, and is the
// basis for both the toolbar badge and whether the daily check-in fires.

async function unreadTopicCount(articles) {
  const [{ selected_topics: selected }, local] = await Promise.all([
    chrome.storage.sync.get({ selected_topics: DEFAULT_TOPIC_IDS }),
    chrome.storage.local.get({ opened_urls: {}, seen_urls: {} }),
  ]);

  const history = { opened: local.opened_urls, seen: local.seen_urls };

  let count = 0;
  for (const id of selected) {
    const picked = pickStories(articles[id], history, 3);
    if (picked.some((article) => article.fresh)) count += 1;
  }
  return count;
}

async function updateBadge(articles) {
  const source = articles || (await chrome.storage.local.get({ articles: {} })).articles;
  const count = await unreadTopicCount(source);

  try {
    await chrome.action.setBadgeText({ text: count ? String(count) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#C7A97B" });
    await chrome.action.setBadgeTextColor({ color: "#2A2418" });
  } catch (error) {
    // badge APIs are best-effort; never let them break a refresh
  }
}

// ---------- the once-a-day check-in ----------
//
// "When they open their laptop" isn't something Chrome can observe: most
// people never quit the browser, so runtime.onStartup never fires for them.
// So this is measured as the first browser activity on a new calendar date,
// watched from several angles — startup, window focus, tab switches, alarms.

let checkedDate = null; // in-memory fast path; tab switches are frequent
let dailyCheck = null;  // in-flight guard; triggers can fire simultaneously

async function openDigest() {
  // Marks the next surface open as unprompted, so it knows to be gentler.
  // The surface clears it, so a deliberate open a minute later is unfiltered.
  await chrome.storage.local.set({ unprompted_open: Date.now() });

  // openPopup() needs a focused window and can be refused; the tab always works.
  try {
    await chrome.action.openPopup();
    return "popup";
  } catch (error) {
    console.warn("[Drift] openPopup unavailable:", error?.message);
  }

  await chrome.tabs.create({
    url: chrome.runtime.getURL("daily/daily.html"),
    active: true,
  });
  return "tab";
}

// Focus and tab-activation can fire in the same tick at startup. Without this,
// each one reads "not shown yet" before any of them writes, and you get three
// popups. Concurrent callers share the one check.
function maybeShowDaily() {
  if (!dailyCheck) {
    dailyCheck = runDailyCheck().finally(() => {
      dailyCheck = null;
    });
  }
  return dailyCheck;
}

async function runDailyCheck() {
  const { daily_open: enabled, day_starts_at: startHour } = await chrome.storage.sync.get({
    daily_open: true,
    day_starts_at: DAY_STARTS_AT_HOUR,
  });
  if (!enabled) return;

  // Don't greet someone who is up late. This guard is needed on its own: if
  // yesterday stayed quiet and news lands at 02:00, the shifted date alone
  // would still let the digest fire in the middle of the night.
  if (tooEarlyToOpen(startHour)) return;

  const today = todayKey(null, startHour);
  if (checkedDate === today) return;   // only set once we've actually opened

  const stored = await chrome.storage.local.get({ [DAILY_KEY]: null });
  if (stored[DAILY_KEY] === today) {
    checkedDate = today;
    return;
  }

  // Don't re-evaluate on every tab switch for the rest of a quiet day.
  const { daily_quiet_until: quietUntil } = await chrome.storage.local.get({
    daily_quiet_until: 0,
  });
  if (Date.now() < quietUntil) return;

  const articles = await refreshIfStale();
  const worthIt = await unreadTopicCount(articles);

  // Nothing recent and unread. Interrupting someone to show them what they
  // already read is how this feature gets switched off, so stay quiet — and
  // deliberately don't claim the day, so it can still fire when news lands.
  if (worthIt === 0) {
    await chrome.storage.local.set({ daily_quiet_until: Date.now() + 30 * 60 * 1000 });
    console.log("[Drift] daily check-in skipped — nothing new worth opening for");
    return;
  }

  // Claim today before doing anything slow, so two triggers firing at once
  // can't both decide they're first.
  await chrome.storage.local.set({ [DAILY_KEY]: today, daily_quiet_until: 0 });
  checkedDate = today;

  const how = await openDigest();
  console.log(`[Drift] daily check-in shown via ${how} (${worthIt} topics with news)`);
}

// ---------- schedule ----------

function scheduleRefresh() {
  chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MINUTES });
}

chrome.runtime.onInstalled.addListener((details) => {
  scheduleRefresh();
  refresh();
  syncBubbleScript();
  // Nothing has been granted yet on a fresh install, so send people somewhere
  // that explains the product and asks for what it needs.
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRefresh();
  refresh();
  maybeShowDaily();
  syncBubbleScript();
});

// A focused window or a tab switch means someone is actually at the keyboard —
// which is the moment a popup can anchor to something and be seen.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) maybeShowDaily();
});

chrome.tabs.onActivated.addListener(() => {
  maybeShowDaily();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    refresh();
    maybeShowDaily(); // catches a browser left open across midnight
  }
});

// Following a new topic should fill it in right away, not at the next alarm.
// Merely reordering the ones you already follow shouldn't cost 35 requests,
// though — that's a drag of the tab strip, and it only changes the ranking.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;

  if (changes.selected_topics) {
    const before = changes.selected_topics.oldValue || [];
    const after = changes.selected_topics.newValue || [];
    const sameSet =
      before.length === after.length && after.every((id) => before.includes(id));
    if (sameSet) rerank();
    else refresh();
  }

  if (changes.display_mode) syncBubbleScript();
});

// Granting or revoking host access changes what we can fetch and whether the
// bubble may run, so react to both.
chrome.permissions.onAdded.addListener(() => {
  syncBubbleScript();
  refresh();
});
chrome.permissions.onRemoved.addListener(() => {
  syncBubbleScript();
  refresh();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (message?.type === "REFRESH") {
    refresh().then((articles) => sendResponse({ articles }));
    return true; // keep the channel open for the async reply
  }

  if (message?.type === "MARK_SEEN") {
    markSeen(message.urls);
    return false;
  }

  if (message?.type === "MARK_OPENED") {
    markOpened(message.url);
    return false;
  }

  if (message?.type === "REFRESH_TOPIC") {
    refreshTopicIfStale(message.topicId).then((articles) => sendResponse({ articles }));
    return true;
  }

  if (message?.type === "REFRESH_IF_STALE") {
    refreshIfStale().then((articles) => sendResponse({ articles }));
    return true;
  }

  return false;
});
