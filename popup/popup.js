const body = document.getElementById("body");
const topicTabs = document.getElementById("topicTabs");
const bubbleRow = document.getElementById("bubbleRow");
const resetPosBtn = document.getElementById("resetPosBtn");

const DEFAULT_POS = { xPct: 0.97, yPct: 0.42 };

let selectedTopics = [];
let articlesByTopic = {};
let activeTopicId = null;

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

// The freshest story in each topic leads: larger, with an accent "new" marker.
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

  const meta = document.createElement("p");
  meta.className = "story-meta";

  if (isLead) {
    const fresh = document.createElement("span");
    fresh.className = "fresh";
    fresh.textContent = "new";
    meta.append(fresh, separator());
  }

  const source = document.createElement("span");
  source.textContent = article.source;

  const time = document.createElement("span");
  time.textContent = timeAgo(article.publishedAt);

  meta.append(source, separator(), time);
  story.append(headline, meta);
  return story;
}

function renderStories() {
  const articles = articlesByTopic[activeTopicId] || [];

  body.textContent = "";

  if (articles.length === 0) {
    const notice = document.createElement("div");
    notice.className = "empty-state";
    const copy = document.createElement("p");
    copy.textContent = "Couldn't reach this topic's sources. Trying again shortly.";
    notice.appendChild(copy);
    body.appendChild(notice);
    return;
  }

  articles.slice(0, 3).forEach((article, index) => {
    body.appendChild(renderStory(article, index === 0));
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

function render(topicIds, savedTopicId, articles) {
  articlesByTopic = articles || {};
  selectedTopics = (topicIds || []).filter((id) => getTopic(id));

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
}

chrome.storage.sync.get(
  { selected_topics: DEFAULT_TOPIC_IDS, display_mode: DEFAULT_DISPLAY_MODE },
  (synced) => {
    const bubbleMode = synced.display_mode === "bubble";
    resetPosBtn.hidden = !bubbleMode;

    chrome.storage.local.get(
      { bubble_docked: null, active_topic: null, articles: {} },
      (local) => {
        render(synced.selected_topics, local.active_topic, local.articles);
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
