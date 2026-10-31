const topicGrid = document.getElementById("topicGrid");
const savedHint = document.getElementById("savedHint");
const modeCards = Array.from(document.querySelectorAll(".mode-card"));
const dailyToggle = document.getElementById("dailyToggle");
const imagesToggle = document.getElementById("imagesToggle");
const learnToggle = document.getElementById("learnToggle");
const alertsToggle = document.getElementById("alertsToggle");
const startHour = document.getElementById("startHour");
const upgradeRow = document.getElementById("upgradeRow");
const upgradeTitle = document.getElementById("upgradeTitle");
const upgradeBtn = document.getElementById("upgradeBtn");
const healthSection = document.getElementById("healthSection");
const healthList = document.getElementById("healthList");
const recheckBtn = document.getElementById("recheckBtn");
const topicCount = document.getElementById("topicCount");

// Topics you already follow can gain new publishers in an update. Permission
// was only ever asked for at the moment you picked the topic, so there has to
// be a way to catch up — one prompt covering everything that's missing.
let pendingOrigins = [];

async function findMissingAccess() {
  const origins = originsForTopics([...selectedTopics]);
  const checks = await Promise.all(
    origins.map((origin) =>
      new Promise((resolve) =>
        chrome.permissions.contains({ origins: [origin] }, (granted) =>
          resolve(granted && !chrome.runtime.lastError)
        )
      )
    )
  );

  pendingOrigins = origins.filter((_, index) => !checks[index]);
  upgradeRow.hidden = pendingOrigins.length === 0;

  if (pendingOrigins.length) {
    const n = pendingOrigins.length;
    upgradeTitle.textContent =
      n === 1 ? "1 new source needs your permission"
              : `${n} new sources need your permission`;
  }
}

upgradeBtn.addEventListener("click", () => {
  chrome.permissions.request({ origins: pendingOrigins }, (granted) => {
    if (granted) {
      upgradeRow.hidden = true;
      showNotice("Thanks — those sources will appear at the next refresh.");
    }
  });
});

// A feed is only worth mentioning once it has failed enough times to be a
// pattern rather than a blip — a publisher's five-minute outage is not news.
const HEALTH_REPORT_AFTER = 3;

function sinceText(ms) {
  if (!ms) return "";
  const hours = (Date.now() - ms) / 3.6e6;
  if (hours < 1) return "just now";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} days`;
}

function topicsUsing(url) {
  return NEWSLETTER_TOPICS
    .filter((topic) => topic.feeds.some((feed) => feed.url === url))
    .map((topic) => topic.short || topic.label);
}

function renderHealth(health) {
  const broken = Object.entries(health || {})
    .filter(([, record]) => (record.fails || 0) >= HEALTH_REPORT_AFTER)
    // Only mention a source the person actually follows.
    .filter(([url]) => topicsUsing(url).some((label) =>
      [...selectedTopics].some((id) => {
        const topic = getTopic(id);
        return topic && (topic.short || topic.label) === label;
      })))
    .sort((a, b) => (a[1].since || 0) - (b[1].since || 0));

  healthSection.hidden = broken.length === 0;
  healthList.textContent = "";

  for (const [url, record] of broken) {
    const row = document.createElement("li");

    const name = document.createElement("span");
    name.className = "health-name";
    name.textContent = record.name || new URL(url).hostname;

    const topic = document.createElement("span");
    topic.className = "health-topic";
    topic.textContent = topicsUsing(url)[0] || "";

    const detail = document.createElement("span");
    detail.className = "health-detail";
    const gone = sinceText(record.since);
    detail.textContent = gone ? `quiet ${gone} · ${record.error}` : record.error;

    row.append(name, topic, detail);
    healthList.appendChild(row);
  }
}

async function refreshHealth() {
  const { feed_health: health } = await chrome.storage.local.get({ feed_health: {} });
  renderHealth(health);
}

recheckBtn.addEventListener("click", () => {
  recheckBtn.disabled = true;
  recheckBtn.textContent = "Checking…";
  chrome.runtime.sendMessage({ type: "RECHECK_FEEDS" }, () => {
    recheckBtn.disabled = false;
    recheckBtn.textContent = "Check again now";
    refreshHealth();
  });
});

// The worker writes health as it fetches, so settings left open stays current.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.feed_health) renderHealth(changes.feed_health.newValue);
});

let selectedTopics = new Set();
let displayMode = DEFAULT_DISPLAY_MODE;
let savedHintTimer = null;
let noticeTimer = null;

// Access to each publisher is requested when a topic is picked, not at
// install — so the install prompt asks for nothing at all.
function showNotice(text) {
  let notice = document.getElementById("permNotice");
  if (!notice) {
    notice = document.createElement("p");
    notice.id = "permNotice";
    notice.className = "perm-notice";
    notice.setAttribute("role", "status");
    document.body.appendChild(notice);
  }
  notice.textContent = text;
  notice.classList.add("is-visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("is-visible"), 6000);
}

function showSavedHint() {
  savedHint.classList.add("is-visible");
  clearTimeout(savedHintTimer);
  savedHintTimer = setTimeout(() => savedHint.classList.remove("is-visible"), 1200);
}

function persist() {
  chrome.storage.sync.set(
    {
      selected_topics: Array.from(selectedTopics),
      display_mode: displayMode,
      daily_open: dailyToggle.checked,
      day_starts_at: Number(startHour.value),
      show_images: imagesToggle.checked,
      learn_on: learnToggle.checked,
      alerts_on: alertsToggle.checked,
    },
    showSavedHint
  );
}

dailyToggle.addEventListener("change", persist);
imagesToggle.addEventListener("change", persist);
learnToggle.addEventListener("change", () => { persist(); refreshStats(); });

// Notifications are an optional permission: asked for here, when someone asks
// for alerts, and not at install. request() has to be the first thing that
// happens in the handler or Chrome refuses the prompt.
alertsToggle.addEventListener("change", () => {
  if (!alertsToggle.checked) {
    persist();
    return;
  }
  chrome.permissions.request({ permissions: ["notifications"] }, (granted) => {
    if (!granted) {
      alertsToggle.checked = false;
      showNotice("Alerts need permission to show notifications. Nothing else is read.");
    }
    persist();
  });
});
startHour.addEventListener("change", persist);

function renderModes() {
  modeCards.forEach((card) => {
    const selected = card.dataset.mode === displayMode;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
}

modeCards.forEach((card) => {
  card.addEventListener("click", () => {
    const mode = card.dataset.mode;

    // The bubble draws on every page, so it needs access to every page.
    // That's a big ask, and it's only made if someone actually chooses it.
    if (mode === "bubble") {
      chrome.permissions.request({ origins: ["<all_urls>"] }, (granted) => {
        if (!granted) {
          showNotice(
            "The floating bubble has to draw on the pages you visit, so it needs " +
            "access to them. Toolbar mode needs nothing."
          );
          return;
        }
        displayMode = mode;
        renderModes();
        persist();
      });
      return;
    }

    displayMode = mode;
    renderModes();
    persist();
  });
});

// Twenty-three topics in one grid is a wall. Shelved the way a newsstand
// shelves them, they're something you can scan. Presentation only: the order
// you read them in is still set by dragging tabs in the digest.
const TOPIC_SHELVES = [
  ["News & money", ["world", "politics", "finance", "crypto"]],
  ["Technology", ["ai", "startups", "code", "security", "design"]],
  ["Science", ["science", "space", "climate", "health"]],
  ["Culture", ["film", "music", "books", "gaming", "architecture", "photo"]],
  ["Life", ["sports", "fitness", "food", "cars"]],
];

// Who a topic reads, so picking one says what you'll actually get.
function sourcesLine(topic) {
  const names = [...new Set(topic.feeds.map((feed) => feed.name))];
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}

function topicChip(topic) {
  const chip = document.createElement("button");
  chip.className = "topic-chip" + (selectedTopics.has(topic.id) ? " is-selected" : "");
  chip.setAttribute("aria-pressed", selectedTopics.has(topic.id));

  const emoji = document.createElement("span");
  emoji.className = "emoji";
  emoji.textContent = topic.emoji;

  const copy = document.createElement("span");
  copy.className = "chip-copy";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = topic.label;
  const sources = document.createElement("span");
  sources.className = "sources";
  sources.textContent = sourcesLine(topic);
  copy.append(label, sources);

  const check = document.createElement("span");
  check.className = "check";
  check.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>';

  chip.append(emoji, copy, check);
  chip.addEventListener("click", () => {
    if (selectedTopics.has(topic.id)) {
      selectedTopics.delete(topic.id);
      renderGrid();
      persist();
      return;
    }

    // request() must be the first thing in the handler — awaiting anything
    // first loses the user gesture and Chrome refuses the prompt.
    chrome.permissions.request(
      { origins: originsForTopics([topic.id]) },
      (granted) => {
        if (!granted) {
          showNotice(
            `Drift needs access to ${topic.label}'s sources to fetch its headlines. ` +
            `Nothing is read from any other site.`
          );
          return;
        }
        selectedTopics.add(topic.id);
        renderGrid();
        persist();
        findMissingAccess();
      }
    );
  });
  return chip;
}

function renderGrid() {
  topicGrid.textContent = "";

  const shelved = new Set(TOPIC_SHELVES.flatMap(([, ids]) => ids));
  const loose = NEWSLETTER_TOPICS.filter((topic) => !shelved.has(topic.id)).map((topic) => topic.id);
  const shelves = loose.length ? [...TOPIC_SHELVES, ["More", loose]] : TOPIC_SHELVES;

  for (const [name, ids] of shelves) {
    const topics = ids.map(getTopic).filter(Boolean);
    if (!topics.length) continue;

    const shelf = document.createElement("div");
    shelf.className = "shelf";
    const heading = document.createElement("h3");
    heading.className = "shelf-name";
    heading.textContent = name;
    const grid = document.createElement("div");
    grid.className = "shelf-grid";
    topics.forEach((topic) => grid.appendChild(topicChip(topic)));
    shelf.append(heading, grid);
    topicGrid.appendChild(shelf);
  }

  const count = [...selectedTopics].filter((id) => getTopic(id)).length;
  topicCount.textContent = count === 1 ? "1 followed" : `${count} followed`;
}

chrome.storage.sync.get(
  {
    selected_topics: DEFAULT_TOPIC_IDS,
    display_mode: DEFAULT_DISPLAY_MODE,
    daily_open: true,
    day_starts_at: DAY_STARTS_AT_HOUR,
    show_images: DEFAULT_SHOW_IMAGES,
    learn_on: DEFAULT_LEARN,
    alerts_on: false,
  },
  (data) => {
    imagesToggle.checked = data.show_images;
    learnToggle.checked = data.learn_on;
    // The switch can say on while Chrome has since withdrawn the permission.
    chrome.permissions.contains({ permissions: ["notifications"] }, (granted) => {
      alertsToggle.checked = data.alerts_on && granted;
    });
    refreshStats();
    selectedTopics = new Set(data.selected_topics);
    displayMode = data.display_mode;
    dailyToggle.checked = data.daily_open;
    startHour.value = String(data.day_starts_at);
    renderGrid();
    renderModes();
    findMissingAccess();
    refreshHealth();
  }
);

document.getElementById("version").textContent = chrome.runtime.getManifest().version;

// ---------- the numbers, shown back ----------
//
// Everything below is read from this browser's own storage; see the privacy
// policy for what is kept. Counting is only worth doing if the person can see
// it, and wipe it.
const STAT_DAYS = 14;

function lastDays(count) {
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const pad = (n) => String(n).padStart(2, "0");
    days.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, date: d });
  }
  return days;
}

function statCard(value, label, note) {
  const card = document.createElement("div");
  card.className = "stat";
  const number = document.createElement("p");
  number.className = "stat-value";
  number.textContent = value;
  const caption = document.createElement("p");
  caption.className = "stat-label";
  caption.textContent = label;
  card.append(number, caption);
  if (note) card.title = note;
  return card;
}

function renderStats({ metrics, stats, dailyLog, learning }) {
  const days = lastDays(STAT_DAYS).map((day) => ({ ...day, m: metrics[day.key] || {} }));
  const sum = (key) => days.reduce((n, day) => n + (day.m[key] || 0), 0);

  const visits = sum("open_auto") + sum("open_manual");
  const reads = sum("clicks");
  const fired = sum("auto_fired");
  const engaged = sum("auto_engaged");
  const ranks = Array.from({ length: 10 }, (_, i) => sum("r" + i));
  const ranked = ranks.reduce((n, v) => n + v, 0);

  const grid = document.getElementById("statGrid");
  grid.textContent = "";
  grid.append(
    statCard(String(visits), "visits"),
    statCard(String(reads), "stories read"),
    statCard(visits ? (reads / visits).toFixed(1) : "—", "reads per visit"),
    statCard(
      fired ? `${engaged} of ${fired}` : "—",
      "check-ins that led to a read",
      "Opened by Drift itself, then a story read within fifteen minutes"
    )
  );

  const peak = Math.max(1, ...days.map((day) => Math.max(
    (day.m.open_auto || 0) + (day.m.open_manual || 0), day.m.clicks || 0)));
  const bars = document.getElementById("statBars");
  bars.textContent = "";
  for (const day of days) {
    const v = (day.m.open_auto || 0) + (day.m.open_manual || 0);
    const r = day.m.clicks || 0;
    const col = document.createElement("div");
    col.className = "stat-day";
    col.title = `${day.date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ` +
      `${v} visit${v === 1 ? "" : "s"}, ${r} read${r === 1 ? "" : "s"}`;
    for (const [className, n] of [["bar-visits", v], ["bar-reads", r]]) {
      const bar = document.createElement("span");
      bar.className = "stat-bar " + className;
      bar.style.height = Math.max(n ? 6 : 2, Math.round((n / peak) * 100)) + "%";
      col.appendChild(bar);
    }
    bars.appendChild(col);
  }

  const sources = document.getElementById("statSources");
  const top = Object.entries(stats?.sources || {})
    .filter(([, entry]) => entry.o >= 3)
    .sort((a, b) => b[1].o - a[1].o)
    .slice(0, 3)
    .map(([name]) => name);
  sources.textContent = !learning
    ? "Learning is off, so Drift isn't tracking which outlets you open."
    : top.length
      ? `You open most: ${top.join(", ")}.` + (ranked >= 10 ? ` ${Math.round((ranks[0] / ranked) * 100)}% of your reads are the top story.` : "")
      : "Not enough reading yet to say which outlets you prefer.";

  const checkin = document.getElementById("statCheckin");
  const last = (dailyLog || []).at(-1);
  checkin.textContent = !last
    ? "The automatic daily check-in hasn't fired yet."
    : last.via === "popup"
      ? "The last automatic check-in opened as a popup."
      : "The last automatic check-in opened as a tab" +
        (last.error ? " — Chrome wouldn't open the popup on its own." : ".");
}

async function refreshStats() {
  const [local, synced] = await Promise.all([
    chrome.storage.local.get({ metrics: {}, reading_stats: { sources: {} }, daily_log: [] }),
    chrome.storage.sync.get({ learn_on: DEFAULT_LEARN }),
  ]);
  renderStats({
    metrics: local.metrics,
    stats: local.reading_stats,
    dailyLog: local.daily_log,
    learning: synced.learn_on,
  });
}

document.getElementById("eraseBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["metrics", "reading_stats", "followed", "daily_log", "auto_open"]);
  refreshStats();
  showNotice("Erased. Drift starts counting again from now.");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.metrics || changes.reading_stats || changes.daily_log)) refreshStats();
});
