const topicGrid = document.getElementById("topicGrid");
const savedHint = document.getElementById("savedHint");
const modeCards = Array.from(document.querySelectorAll(".mode-card"));
const dailyToggle = document.getElementById("dailyToggle");

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
    },
    showSavedHint
  );
}

dailyToggle.addEventListener("change", persist);

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
  },
  (data) => {
    selectedTopics = new Set(data.selected_topics);
    displayMode = data.display_mode;
    dailyToggle.checked = data.daily_open;
    renderGrid();
    renderModes();
  }
);
