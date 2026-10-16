// Service worker: fetches the feeds, normalizes them, caches the result.
// The panel and popup only ever read from that cache, so opening is instant.

importScripts("shared/data.js");

const REFRESH_MINUTES = 30;
// How stale the cache may be before opening the panel triggers a fetch.
// Opening it twice in a minute shouldn't hit every feed twice.
const STALE_AFTER_MS = 5 * 60 * 1000;
const MAX_PER_TOPIC = 3;
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

// Jaccard overlap — same story from two outlets shares most of its nouns.
function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  a.forEach((word) => {
    if (b.has(word)) shared += 1;
  });
  return shared / (a.size + b.size - shared);
}

const SAME_STORY = 0.45;

function ageHours(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / 3.6e6;
}

// Collapse the same story reported by several sources into one item, and
// remember how many sources carried it — agreement is the strongest signal
// we can get without a model.
function cluster(items) {
  const clusters = [];

  for (const item of items) {
    const tokens = titleTokens(item.title);
    const match = clusters.find((c) => similarity(c.tokens, tokens) >= SAME_STORY);

    if (match) {
      match.sources.add(item.source);
      // keep the earliest report; it's usually the one that broke it
      if (new Date(item.publishedAt) < new Date(match.item.publishedAt)) {
        match.item = item;
      }
    } else {
      clusters.push({ item, tokens, sources: new Set([item.source]) });
    }
  }

  return clusters.map((c) => ({
    ...c.item,
    corroboration: c.sources.size,
    fresh: ageHours(c.item.publishedAt) < FRESH_HOURS,
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

async function fetchTopic(topic) {
  const results = await Promise.all(topic.feeds.map(fetchFeed));
  const seen = new Set();

  const fresh = results.flat().filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return ageHours(item.publishedAt) <= MAX_AGE_HOURS;
  });

  // Deliberately may return fewer than MAX_PER_TOPIC, including none:
  // an honest quiet day beats three pieces of filler.
  return rank(fresh).slice(0, MAX_PER_TOPIC);
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
  const fetched = await Promise.all(topics.map(fetchTopic));

  // Keep empty topics in the map — "quiet today" is a real answer, and
  // dropping the key would make the panel think the fetch failed.
  const articles = {};
  topics.forEach((topic, index) => {
    articles[topic.id] = fetched[index];
  });

  await chrome.storage.local.set({ articles, fetched_at: Date.now() });
  return articles;
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

  if (message?.type === "REFRESH_IF_STALE") {
    refreshIfStale().then((articles) => sendResponse({ articles }));
    return true;
  }

  return false;
});
