const topicGrid = document.getElementById("topicGrid");
const savedHint = document.getElementById("savedHint");
const modeCards = Array.from(document.querySelectorAll(".mode-card"));
const dailyToggle = document.getElementById("dailyToggle");

let selectedTopics = new Set();
let displayMode = "bubble";
let savedHintTimer = null;

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
    displayMode = card.dataset.mode;
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
      } else {
        selectedTopics.add(topic.id);
      }
      renderGrid();
      persist();
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
