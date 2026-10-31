const digest = document.getElementById("digest");
const dateline = document.getElementById("dateline");
const greeting = document.getElementById("greeting");
const stopDailyBtn = document.getElementById("stopDailyBtn");
let lastRender = { topicIds: [], articles: {} };

let history = { opened: {}, seen: {} };
let unprompted = false;   // true when Drift opened this itself
let heldBack = [];
let showImages = DEFAULT_SHOW_IMAGES;

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function renderTopic(topic, pool) {
  let articles = pickStories(pool, history, STORIES_PER_TAB);

  if (unprompted) {
    const { shown, held } = partitionForUnprompted(articles);
    heldBack.push(...held);
    articles = shown;
  }
  const section = document.createElement("section");
  section.className = "topic";

  const label = document.createElement("h2");
  label.className = "topic-label";
  label.textContent = topic.label;
  section.appendChild(label);

  if (!articles || articles.length === 0) {
    const quiet = document.createElement("p");
    quiet.className = "topic-quiet";
    quiet.textContent = "Quiet here today.";
    section.appendChild(quiet);
  } else {
    articles.forEach((article, index) => {
      const trending = topic.id === TRENDING_ID;
      section.appendChild(renderStory(article, {
        lead: index === 0,
        images: showImages,
        tags: trending ? trendingTags(article) : [],
        rank: trending && index > 0 ? index + 1 : 0,
        index,
      }));
    });
  }

  digest.appendChild(section);
}

function render(topicIds, articles) {
  digest.textContent = "";
  lastRender = { topicIds, articles };

  // Trending leads the morning read, same as in the panel.
  const topics = tabOrder(topicIds, articles).map(getTopic).filter(Boolean);

  if (topics.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const copy = document.createElement("p");
    copy.textContent =
      "You haven't picked any topics yet. Choose a few and Drift will have something for you here each morning.";

    const button = document.createElement("button");
    button.className = "primary-btn";
    button.textContent = "Choose your topics";
    button.addEventListener("click", openOptions);

    empty.append(copy, button);
    digest.appendChild(empty);
    greeting.textContent = "Let's get you set up";
    return;
  }

  const shown = topics.flatMap((topic) => pickStories(articles[topic.id], history, STORIES_PER_TAB));
  const fresh = shown.filter((article) => article.fresh).length;

  chrome.runtime.sendMessage({
    type: "MARK_SEEN",
    urls: shown.map((article) => article.url),
  });
  greeting.textContent = fresh === 0 ? "A quiet one today" : "Here's what's new";

  heldBack = [];
  topics.forEach((topic) => renderTopic(topic, articles[topic.id]));

  if (heldBack.length) {
    const row = document.createElement("button");
    row.className = "heldback";
    row.textContent =
      heldBack.length === 1
        ? "1 story held back — it's a heavy one. Show it"
        : `${heldBack.length} stories held back — they're heavy ones. Show them`;
    row.addEventListener("click", () => {
      unprompted = false;
      render(lastRender.topicIds, lastRender.articles);
    });
    digest.appendChild(row);
  }
}

dateline.textContent = new Date().toLocaleDateString([], {
  weekday: "long",
  month: "long",
  day: "numeric",
});

chrome.storage.sync.get(
  { selected_topics: DEFAULT_TOPIC_IDS, show_images: DEFAULT_SHOW_IMAGES },
  (synced) => {
  showImages = synced.show_images;
  chrome.storage.local.get(
    { articles: {}, opened_urls: {}, seen_urls: {}, unprompted_open: 0 },
    (local) => {
    history = { opened: local.opened_urls, seen: local.seen_urls };

    // Only an open Drift initiated, and only this once — reopening the page
    // deliberately a minute later shows everything.
    unprompted = Date.now() - local.unprompted_open < 120000;
    if (unprompted) chrome.storage.local.remove("unprompted_open");
    chrome.runtime.sendMessage({ type: "METRIC", kind: "open", unprompted });

    render(synced.selected_topics, local.articles);

    // Top up if the cache went stale while the browser was asleep.
    chrome.runtime.sendMessage({ type: "REFRESH_IF_STALE" }, (reply) => {
      if (chrome.runtime.lastError || !reply?.articles) return;
      render(synced.selected_topics, reply.articles);
    });
    }
  );
  }
);

document.getElementById("manageBtn").addEventListener("click", openOptions);

stopDailyBtn.addEventListener("click", () => {
  chrome.storage.sync.set({ daily_open: false }, () => {
    stopDailyBtn.textContent = "Turned off — change it in settings";
    stopDailyBtn.classList.add("is-done");
    stopDailyBtn.disabled = true;
  });
});
