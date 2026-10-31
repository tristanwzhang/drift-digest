// What Drift remembers about how it's used, and what it does with that.
// Service worker only (importScripts), plain globals like shared/data.js.
//
// Everything here is stored in chrome.storage.local and goes nowhere else.
// There is no server to send it to; see store/PRIVACY.md for the table.

// ---------- serialising writes ----------
//
// Opening a story sends several messages at once, and each of the stores below
// is read, changed and written back. Left alone, two of those interleave and
// one change is lost. Everything that writes runs through this one line.
let writeQueue = Promise.resolve();

function queued(task) {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => {});
  return run;
}

function dayKey(t = Date.now()) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- counting visits and reads ----------
//
// Counts per calendar day, nothing about which stories: how often Drift is
// opened, how often by itself, how often that leads to a read, and which
// position in the list gets read. Enough to tell whether the product works.
const METRIC_DAYS = 45;
const AUTO_CREDIT_MS = 15 * 60 * 1000;

function bumpMetrics(increments, t = Date.now()) {
  return queued(async () => {
    const { metrics } = await chrome.storage.local.get({ metrics: {} });
    const today = (metrics[dayKey(t)] ||= {});
    for (const [key, n] of Object.entries(increments)) today[key] = (today[key] || 0) + n;

    const keep = Object.keys(metrics).sort().slice(-METRIC_DAYS);
    for (const day of Object.keys(metrics)) if (!keep.includes(day)) delete metrics[day];
    await chrome.storage.local.set({ metrics });
  });
}

// Which surface a message came from, judged by where it was sent from.
function surfaceOf(sender) {
  const url = sender?.url || "";
  if (url.includes("/daily/daily.html")) return "daily";
  if (url.includes("/popup/popup.html")) return "popup";
  return "bubble";
}

function recordOpen(sender, unprompted) {
  return bumpMetrics({
    [unprompted ? "open_auto" : "open_manual"]: 1,
    ["via_" + surfaceOf(sender)]: 1,
  });
}

// A click soon after Drift opened itself is the number that says the check-in
// earns its interruption. Credited once per automatic open.
function creditAutoOpen() {
  return queued(async () => {
    const { auto_open: auto } = await chrome.storage.local.get({ auto_open: null });
    if (!auto || auto.credited || Date.now() - auto.t > AUTO_CREDIT_MS) return false;
    await chrome.storage.local.set({ auto_open: { ...auto, credited: true } });
    return true;
  });
}

async function recordClick(url, meta = {}) {
  const increments = { clicks: 1 };
  if (Number.isInteger(meta.rank) && meta.rank >= 0) increments["r" + Math.min(meta.rank, 9)] = 1;
  if (meta.upd) increments.upd_clicks = 1;
  if (meta.dev) increments.dev_clicks = 1;
  if (meta.tr) increments.trending_clicks = 1;
  if (await creditAutoOpen()) increments.auto_engaged = 1;
  await bumpMetrics(increments);
}

async function recordAutoOpen(via, error) {
  await chrome.storage.local.set({ auto_open: { t: Date.now(), credited: false, via } });
  await bumpMetrics({ auto_fired: 1, ["auto_via_" + via]: 1 });

  // Whether openPopup() works at cold startup was never observed. The log
  // keeps the answer, with the reason when it didn't.
  await queued(async () => {
    const { daily_log: log } = await chrome.storage.local.get({ daily_log: [] });
    log.push({ t: Date.now(), via, ...(error ? { error: String(error).slice(0, 120) } : {}) });
    await chrome.storage.local.set({ daily_log: log.slice(-20) });
  });
}

// ---------- learning which outlets you read ----------
//
// Per outlet: how many of its stories were put in front of you, and how many
// you opened. Nothing about topics or titles, and no way to rebuild what you
// read from it. It nudges the order of stories that already cleared the
// quality bar; it can't lift one over it, and it can't hide one below it.
const AFFINITY_MIN_OPENS = 12;   // too little evidence below this to say anything
const AFFINITY_MIN_SHOWN = 8;    // per outlet
const AFFINITY_PRIOR = 10;       // how many sightings an outlet's record is worth, up front
const AFFINITY_GAIN = 1;
const AFFINITY_CAP = 1.5;        // against a bar of 6 and a marquee outlet's lead at ~7
const STATS_DECAY_AT = 80;       // halve an outlet's record past this, so taste can change

async function learningOn() {
  const { learn_on: on } = await chrome.storage.sync.get({ learn_on: DEFAULT_LEARN });
  return on;
}

// Who published the story behind a URL — the outlet whose link you took, so
// choosing the WSJ's take on a story credits the WSJ rather than the lead.
async function outletOf(url) {
  const { articles } = await chrome.storage.local.get({ articles: {} });
  for (const list of Object.values(articles)) {
    for (const story of list || []) {
      if (story.url === url) return story.source;
      const other = (story.coverage || []).find((entry) => entry.url === url)
        || (story.related || []).find((entry) => entry.url === url);
      if (other) return other.source;
    }
  }
  return null;
}

function learnShown(urls) {
  if (!urls?.length) return Promise.resolve();
  return queued(async () => {
    if (!(await learningOn())) return;
    const { articles, reading_stats: stats } = await chrome.storage.local.get({
      articles: {},
      reading_stats: { sources: {} },
    });
    const sourceOf = new Map();
    for (const list of Object.values(articles)) {
      for (const story of list || []) sourceOf.set(story.url, story.source);
    }
    for (const url of urls) {
      const name = sourceOf.get(url);
      if (!name) continue;
      const entry = (stats.sources[name] ||= { s: 0, o: 0 });
      entry.s += 1;
      if (entry.s > STATS_DECAY_AT) { entry.s /= 2; entry.o /= 2; }
    }
    await chrome.storage.local.set({ reading_stats: stats });
  });
}

function learnOpened(url) {
  return queued(async () => {
    if (!(await learningOn())) return;
    const name = await outletOf(url);
    if (!name) return;
    const { reading_stats: stats } = await chrome.storage.local.get({ reading_stats: { sources: {} } });
    const entry = (stats.sources[name] ||= { s: 0, o: 0 });
    entry.o += 1;
    await chrome.storage.local.set({ reading_stats: stats });
  });
}

// A bonus, in score points, for each outlet you've shown evidence of reading
// more (or less) than outlets in general. Smoothed toward the overall rate so
// that three opens of a rarely-shown outlet can't read as devotion.
function sourceAffinity(stats) {
  const sources = stats?.sources || {};
  let shown = 0;
  let opened = 0;
  for (const entry of Object.values(sources)) { shown += entry.s; opened += entry.o; }
  if (opened < AFFINITY_MIN_OPENS) return {};

  const base = (opened + 1) / (shown + AFFINITY_PRIOR);
  const out = {};
  for (const [name, entry] of Object.entries(sources)) {
    if (entry.s < AFFINITY_MIN_SHOWN) continue;
    const rate = (entry.o + AFFINITY_PRIOR * base) / (entry.s + AFFINITY_PRIOR);
    const bonus = Math.log2(rate / base) * AFFINITY_GAIN;
    out[name] = Number(Math.max(-AFFINITY_CAP, Math.min(AFFINITY_CAP, bonus)).toFixed(2));
  }
  return out;
}

// Order only. The bar was applied to the raw score before this is called.
function orderByAffinity(stories, affinity) {
  if (!Object.keys(affinity).length) return stories;
  const lean = (story) => story.score + (affinity[story.source] || 0);
  return [...stories].sort((a, b) => lean(b) - lean(a));
}

// ---------- following a story you read ----------
//
// Opening a story hides it, and with it the whole event: one story per event
// per list, and the one you opened is gone. So the day Israel's coalition talks
// begin, Drift said nothing, having decided you'd read about Israel. A story
// you opened is followed for two days. It returns, marked as an update, in
// either of two cases: the event it belongs to picks up new reporting from new
// outlets; or a new, sizeable event appears about the same names — an election
// night turning into coalition talks is a different event, with a different
// headline, that anyone who read the first would want.
const FOLLOW_KEEP_MS = 48 * 60 * 60 * 1000;
const FOLLOW_URLS_MAX = 60;
const FOLLOW_TOKENS_MAX = 60;
const UPDATE_MIN_NEW_OUTLETS = 2;
const UPDATE_RELATED_MIN_OUTLETS = 4;
const UPDATE_BOOST = 4;

function storyUrls(story) {
  return [
    story.url,
    ...(story.coverage || []).map((entry) => entry.url),
    ...(story.related || []).map((entry) => entry.url),
  ].filter(Boolean);
}

function followOpened(url) {
  return queued(async () => {
    const { articles, followed } = await chrome.storage.local.get({ articles: {}, followed: [] });
    let story = null;
    for (const list of Object.values(articles)) {
      story = (list || []).find((candidate) => storyUrls(candidate).includes(url));
      if (story) break;
    }
    if (!story) return;

    const now = Date.now();
    const live = followed.filter((entry) => now - entry.openedAt < FOLLOW_KEEP_MS);
    const outlets = story.eventOutlets || story.corroboration || 1;
    const urls = [...new Set(storyUrls(story))];

    const tokens = eventTokens([story.title, ...(story.related || []).map((r) => r.title)].join(" "));
    const existing = live.find((entry) => entry.urls.includes(url));
    if (existing) {
      existing.tokens = [...new Set([...(existing.tokens || []), ...tokens])].slice(-FOLLOW_TOKENS_MAX);
      existing.urls = [...new Set([...existing.urls, ...urls])].slice(-FOLLOW_URLS_MAX);
      existing.openedAt = now;
      existing.outletsAtOpen = Math.max(outlets, existing.outletsAtOpen || 0);
      existing.title = story.title;
    } else {
      live.push({
        urls: urls.slice(0, FOLLOW_URLS_MAX),
        tokens: tokens.slice(0, FOLLOW_TOKENS_MAX),
        title: story.title,
        openedAt: now,
        outletsAtOpen: outlets,
      });
    }
    await chrome.storage.local.set({ followed: live });
  });
}

// Events grouped by id, and which event owns each URL.
function indexEvents(ranked) {
  const byEvent = new Map();
  const eventOfUrl = new Map();
  for (const story of ranked) {
    if (!byEvent.has(story.event)) byEvent.set(story.event, []);
    byEvent.get(story.event).push(story);
    for (const url of storyUrls(story)) if (!eventOfUrl.has(url)) eventOfUrl.set(url, story.event);
  }
  return { byEvent, eventOfUrl };
}

// Which followed events have moved on, and the story to show for each.
function findUpdates(ranked, followed, openedUrls, now = Date.now()) {
  const updates = new Map();
  if (!followed?.length) return updates;
  const { byEvent, eventOfUrl } = indexEvents(ranked);

  // Only built if there is something to compare against.
  let vocabulary = null;
  const batch = () => vocabulary ||= (() => {
    const titles = ranked.map((story) => story.title);
    const docFreq = new Map();
    const tokens = new Map();
    for (const story of ranked) {
      const list = eventTokens(story.title);
      tokens.set(story, list);
      list.forEach((token) => docFreq.set(token, (docFreq.get(token) || 0) + 1));
    }
    return { docFreq, tokens, names: namesIn(titles), total: Math.max(2, ranked.length) };
  })();

  // Reporting you haven't read, filed after you read: the strongest such
  // story of the event, since `members` is in score order.
  const unread = (members, entry) => members.find((story) =>
    !story.lowValue &&
    !entry.urls.includes(story.url) &&
    !openedUrls[story.url] &&
    new Date(story.publishedAt).getTime() > entry.openedAt);

  for (const entry of followed) {
    if (now - entry.openedAt > FOLLOW_KEEP_MS) continue;
    const own = entry.urls.map((url) => eventOfUrl.get(url)).find((id) => id !== undefined);

    // 1. The same event, grown.
    if (own !== undefined) {
      const members = byEvent.get(own);
      const added = members[0].eventOutlets - entry.outletsAtOpen;
      const fresh = added >= UPDATE_MIN_NEW_OUTLETS ? unread(members, entry) : null;
      if (fresh) {
        updates.set(own, { story: fresh, title: entry.title, added });
        continue;
      }
    }

    // 2. A new event about the same names. Held to the same standard as two
    // stories being one event — two shared words, one of them a name, rare
    // enough in today's batch — plus enough outlets to be a story at all.
    if (!entry.tokens?.length) continue;
    const { docFreq, tokens, names, total } = batch();
    const mine = new Set(entry.tokens);
    const bar = EVENT_RARITY * Math.log(total);
    let best = null;
    for (const [event, members] of byEvent) {
      if (event === own || updates.has(event)) continue;
      if (members[0].eventOutlets < UPDATE_RELATED_MIN_OUTLETS) continue;
      // Already read about it. Without this, taking the update would make the
      // next story from the same event another update, indefinitely.
      if (members.some((story) => storyUrls(story).some((url) => openedUrls[url]))) continue;
      const shared = [...new Set(members.flatMap((story) => tokens.get(story)))].filter((t) => mine.has(t));
      if (shared.length < 2 || !shared.some((token) => names.has(token))) continue;
      if (shared.reduce((sum, token) => sum + Math.log(total / docFreq.get(token)), 0) < bar) continue;
      const fresh = unread(members, entry);
      if (fresh && (!best || fresh.score > best.story.score)) best = { event, story: fresh };
    }
    if (best) updates.set(best.event, { story: best.story, title: entry.title, added: 0 });
  }
  return updates;
}

// The update stands for its event; the rest of the event steps aside, since
// the lead is the story you read and its siblings are what led up to this.
function applyUpdates(ranked, updates) {
  if (!updates.size) return ranked;
  return ranked
    .filter((story) => !updates.has(story.event) || story === updates.get(story.event).story)
    .map((story) => {
      const hit = updates.get(story.event);
      return hit
        ? { ...story, score: story.score + UPDATE_BOOST, update: { title: hit.title, added: hit.added } }
        : story;
    })
    .sort(byScore);
}

// Keep a followed event's URL list current, so that opening the update story
// later finds the record it belongs to instead of starting a second one.
function growFollowed(ranked, followed, now = Date.now()) {
  const live = (followed || []).filter((entry) => now - entry.openedAt < FOLLOW_KEEP_MS);
  const { byEvent, eventOfUrl } = indexEvents(ranked);
  for (const entry of live) {
    const event = entry.urls.map((url) => eventOfUrl.get(url)).find((id) => id !== undefined);
    if (event === undefined) continue;
    const members = byEvent.get(event);
    entry.urls = [...new Set([...entry.urls, ...members.flatMap(storyUrls)])].slice(-FOLLOW_URLS_MAX);
    entry.tokens = [...new Set([...(entry.tokens || []), ...members.flatMap((story) => eventTokens(story.title))])]
      .slice(-FOLLOW_TOKENS_MAX);
  }
  return live;
}

// ---------- alerts for the very biggest stories ----------
//
// Off unless asked for, and then deliberately hard to trigger: an event with
// ten outlets on it, most of them filing within hours — the shape of an
// election night or a market shock. At most one a day, never overnight, once
// per event, and never for something you've already read.
const ALERT_OUTLETS = 10;
const ALERT_RECENT = 5;
const ALERT_DAILY_MAX = 1;
const ALERT_QUIET_FROM = 22;
const ALERT_KEEP_MS = 72 * 60 * 60 * 1000;

function eventUrlList(ranked, event) {
  return [...new Set(ranked.filter((story) => story.event === event).flatMap(storyUrls))];
}

// The story to alert about, or null. Pure: the caller supplies the clock.
function pickAlert(ranked, log, openedUrls, now, startHour = DAY_STARTS_AT_HOUR) {
  const hour = new Date(now).getHours();
  if (hour >= ALERT_QUIET_FROM || hour < startHour) return null;

  const today = dayKey(now);
  if (log.filter((entry) => dayKey(entry.t) === today).length >= ALERT_DAILY_MAX) return null;

  const sent = new Set(log.flatMap((entry) => entry.urls));
  const candidates = new Map();
  for (const story of ranked) {
    if (story.lowValue || story.eventOutlets < ALERT_OUTLETS || story.eventRecent < ALERT_RECENT) continue;
    if (!candidates.has(story.event)) candidates.set(story.event, story);   // best score first
  }

  let best = null;
  for (const [event, story] of candidates) {
    const urls = eventUrlList(ranked, event);
    if (urls.some((url) => sent.has(url) || openedUrls[url])) continue;
    if (!best || story.eventOutlets > best.story.eventOutlets) best = { story, urls };
  }
  return best;
}

async function maybeAlert(ranked) {
  const { alerts_on: on, day_starts_at: startHour } = await chrome.storage.sync.get({
    alerts_on: false,
    day_starts_at: DAY_STARTS_AT_HOUR,
  });
  if (!on || typeof chrome.notifications?.create !== "function") return;

  const now = Date.now();
  const local = await chrome.storage.local.get({ alert_log: [], opened_urls: {} });
  const log = local.alert_log.filter((entry) => now - entry.t < ALERT_KEEP_MS);

  const pick = pickAlert(ranked, log, local.opened_urls, now, startHour);
  if (!pick) {
    if (log.length !== local.alert_log.length) await chrome.storage.local.set({ alert_log: log });
    return;
  }

  const { story, urls } = pick;
  // Logged first: if showing it fails, trying again every half hour would be
  // worse than missing it once.
  log.push({ t: now, urls: urls.slice(0, FOLLOW_URLS_MAX), title: story.title });
  await chrome.storage.local.set({ alert_log: log });

  chrome.notifications.create(story.url, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: `Big story · ${story.eventOutlets} outlets`,
    message: story.title,
    contextMessage: story.source,
  });
  await bumpMetrics({ alert_sent: 1 });
}

let notificationClicksBound = false;

// Registered at startup, and again if the permission arrives later: the
// notifications API doesn't exist at all until it has been granted.
function bindNotificationClicks() {
  if (notificationClicksBound || !chrome.notifications?.onClicked) return;
  notificationClicksBound = true;
  chrome.notifications.onClicked.addListener((id) => {
    chrome.notifications.clear(id);
    if (!/^https?:\/\//i.test(id)) return;
    chrome.tabs.create({ url: id });
    markOpened(id, {});
    bumpMetrics({ alert_click: 1 });
  });
}
