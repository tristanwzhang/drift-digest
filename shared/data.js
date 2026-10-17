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
      { url: "https://the-decoder.com/feed/", name: "The Decoder" },
      { url: "https://www.marktechpost.com/feed/", name: "MarkTechPost" },
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
      { url: "https://insideclimatenews.org/feed/", name: "Inside Climate News" },
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
      { url: "https://www.nasa.gov/news-release/feed/", name: "NASA" },
      { url: "https://arstechnica.com/space/feed/", name: "Ars Technica" },
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
      { url: "https://news.ycombinator.com/rss", name: "Hacker News" },
      { url: "https://sifted.eu/feed", name: "Sifted" },
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
      { url: "https://www.sciencedaily.com/rss/health_medicine.xml", name: "ScienceDaily" },
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
      { url: "https://www.eurogamer.net/feed", name: "Eurogamer" },
      { url: "https://www.pcgamer.com/rss/", name: "PC Gamer" },
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
      { url: "https://www.nngroup.com/feed/rss/", name: "Nielsen Norman" },
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
      { url: "https://www.newscientist.com/feed/home/", name: "New Scientist" },
      { url: "https://www.sciencedaily.com/rss/all.xml", name: "ScienceDaily" },
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
      { url: "https://sports.yahoo.com/rss/", name: "Yahoo Sports" },
      { url: "https://feeds.bbci.co.uk/sport/rss.xml", name: "BBC Sport" },
    ],
  },
];

const DEFAULT_TOPIC_IDS = ["ai", "startups", "design"];

// "toolbar" keeps the page clean and lives in the Chrome toolbar;
// "bubble" floats a draggable button over the page.
const DEFAULT_DISPLAY_MODE = "toolbar";

// Host access is requested per topic rather than up front, so installing the
// extension asks for nothing. These are the origins a topic's feeds need.
function originsForTopics(topicIds) {
  const origins = new Set();
  for (const id of topicIds || []) {
    const topic = getTopic(id);
    if (!topic) continue;
    for (const feed of topic.feeds) {
      try {
        origins.add(new URL(feed.url).origin + "/*");
      } catch (error) {
        // a malformed feed URL shouldn't take the whole request down
      }
    }
  }
  return [...origins];
}

// How many times a story can sit in front of you, unclicked, before it steps
// aside for something newer. Not zero: glancing past something once shouldn't
// bury it.
const SEEN_DEMOTE_AT = 3;

// The cache holds a pool per topic; this trims it against what you've already
// read. Opened stories drop out entirely — you've read them. Stories shown
// repeatedly and ignored fall behind fresher ones but aren't deleted, so a
// quiet topic still has something in it.
function pickStories(pool, history, limit) {
  const opened = history?.opened || {};
  const seen = history?.seen || {};

  const unread = (pool || []).filter((article) => !opened[article.url]);

  const ahead = [];
  const behind = [];
  for (const article of unread) {
    const count = seen[article.url]?.n || 0;
    (count >= SEEN_DEMOTE_AT ? behind : ahead).push(article);
  }

  return [...ahead, ...behind].slice(0, limit ?? 3);
}

// Source logos are bundled rather than fetched: no request per headline, and
// nothing tells a publisher (or a favicon service) what the reader follows.
// Filenames are slugified source names; see icons/sources/_map.json.
function sourceIconUrl(sourceName) {
  const slug = String(sourceName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? chrome.runtime.getURL("icons/sources/" + slug + ".png") : "";
}

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
