const body = document.getElementById("body");
const topicTabs = document.getElementById("topicTabs");
const bubbleRow = document.getElementById("bubbleRow");
const resetPosBtn = document.getElementById("resetPosBtn");

const DEFAULT_POS = { xPct: 0.97, yPct: 0.42 };

let selectedTopics = [];
let tabIds = [];           // Trending first, then your topics in your order
let articlesByTopic = {};
let activeTopicId = null;
let history = { opened: {}, seen: {} };
let unprompted = false;   // true when Drift opened this itself
let showImages = DEFAULT_SHOW_IMAGES;

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function showNotice(text, actionLabel) {
  topicTabs.hidden = true;
  body.textContent = "";

  const notice = document.createElement("div");
  notice.className = "empty-state";

  const copy = document.createElement("p");
  copy.textContent = text;
  notice.appendChild(copy);

  if (actionLabel) {
    const button = document.createElement("button");
    button.className = "primary-btn";
    button.textContent = actionLabel;
    button.addEventListener("click", openOptions);
    notice.appendChild(button);
  }

  body.appendChild(notice);
}

// The shape of a digest while the first one is fetched, so the wait reads as
// "nearly here" rather than as a blank page with a sentence in it.
function showSkeleton() {
  topicTabs.hidden = true;
  body.textContent = "";
  const sheet = document.createElement("div");
  sheet.className = "skeleton";
  sheet.setAttribute("aria-label", "Gathering headlines");
  sheet.innerHTML =
    '<div class="sk sk-cover"></div>' +
    '<div class="sk sk-line"></div><div class="sk sk-line short"></div>' +
    '<div class="sk-row"><div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div><div class="sk sk-thumb"></div></div>' +
    '<div class="sk-row"><div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div><div class="sk sk-thumb"></div></div>';
  body.appendChild(sheet);
}

// "Updated 4m ago" in the footer: the one fact about a digest you can't see
// from the stories themselves.
function showUpdated(fetchedAt) {
  const stamp = document.getElementById("updatedAt");
  if (!stamp) return;
  stamp.textContent = fetchedAt ? "Updated " + timeAgo(new Date(fetchedAt).toISOString()) : "";
}

// Identity of a topic's stories, so we can tell a real update from a no-op.
function topicSignature(articles) {
  return (articles || []).map((article) => article.url).join("|");
}

function sameArticles(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].every((key) => topicSignature(a[key]) === topicSignature(b[key]));
}

function renderStories() {
  let articles = pickStories(articlesByTopic[activeTopicId], history, STORIES_PER_TAB);
  let held = [];

  if (unprompted) {
    const split = partitionForUnprompted(articles);
    articles = split.shown;
    held = split.held;
  }

  body.textContent = "";

  // An empty topic is a real answer, not a failure — say so plainly.
  if (articles.length === 0) {
    const notice = document.createElement("div");
    notice.className = "empty-state";
    const copy = document.createElement("p");
    const topic = getTopic(activeTopicId);
    copy.textContent = "Quiet in " + (topic?.short || "this topic") + " today.";
    notice.appendChild(copy);
    body.appendChild(notice);
    return;
  }

  articles.forEach((article, index) => {
    const trending = activeTopicId === TRENDING_ID;
    body.appendChild(renderStory(article, {
      lead: index === 0,
      images: showImages,
      tags: trending ? trendingTags(article) : [],
      rank: trending && index > 0 ? index + 1 : 0,
      index,
    }));
  });

  if (held.length) {
    const row = document.createElement("button");
    row.className = "heldback";
    row.textContent =
      held.length === 1 ? "1 heavy story held back — show it"
                        : `${held.length} heavy stories held back — show them`;
    row.addEventListener("click", () => {
      unprompted = false;
      renderStories();
    });
    body.appendChild(row);
  }

  // You looked at this tab, so these have had their turn.
  chrome.runtime.sendMessage({
    type: "MARK_SEEN",
    urls: articles.map((article) => article.url),
  });

  // replay the fade so switching tabs reads as a change
  body.style.animation = "none";
  void body.offsetWidth;
  body.style.animation = "";
}

function selectTopic(topicId) {
  activeTopicId = topicId;
  chrome.storage.local.set({ active_topic: topicId });
  renderTabs();
  renderStories();
  // A new tab starts at its top story, not wherever the last one was scrolled.
  body.scrollTop = 0;
  refreshActiveTopic();
}

// Refetch just the tab you're looking at — a few requests, not all 35.
function refreshActiveTopic() {
  const topicId = activeTopicId;
  chrome.runtime.sendMessage({ type: "REFRESH_TOPIC", topicId }, (reply) => {
    if (chrome.runtime.lastError || !reply?.articles) return;
    if (topicId !== activeTopicId) return;            // user moved on
    if (sameArticles(reply.articles, articlesByTopic)) return;
    articlesByTopic = reply.articles;
    renderTabs();
    renderStories();
  });
}

function renderTabs() {
  topicTabs.hidden = false;
  topicTabs.textContent = "";

  tabIds.forEach((topicId) => {
    const topic = getTopic(topicId);
    if (!topic) return;

    const tab = document.createElement("button");
    tab.className = "topic-tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(topicId === activeTopicId));
    tab.dataset.topicId = topicId;
    if (topicId === TRENDING_ID) tab.classList.add("is-pinned");
    tab.textContent = topic.short || topic.label;

    tab.addEventListener("click", () => selectTopic(topicId));

    topicTabs.appendChild(tab);
  });

  revealActiveTab(topicTabs);
}

// Drag a tab to rearrange your dashboard. Trending is pinned first.
enableTabReorder({
  container: topicTabs,
  itemSelector: ".topic-tab",
  isFixed: (el) => el.dataset.topicId === TRENDING_ID,
  onReorder: (ids) => {
    selectedTopics = ids;
    tabIds = tabOrder(selectedTopics, articlesByTopic);
    chrome.storage.sync.set({ selected_topics: ids });
    renderTabs();
  },
});

// left/right arrows walk the tab strip
topicTabs.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

  const index = tabIds.indexOf(activeTopicId);
  const next =
    event.key === "ArrowRight"
      ? (index + 1) % tabIds.length
      : (index - 1 + tabIds.length) % tabIds.length;

  selectTopic(tabIds[next]);
  topicTabs.children[next]?.focus();
  event.preventDefault();
});

function render(topicIds, savedTopicId, articles, readingHistory) {
  articlesByTopic = articles || {};
  if (readingHistory) history = readingHistory;
  selectedTopics = (topicIds || []).filter((id) => getTopic(id));

  // On a fresh install nothing has been granted yet, so there is no cache and
  // no way to build one. Say that plainly instead of spinning on "Gathering".
  const everythingEmpty =
    selectedTopics.length > 0 &&
    selectedTopics.every((id) => !(articlesByTopic[id] || []).length);

  if (everythingEmpty) {
    chrome.permissions.contains(
      { origins: originsForTopics(selectedTopics) },
      (granted) => {
        if (!granted) {
          showNotice(
            "Drift needs access to your topics' sources before it can fetch anything.",
            "Grant access"
          );
        }
      }
    );
  }

  if (selectedTopics.length === 0) {
    activeTopicId = null;
    tabIds = [];
    showNotice(
      "Nothing to read yet — pick a few topics and Drift keeps a running digest here.",
      "Choose your topics"
    );
    return;
  }

  if (Object.keys(articlesByTopic).length === 0) {
    showSkeleton();
    chrome.runtime.sendMessage({ type: "REFRESH" }, (reply) => {
      if (reply?.articles) render(topicIds, savedTopicId, reply.articles);
    });
    return;
  }

  // Cache is on screen already — top it up in the background if it's stale.
  chrome.runtime.sendMessage({ type: "REFRESH_IF_STALE" }, (reply) => {
    if (chrome.runtime.lastError || !reply?.articles) return;
    if (sameArticles(reply.articles, articlesByTopic)) return;
    render(topicIds, activeTopicId, reply.articles);
  });

  tabIds = tabOrder(selectedTopics, articlesByTopic);

  // Trending leads unless you were last reading something else.
  activeTopicId = tabIds.includes(savedTopicId) ? savedTopicId : tabIds[0];

  renderTabs();
  renderStories();
  refreshActiveTopic();
}

chrome.storage.sync.get(
  {
    selected_topics: DEFAULT_TOPIC_IDS,
    display_mode: DEFAULT_DISPLAY_MODE,
    show_images: DEFAULT_SHOW_IMAGES,
  },
  (synced) => {
    showImages = synced.show_images;
    const bubbleMode = synced.display_mode === "bubble";
    resetPosBtn.hidden = !bubbleMode;

    chrome.storage.local.get(
      {
        bubble_docked: null,
        active_topic: null,
        articles: {},
        fetched_at: 0,
        opened_urls: {},
        seen_urls: {},
        unprompted_open: 0,
      },
      (local) => {
        // Only an open Drift initiated, and only once.
        unprompted = Date.now() - local.unprompted_open < 120000;
        if (unprompted) chrome.storage.local.remove("unprompted_open");

        showUpdated(local.fetched_at);
        render(synced.selected_topics, local.active_topic, local.articles, {
          opened: local.opened_urls,
          seen: local.seen_urls,
        });
        bubbleRow.hidden = !(bubbleMode && local.bubble_docked);
      }
    );
  }
);

document.getElementById("showBubbleBtn").addEventListener("click", () => {
  chrome.storage.local.set({ bubble_docked: null, bubble_pos: DEFAULT_POS }, () => {
    bubbleRow.hidden = true;
  });
});

resetPosBtn.addEventListener("click", () => {
  chrome.storage.local.set({ bubble_pos: DEFAULT_POS, bubble_docked: null });
});

document.getElementById("settingsBtn").addEventListener("click", openOptions);

document.getElementById("dateline").textContent = new Date().toLocaleDateString([], {
  weekday: "long",
  month: "long",
  day: "numeric",
});

// A popup closes when you click the page behind it, but that means clicking
// into whatever you were reading. This is the way out that doesn't disturb it.
document.getElementById("closeBtn").addEventListener("click", () => window.close());
document.getElementById("manageBtn").addEventListener("click", openOptions);

// A background refresh landing while the popup is open moves the stamp too.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.fetched_at) showUpdated(changes.fetched_at.newValue);
});
