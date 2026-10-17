const digest = document.getElementById("digest");
const dateline = document.getElementById("dateline");
const greeting = document.getElementById("greeting");
const stopDailyBtn = document.getElementById("stopDailyBtn");
let lastRender = { topicIds: [], articles: {} };

let history = { opened: {}, seen: {} };
let unprompted = false;   // true when Drift opened this itself
let heldBack = [];

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function separator() {
  const dot = document.createElement("span");
  dot.className = "sep";
  return dot;
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
  story.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "MARK_OPENED", url: article.url });
  });

  const headline = document.createElement("p");
  headline.className = "story-title";
  headline.textContent = article.title;
  story.appendChild(headline);

  // Not every feed ships one — Hacker News, for instance, has nothing useful.
  if (article.summary) {
    const lead = document.createElement("p");
    lead.className = "story-lead";
    lead.textContent = article.summary;
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

  const mark = document.createElement("img");
  mark.className = "story-favicon";
  mark.src = sourceIconUrl(article.source);
  mark.alt = "";
  // A missing logo shouldn't leave a broken-image gap in the row.
  mark.addEventListener("error", () => mark.remove());

  const source = document.createElement("span");
  source.textContent = article.source;

  const wall = article.paywall ? paywallTag() : null;

  const when = document.createElement("span");
  when.textContent = timeAgo(article.publishedAt);

  meta.append(mark, source);
  if (wall) meta.appendChild(wall);
  meta.append(separator(), when);
  story.appendChild(meta);

  const others = (article.coverage || []).filter((c) => c.source !== article.source);
  if (!others.length) return story;

  // Anchors can't nest, so the other outlets sit beside the story card.
  const wrap = document.createElement("div");
  wrap.className = "story-wrap";
  wrap.appendChild(story);
  wrap.appendChild(coverageRow(others));
  return wrap;
}

function renderTopic(topic, pool) {
  let articles = pickStories(pool, history, 3);

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
      section.appendChild(renderStory(article, index === 0));
    });
  }

  digest.appendChild(section);
}

function render(topicIds, articles) {
  digest.textContent = "";
  lastRender = { topicIds, articles };

  const topics = (topicIds || []).map(getTopic).filter(Boolean);

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

  const shown = topics.flatMap((topic) => pickStories(articles[topic.id], history, 3));
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

chrome.storage.sync.get({ selected_topics: DEFAULT_TOPIC_IDS }, (synced) => {
  chrome.storage.local.get(
    { articles: {}, opened_urls: {}, seen_urls: {}, unprompted_open: 0 },
    (local) => {
    history = { opened: local.opened_urls, seen: local.seen_urls };

    // Only an open Drift initiated, and only this once — reopening the page
    // deliberately a minute later shows everything.
    unprompted = Date.now() - local.unprompted_open < 120000;
    if (unprompted) chrome.storage.local.remove("unprompted_open");

    render(synced.selected_topics, local.articles);

    // Top up if the cache went stale while the browser was asleep.
    chrome.runtime.sendMessage({ type: "REFRESH_IF_STALE" }, (reply) => {
      if (chrome.runtime.lastError || !reply?.articles) return;
      render(synced.selected_topics, reply.articles);
    });
    }
  );
});

document.getElementById("manageBtn").addEventListener("click", openOptions);

stopDailyBtn.addEventListener("click", () => {
  chrome.storage.sync.set({ daily_open: false }, () => {
    stopDailyBtn.textContent = "Turned off — change it in settings";
    stopDailyBtn.classList.add("is-done");
    stopDailyBtn.disabled = true;
  });
});
