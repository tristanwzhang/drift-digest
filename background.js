// Service worker: fetches the feeds, normalizes them, caches the result.
// The panel and popup only ever read from that cache, so opening is instant.

importScripts("shared/data.js");

const REFRESH_MINUTES = 30;
// How stale the cache may be before opening the panel triggers a fetch.
// Opening it twice in a minute shouldn't hit every feed twice.
const STALE_AFTER_MS = 5 * 60 * 1000;
const MAX_PER_TOPIC = 3;
// The cache holds more than it shows, so each surface can skip what you've
// already seen without going back to the network.
const POOL_PER_TOPIC = 8;
// A week-old item is not "what's new" — better to show nothing than to pad.
const MAX_AGE_HOURS = 168;
// Only this recent earns the "new" marker.
const FRESH_HOURS = 24;
const FETCH_TIMEOUT_MS = 10000;
const ALARM = "drift-refresh";
const DAILY_KEY = "last_daily_open";

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
    .map((block) => ({
      title: clean(pickTag(block, "title")),
      url: pickLink(block),
      source: sourceName,
      publishedAt: pickDate(block) || new Date().toISOString(),
    }))
    .filter((item) => item.title && /^https?:\/\//i.test(item.url));
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

function ageHours(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / 3.6e6;
}

// Collapse the same story reported by several sources into one item, and
// remember how many sources carried it — agreement is the strongest signal
// we can get without a model.
function cluster(items) {
  const tokenSets = items.map((item) => titleTokens(item.title));
  const weights = buildWeights(tokenSets);
  const clusters = [];

  items.forEach((item, index) => {
    const tokens = tokenSets[index];
    const match = clusters.find((c) => similarity(c.tokens, tokens, weights) >= SAME_STORY);

    if (match) {
      match.sources.add(item.source);
      match.topics.push(item.topicId);
      // keep the earliest report; it's usually the one that broke it
      if (new Date(item.publishedAt) < new Date(match.item.publishedAt)) {
        match.item = item;
      }
    } else {
      clusters.push({
        item,
        tokens,
        sources: new Set([item.source]),
        topics: [item.topicId],
      });
    }
  });

  return clusters.map((c) => ({
    ...c.item,
    corroboration: c.sources.size,
    fresh: ageHours(c.item.publishedAt) < FRESH_HOURS,
    topics: c.topics,
  }));
}

function rank(items) {
  return cluster(items).sort((a, b) => {
    // stories two outlets both covered lead over a single outlet's
    if (b.corroboration !== a.corroboration) return b.corroboration - a.corroboration;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });
}

// ---------- fetching ----------

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      cache: "no-cache",
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return parseFeed(await response.text(), feed.name);
  } catch (error) {
    // One dead feed shouldn't empty a topic — log it and move on.
    console.warn("[Drift] feed failed:", feed.url, error.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Raw items for one topic, tagged so clustering can run across all of them.
async function fetchTopicItems(topic) {
  const results = await Promise.all(topic.feeds.map(fetchFeed));
  const seen = new Set();

  return results.flat().filter((item) => {
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

// Concurrent callers share one fetch rather than each starting their own.
let inFlight = null;

function refresh() {
  if (!inFlight) {
    inFlight = doRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
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

async function doRefresh() {
  const { selected_topics: selected } = await chrome.storage.sync.get({
    selected_topics: DEFAULT_TOPIC_IDS,
  });

  const topics = selected.map(getTopic).filter(Boolean);
  const fetched = await Promise.all(topics.map(fetchTopicItems));

  const order = topics.map((topic) => topic.id);
  const grouped = assignToTopics(rank(fetched.flat()), order);

  // Keep empty topics in the map — "quiet today" is a real answer, and
  // dropping the key would make the panel think the fetch failed.
  // A pool rather than exactly three: the surfaces trim it against what
  // you've already seen.
  const articles = {};
  order.forEach((id) => {
    articles[id] = (grouped[id] || [])
      .slice(0, POOL_PER_TOPIC)
      // `topics` carries one entry per source article so assignment can count
      // them; it has done its job by now and shouldn't bloat the cache.
      .map(({ topics, ...article }) => article);
  });

  await chrome.storage.local.set({ articles, fetched_at: Date.now() });
  return articles;
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
}

async function markOpened(url) {
  if (!url) return;
  const { opened_urls: opened } = await chrome.storage.local.get({ opened_urls: {} });
  opened[url] = { t: Date.now() };
  await chrome.storage.local.set({ opened_urls: prune(opened) });
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
  const today = todayKey();
  if (checkedDate === today) return;

  const { daily_open: enabled } = await chrome.storage.sync.get({ daily_open: true });
  if (!enabled) {
    checkedDate = today;
    return;
  }

  const stored = await chrome.storage.local.get({ [DAILY_KEY]: null });
  if (stored[DAILY_KEY] === today) {
    checkedDate = today;
    return;
  }

  // Claim today before doing anything slow, so two triggers firing at once
  // can't both decide they're first.
  await chrome.storage.local.set({ [DAILY_KEY]: today });
  checkedDate = today;

  await refreshIfStale();
  const how = await openDigest();
  console.log("[Drift] daily check-in shown via", how);
}

// ---------- schedule ----------

function scheduleRefresh() {
  chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleRefresh();
  refresh();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRefresh();
  refresh();
  maybeShowDaily();
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
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.selected_topics) refresh();
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

  if (message?.type === "REFRESH_IF_STALE") {
    refreshIfStale().then((articles) => sendResponse({ articles }));
    return true;
  }

  return false;
});
