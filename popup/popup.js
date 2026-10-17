const body = document.getElementById("body");
const topicTabs = document.getElementById("topicTabs");
const bubbleRow = document.getElementById("bubbleRow");
const resetPosBtn = document.getElementById("resetPosBtn");

const DEFAULT_POS = { xPct: 0.97, yPct: 0.42 };

let selectedTopics = [];
let articlesByTopic = {};
let activeTopicId = null;
let history = { opened: {}, seen: {} };
let unprompted = false;   // true when Drift opened this itself

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

function separator() {
  const dot = document.createElement("span");
  dot.className = "sep";
  return dot;
}

// Identity of a topic's stories, so we can tell a real update from a no-op.
function topicSignature(articles) {
  return (articles || []).map((article) => article.url).join("|");
}

function sameArticles(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].every((key) => topicSignature(a[key]) === topicSignature(b[key]));
}

// Knowing before you click beats discovering after.
function paywallTag() {
  const tag = document.createElement("span");
  tag.className = "paywall-tag";
  tag.textContent = "paywall";
  tag.title = "This source may ask you to subscribe";
  return tag;
}

// One story, several outlets: pick who you'd rather read it from.
function coverageRow(others) {
  const row = document.createElement("div");
  row.className = "story-sources";

  const label = document.createElement("span");
  label.className = "sources-label";
  label.textContent = "also in";
  row.appendChild(label);

  for (const other of others) {
    const chip = document.createElement("a");
    chip.className = "source-chip";
    chip.href = other.url;
    chip.target = "_blank";
    chip.rel = "noopener noreferrer";
    chip.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "MARK_OPENED", url: other.url });
    });

    const icon = document.createElement("img");
    icon.src = sourceIconUrl(other.source);
    icon.alt = "";
    icon.addEventListener("error", () => icon.remove());

    const name = document.createElement("span");
    name.textContent = other.source;

    chip.append(icon, name);
    if (other.paywall) chip.appendChild(paywallTag());
    row.appendChild(chip);
  }

  return row;
}

// isLead controls size only. The "new" marker comes from the article's own
// freshness, so a slow topic's lead never claims to be new when it isn't.
function renderStory(article, isLead) {
  const story = document.createElement("a");
  story.className = isLead ? "story lead" : "story";
  story.href = article.url;
  story.target = "_blank";
  story.rel = "noopener noreferrer";
  story.title = article.title;

  const headline = document.createElement("p");
  headline.className = "story-title";
  headline.textContent = article.title;

  // Not every feed ships one — Hacker News, for instance, has nothing useful.
  if (article.summary) {
    const lead = document.createElement("p");
    lead.className = "story-lead";
    lead.textContent = article.summary;
    story.appendChild(headline);
    story.appendChild(lead);
  }

  const meta = document.createElement("p");
  meta.className = "story-meta";

  if (article.fresh) {
    const fresh = document.createElement("span");
    fresh.className = "fresh";
    fresh.textContent = "new";
    meta.append(fresh, separator());
  }

  story.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "MARK_OPENED", url: article.url });
  });

  const mark = document.createElement("img");
  mark.className = "story-favicon";
  mark.src = sourceIconUrl(article.source);
  mark.alt = "";
  // A missing logo shouldn't leave a broken-image gap in the row.
  mark.addEventListener("error", () => mark.remove());

  const source = document.createElement("span");
  source.textContent = article.source;

  const wall = article.paywall ? paywallTag() : null;

  const time = document.createElement("span");
  time.textContent = timeAgo(article.publishedAt);

  meta.append(mark, source);
  if (wall) meta.appendChild(wall);
  meta.append(separator(), time);
  if (!article.summary) story.appendChild(headline);
  story.appendChild(meta);

  const others = (article.coverage || []).filter((c) => c.source !== article.source);
  if (!others.length) return story;

  // Anchors can't nest, so the other outlets sit beside the story card
  // rather than inside its click target.
  const wrap = document.createElement("div");
  wrap.className = "story-wrap";
  wrap.appendChild(story);
  wrap.appendChild(coverageRow(others));
  return wrap;
}

function renderStories() {
  let articles = pickStories(articlesByTopic[activeTopicId], history, 3);
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
    body.appendChild(renderStory(article, index === 0));
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

  selectedTopics.forEach((topicId) => {
    const topic = getTopic(topicId);
    if (!topic) return;

    const tab = document.createElement("button");
    tab.className = "topic-tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(topicId === activeTopicId));
    tab.textContent = topic.short || topic.label;

    tab.addEventListener("click", () => {
      selectTopic(topicId);
      tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });

    topicTabs.appendChild(tab);
  });
}

// left/right arrows walk the tab strip
topicTabs.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

  const index = selectedTopics.indexOf(activeTopicId);
  const next =
    event.key === "ArrowRight"
      ? (index + 1) % selectedTopics.length
      : (index - 1 + selectedTopics.length) % selectedTopics.length;

  selectTopic(selectedTopics[next]);
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
    showNotice(
      "Nothing to read yet — pick a few topics and Drift keeps a running digest here.",
      "Choose your topics"
    );
    return;
  }

  if (Object.keys(articlesByTopic).length === 0) {
    showNotice("Gathering headlines…");
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

  activeTopicId = selectedTopics.includes(savedTopicId)
    ? savedTopicId
    : selectedTopics[0];

  renderTabs();
  renderStories();
  refreshActiveTopic();
}

chrome.storage.sync.get(
  { selected_topics: DEFAULT_TOPIC_IDS, display_mode: DEFAULT_DISPLAY_MODE },
  (synced) => {
    const bubbleMode = synced.display_mode === "bubble";
    resetPosBtn.hidden = !bubbleMode;

    chrome.storage.local.get(
      {
        bubble_docked: null,
        active_topic: null,
        articles: {},
        opened_urls: {},
        seen_urls: {},
        unprompted_open: 0,
      },
      (local) => {
        // Only an open Drift initiated, and only once.
        unprompted = Date.now() - local.unprompted_open < 120000;
        if (unprompted) chrome.storage.local.remove("unprompted_open");

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
document.getElementById("manageBtn").addEventListener("click", openOptions);
