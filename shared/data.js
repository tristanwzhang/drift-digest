// Shared across the service worker, content script, popup, and options page
// (plain globals, no modules).
//
// `short` is the tab label; `label` is the full name used in settings.
// `feeds` are the sources fetched for that topic — `name` is what shows under a headline.

const NEWSLETTER_TOPICS = [
  {
    id: "ai",
    label: "Artificial Intelligence",
    short: "AI",
    emoji: "🤖",
    feeds: [
      { url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/", name: "MIT Tech Review" },
      { url: "https://arstechnica.com/ai/feed/", name: "Ars Technica" },
    ],
  },
  {
    id: "climate",
    label: "Climate & Energy",
    short: "Climate",
    emoji: "🌎",
    feeds: [
      { url: "https://grist.org/feed/", name: "Grist" },
      { url: "https://www.carbonbrief.org/feed/", name: "Carbon Brief" },
    ],
  },
  {
    id: "space",
    label: "Space Exploration",
    short: "Space",
    emoji: "🚀",
    feeds: [
      { url: "https://spacenews.com/feed/", name: "SpaceNews" },
      { url: "https://www.universetoday.com/feed/", name: "Universe Today" },
    ],
  },
  {
    id: "startups",
    label: "Startups & VC",
    short: "Startups",
    emoji: "💼",
    feeds: [
      { url: "https://techcrunch.com/feed/", name: "TechCrunch" },
      { url: "https://news.crunchbase.com/feed/", name: "Crunchbase News" },
    ],
  },
  {
    id: "health",
    label: "Personal Health",
    short: "Health",
    emoji: "🧬",
    feeds: [
      { url: "https://www.statnews.com/feed/", name: "STAT News" },
      { url: "https://feeds.npr.org/1128/rss.xml", name: "NPR Health" },
    ],
  },
  {
    id: "gaming",
    label: "Gaming",
    short: "Gaming",
    emoji: "🎮",
    feeds: [
      { url: "https://www.polygon.com/rss/index.xml", name: "Polygon" },
      { url: "https://kotaku.com/rss", name: "Kotaku" },
    ],
  },
  {
    id: "design",
    label: "Design & Product",
    short: "Design",
    emoji: "🎨",
    feeds: [
      { url: "https://www.smashingmagazine.com/feed/", name: "Smashing Magazine" },
      { url: "https://uxdesign.cc/feed", name: "UX Collective" },
    ],
  },
  {
    id: "finance",
    label: "Personal Finance",
    short: "Finance",
    emoji: "💰",
    feeds: [
      { url: "https://www.marketwatch.com/rss/topstories", name: "MarketWatch" },
      { url: "https://www.nerdwallet.com/blog/feed/", name: "NerdWallet" },
    ],
  },
  {
    id: "science",
    label: "Science",
    short: "Science",
    emoji: "🔬",
    feeds: [
      { url: "https://www.quantamagazine.org/feed/", name: "Quanta Magazine" },
      { url: "https://www.sciencenews.org/feed", name: "Science News" },
    ],
  },
  {
    id: "sports",
    label: "Sports",
    short: "Sports",
    emoji: "🏀",
    feeds: [
      { url: "https://www.espn.com/espn/rss/news", name: "ESPN" },
      { url: "https://www.cbssports.com/rss/headlines/", name: "CBS Sports" },
    ],
  },
];

const DEFAULT_TOPIC_IDS = ["ai", "startups", "design"];

// "toolbar" keeps the page clean and lives in the Chrome toolbar;
// "bubble" floats a draggable button over the page.
const DEFAULT_DISPLAY_MODE = "toolbar";

// Local calendar date — the unit the once-a-day check is measured in.
function todayKey(date) {
  const d = date || new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function getTopic(topicId) {
  return NEWSLETTER_TOPICS.find((topic) => topic.id === topicId) || null;
}

// Timestamps are stored as ISO strings and rendered relative, so "2h" stays
// honest between refreshes instead of freezing at fetch time.
function timeAgo(isoDate) {
  const then = new Date(isoDate).getTime();
  if (!then) return "";

  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return minutes + "m";

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h";

  const days = Math.round(hours / 24);
  if (days < 7) return days + "d";

  return Math.round(days / 7) + "w";
}
