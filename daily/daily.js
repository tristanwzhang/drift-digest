const digest = document.getElementById("digest");
const dateline = document.getElementById("dateline");
const greeting = document.getElementById("greeting");
const stopDailyBtn = document.getElementById("stopDailyBtn");

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function separator() {
  const dot = document.createElement("span");
  dot.className = "sep";
  return dot;
}

function renderStory(article, isLead) {
  const story = document.createElement("a");
  story.className = isLead ? "story lead" : "story";
  story.href = article.url;
  story.target = "_blank";
  story.rel = "noopener noreferrer";

  const headline = document.createElement("p");
  headline.className = "story-title";
  headline.textContent = article.title;

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

  const when = document.createElement("span");
  when.textContent = timeAgo(article.publishedAt);

  meta.append(source, separator(), when);
  story.append(headline, meta);
  return story;
}

function renderTopic(topic, articles) {
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

  const fresh = topics.reduce(
    (n, topic) => n + (articles[topic.id]?.filter((a) => a.fresh).length || 0),
    0
  );
  greeting.textContent = fresh === 0 ? "A quiet one today" : "Here's what's new";

  topics.forEach((topic) => renderTopic(topic, articles[topic.id]));
}

dateline.textContent = new Date().toLocaleDateString([], {
  weekday: "long",
  month: "long",
  day: "numeric",
});

chrome.storage.sync.get({ selected_topics: DEFAULT_TOPIC_IDS }, (synced) => {
  chrome.storage.local.get({ articles: {} }, (local) => {
    render(synced.selected_topics, local.articles);

    // Top up if the cache went stale while the browser was asleep.
    chrome.runtime.sendMessage({ type: "REFRESH_IF_STALE" }, (reply) => {
      if (chrome.runtime.lastError || !reply?.articles) return;
      render(synced.selected_topics, reply.articles);
    });
  });
});

document.getElementById("manageBtn").addEventListener("click", openOptions);

stopDailyBtn.addEventListener("click", () => {
  chrome.storage.sync.set({ daily_open: false }, () => {
    stopDailyBtn.textContent = "Turned off — change it in settings";
    stopDailyBtn.classList.add("is-done");
    stopDailyBtn.disabled = true;
  });
});
