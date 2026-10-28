const topicGrid = document.getElementById("topicGrid");
const savedHint = document.getElementById("savedHint");
const modeCards = Array.from(document.querySelectorAll(".mode-card"));
const dailyToggle = document.getElementById("dailyToggle");
const startHour = document.getElementById("startHour");
const upgradeRow = document.getElementById("upgradeRow");
const upgradeTitle = document.getElementById("upgradeTitle");
const upgradeBtn = document.getElementById("upgradeBtn");
const healthSection = document.getElementById("healthSection");
const healthList = document.getElementById("healthList");
const recheckBtn = document.getElementById("recheckBtn");

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
    document.querySelector(".wrap").appendChild(notice);
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
    },
    showSavedHint
  );
}

dailyToggle.addEventListener("change", persist);
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

function renderGrid() {
  topicGrid.textContent = "";

  NEWSLETTER_TOPICS.forEach((topic) => {
    const chip = document.createElement("button");
    chip.className = "topic-chip" + (selectedTopics.has(topic.id) ? " is-selected" : "");
    chip.setAttribute("aria-pressed", selectedTopics.has(topic.id));

    const emoji = document.createElement("span");
    emoji.className = "emoji";
    emoji.textContent = topic.emoji;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = topic.label;

    const check = document.createElement("span");
    check.className = "check";
    check.textContent = "✓";

    chip.append(emoji, label, check);
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

    topicGrid.appendChild(chip);
  });
}

chrome.storage.sync.get(
  {
    selected_topics: DEFAULT_TOPIC_IDS,
    display_mode: DEFAULT_DISPLAY_MODE,
    daily_open: true,
    day_starts_at: DAY_STARTS_AT_HOUR,
  },
  (data) => {
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
