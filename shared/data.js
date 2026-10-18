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
      { url: "https://www.wired.com/feed/rss", name: "Wired" },
    ],
  },
  {
    id: "world",
    label: "World News",
    short: "World",
    emoji: "🌍",
    feeds: [
      { url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC World" },
      { url: "https://feeds.npr.org/1004/rss.xml", name: "NPR World" },
      { url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera" },
      { url: "https://www.theguardian.com/world/rss", name: "The Guardian" },
      { url: "https://api.axios.com/feed/", name: "Axios" },
      { url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", name: "The New York Times", paywall: true },
    ],
  },
  {
    id: "politics",
    label: "Politics",
    short: "Politics",
    emoji: "🏛️",
    feeds: [
      { url: "https://feeds.npr.org/1014/rss.xml", name: "NPR Politics" },
      { url: "https://rss.politico.com/politics-news.xml", name: "Politico" },
      { url: "https://www.semafor.com/rss.xml", name: "Semafor" },
      { url: "https://www.propublica.org/feeds/propublica/main", name: "ProPublica" },
      { url: "https://www.theatlantic.com/feed/all/", name: "The Atlantic", paywall: true },
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
    id: "finance",
    label: "Money & Markets",
    short: "Finance",
    emoji: "💰",
    feeds: [
      { url: "https://www.marketwatch.com/rss/topstories", name: "MarketWatch" },
      { url: "https://www.nerdwallet.com/blog/feed/", name: "NerdWallet" },
      { url: "https://www.kiplinger.com/feed/all", name: "Kiplinger" },
      { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664", name: "CNBC" },
      { url: "https://feeds.bloomberg.com/markets/news.rss", name: "Bloomberg", paywall: true },
      { url: "https://www.ft.com/rss/home", name: "Financial Times", paywall: true },
    ],
  },
  {
    id: "security",
    label: "Cybersecurity",
    short: "Security",
    emoji: "🔒",
    feeds: [
      { url: "https://krebsonsecurity.com/feed/", name: "Krebs on Security" },
      { url: "https://www.bleepingcomputer.com/feed/", name: "BleepingComputer" },
      { url: "https://feeds.feedburner.com/TheHackersNews", name: "The Hacker News" },
    ],
  },
  {
    id: "code",
    label: "Programming",
    short: "Code",
    emoji: "💻",
    feeds: [
      { url: "https://feed.infoq.com/", name: "InfoQ" },
      { url: "https://dev.to/feed", name: "Dev.to" },
      { url: "https://github.blog/feed/", name: "GitHub Blog" },
      { url: "https://www.theverge.com/rss/index.xml", name: "The Verge" },
      { url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", name: "The New York Times", paywall: true },
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
      { url: "https://www.nature.com/nature.rss", name: "Nature" },
      { url: "https://www.science.org/rss/news_current.xml", name: "Science" },
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
    id: "health",
    label: "Health & Medicine",
    short: "Health",
    emoji: "🧬",
    feeds: [
      { url: "https://www.statnews.com/feed/", name: "STAT News" },
      { url: "https://feeds.npr.org/1128/rss.xml", name: "NPR Health" },
      { url: "https://www.sciencedaily.com/rss/health_medicine.xml", name: "ScienceDaily" },
    ],
  },
  {
    id: "fitness",
    label: "Fitness & Training",
    short: "Fitness",
    emoji: "🏃",
    feeds: [
      { url: "https://www.outsideonline.com/feed/", name: "Outside" },
      { url: "https://www.runnersworld.com/rss/all.xml/", name: "Runner's World" },
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
    id: "architecture",
    label: "Architecture",
    short: "Architecture",
    emoji: "🏗️",
    feeds: [
      { url: "https://www.dezeen.com/feed/", name: "Dezeen" },
      { url: "https://www.archdaily.com/rss/", name: "ArchDaily" },
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
    id: "film",
    label: "Film & TV",
    short: "Film",
    emoji: "🎬",
    feeds: [
      { url: "https://variety.com/feed/", name: "Variety" },
      { url: "https://www.indiewire.com/feed/", name: "IndieWire" },
    ],
  },
  {
    id: "music",
    label: "Music",
    short: "Music",
    emoji: "🎵",
    feeds: [
      { url: "https://pitchfork.com/rss/news/", name: "Pitchfork" },
      { url: "https://www.stereogum.com/feed/", name: "Stereogum" },
      { url: "https://www.billboard.com/feed/", name: "Billboard" },
    ],
  },
  {
    id: "books",
    label: "Books",
    short: "Books",
    emoji: "📚",
    feeds: [
      { url: "https://lithub.com/feed/", name: "Literary Hub" },
      { url: "https://www.theguardian.com/books/rss", name: "Guardian Books" },
    ],
  },
  {
    id: "food",
    label: "Food & Cooking",
    short: "Food",
    emoji: "🍳",
    feeds: [
      { url: "https://www.eater.com/rss/index.xml", name: "Eater" },
      { url: "https://www.bonappetit.com/feed/rss", name: "Bon Appétit" },
    ],
  },
  {
    id: "cars",
    label: "Cars & EVs",
    short: "Cars",
    emoji: "🚗",
    feeds: [
      { url: "https://electrek.co/feed/", name: "Electrek" },
      { url: "https://insideevs.com/rss/articles/all/", name: "InsideEVs" },
      { url: "https://jalopnik.com/rss", name: "Jalopnik" },
    ],
  },
  {
    id: "crypto",
    label: "Crypto",
    short: "Crypto",
    emoji: "🪙",
    feeds: [
      { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", name: "CoinDesk" },
      { url: "https://decrypt.co/feed", name: "Decrypt" },
    ],
  },
  {
    id: "photo",
    label: "Photography",
    short: "Photo",
    emoji: "📷",
    feeds: [
      { url: "https://petapixel.com/feed/", name: "PetaPixel" },
      { url: "https://www.dpreview.com/feeds/news.xml", name: "DPReview" },
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

// Trending isn't a topic you follow — it's the best of everything you already
// follow, gathered in one place. It has no feeds of its own and never appears
// in the topic picker.
const TRENDING_ID = "trending";
const TRENDING_TOPIC = {
  id: TRENDING_ID,
  label: "Trending",
  short: "Trending",
  emoji: "🔥",
  feeds: [],
};

const DEFAULT_TOPIC_IDS = ["ai", "startups", "design"];

// "toolbar" keeps the page clean and lives in the Chrome toolbar;
// "bubble" floats a draggable button over the page.
const DEFAULT_DISPLAY_MODE = "toolbar";

// Drift can open itself unprompted once a day. A digest that greets someone
// that way with a headline about child abuse or a massacre is a different
// product from the one described on the listing page — so the automatic
// surface holds those back behind one click. Surfaces the user opened
// deliberately are never filtered.
//
// This is deliberately crude: plain substring matching will hold back some
// legitimate policy journalism, and will miss things it should catch. It is
// a politeness layer on one surface, not a content moderation system, and
// nothing is ever deleted — only moved behind "show these".
const UNPROMPTED_HOLDBACK = [
  "csam", "child abuse", "child sexual", "child porn", "pedophil",
  "rape", "raped", "sexual assault", "sexually assaulted",
  "suicide", "self-harm", "overdose death",
  "massacre", "beheaded", "mutilated", "tortured", "torture",
  "murdered", "dismembered", "child's body", "bodies of children",
];

function heldBackWhenUnprompted(article) {
  const title = String(article?.title || "").toLowerCase();
  return UNPROMPTED_HOLDBACK.some((term) => title.includes(term));
}

// Returns { shown, held } so the surface can say how many it is holding
// rather than quietly dropping them.
function partitionForUnprompted(articles) {
  const shown = [];
  const held = [];
  for (const article of articles || []) {
    (heldBackWhenUnprompted(article) ? held : shown).push(article);
  }
  return { shown, held };
}

// Host access is requested per topic rather than up front, so installing the
// extension asks for nothing. These are the origins a topic's feeds need.
function originOfFeed(url) {
  try {
    return new URL(url).origin + "/*";
  } catch (error) {
    return null; // a malformed feed URL shouldn't take the whole request down
  }
}

function originsForTopics(topicIds) {
  const origins = new Set();
  for (const id of topicIds || []) {
    const topic = getTopic(id);
    if (!topic) continue;
    for (const feed of topic.feeds) {
      const origin = originOfFeed(feed.url);
      if (origin) origins.add(origin);
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
    .normalize("NFD")                      // "Bon Appétit" -> "Bon Appe\u0301tit"
    .replace(/[\u0300-\u036f]/g, "")       // drop the combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? chrome.runtime.getURL("icons/sources/" + slug + ".png") : "";
}

// A "day" for the check-in starts in the morning, not at midnight. Plenty of
// people are still working at 00:05, and a digest that greets them then is an
// interruption rather than a morning briefing.
const DAY_STARTS_AT_HOUR = 6;

// The calendar date, shifted so the day rolls over at the start hour instead
// of at midnight: at 02:00 you are still on the previous day.
function todayKey(date, startHour) {
  const hour = Number.isInteger(startHour) ? startHour : DAY_STARTS_AT_HOUR;
  const d = new Date(date ? date.getTime() : Date.now());
  d.setHours(d.getHours() - hour);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// Needed on its own, beyond the shifted date: if yesterday stayed quiet and
// news lands at 02:00, the date alone would still let the digest fire then.
function tooEarlyToOpen(startHour, now) {
  const hour = Number.isInteger(startHour) ? startHour : DAY_STARTS_AT_HOUR;
  return (now || new Date()).getHours() < hour;
}

function getTopic(topicId) {
  if (topicId === TRENDING_ID) return TRENDING_TOPIC;
  return NEWSLETTER_TOPICS.find((topic) => topic.id === topicId) || null;
}

// The tab strip: Trending first, then the topics in the order you arranged
// them. Trending is omitted when there is nothing worth gathering.
function tabOrder(selectedTopics, articles) {
  const topics = (selectedTopics || []).filter((id) => getTopic(id));
  const hasTrending = (articles?.[TRENDING_ID] || []).length > 0;
  return hasTrending ? [TRENDING_ID, ...topics] : topics;
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
