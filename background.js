// Service worker: fetches the feeds, normalizes them, caches the result.
// The panel and popup only ever read from that cache, so opening is instant.

importScripts("shared/data.js", "worker/engagement.js");

const REFRESH_MINUTES = 30;
// How stale the cache may be before opening the panel triggers a fetch.
// Opening it twice in a minute shouldn't hit every feed twice.
// Measured against our own feeds: only about 1 in 8 publishers honours
// If-None-Match. The rest return a full 200 regardless, so a refresh costs
// real bandwidth and this threshold has to stay conservative.
const STALE_AFTER_MS = 5 * 60 * 1000;
// Refreshing just the topic you're reading is ~4 requests instead of ~35,
// which is cheap enough to do whenever you open or switch tabs.
const TOPIC_STALE_AFTER_MS = 60 * 1000;
// Per-feed item cache, so a 304 can be answered from memory.
const CACHE_PER_FEED = 15;
// How many outlets to offer for one story before it stops being useful.
const MAX_SOURCES_PER_STORY = 5;
// How many stories the Trending tab gathers, at most.
const TRENDING_SIZE = STORIES_PER_TAB;
// The cache holds more than it shows, so each surface can skip what you've
// already read without going back to the network.
const POOL_PER_TOPIC = STORIES_PER_TAB + 4;
// What a story has to score to be shown at all. A tab holds every story that
// clears it, up to STORIES_PER_TAB, and none if none do — a fixed three meant
// a slow topic padded itself with "UX Disciplines: Glossary" while a busy one
// hid its fourth-best story. At 5 — an ordinary outlet's own lead in its
// first few hours — the bottom of a thin tab was "Roller coaster safety is a
// matter of science" and an advertorial on industrial intelligence. At 6 a
// lone story needs a reputable newsroom leading with it, or a second outlet, a
// scoop, or real stakes. Nothing beats mid. Trending asks more, after
// weighting by where the topic sits on your dashboard.
const STORY_FLOOR = 6;
const TRENDING_FLOOR = 8;
// Two days. Long enough to cover a day you didn't open the browser; short
// enough that nothing here is old news. A slow topic goes quiet sooner than
// it did at a week, and that's the intended trade — see NOTES.md.
const MAX_AGE_HOURS = 48;
// Only this recent earns the "new" marker.
const FRESH_HOURS = 24;
const FETCH_TIMEOUT_MS = 10000;
// Feeds vary wildly — some ship a sentence, some ship the entire article.
// Truncation happens at parse time so a full body never reaches the cache:
// this is a lead to help you decide, not a copy of the piece.
const SUMMARY_MAX = 150;
// Feeds are 91 dependencies nobody here controls, and they rot quietly:
// ESPN answered HTTP 202 with an empty body for nine days and the Sports tab
// simply had one less source. A feed that keeps failing is asked less often
// rather than never, so it can come back on its own.
const FEED_FAIL_GRACE = 3;
const FEED_BACKOFF_BASE_MS = 60 * 60 * 1000;
const FEED_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
const ALARM = "drift-refresh";
const DAILY_KEY = "last_daily_open";
const BUBBLE_SCRIPT_ID = "drift-bubble";
const BUBBLE_FILES = ["shared/data.js", "shared/story.js", "shared/reorder.js", "content/content.js"];

// ---------- what isn't news ----------
//
// Feeds carry more than journalism. Wired's RSS ships its affiliate coupon
// pages; CBS Sports ships sportsbook promos. Measured over a day of live
// feeds these are 2% of everything fetched, and every single match was
// checked by hand — none of them is a story.
const NOT_NEWS = new RegExp([
  "\\b(promo|coupon|discount) codes?\\b",
  "\\bgift guide\\b", "\\bbest gifts\\b",
  "\\b\\d+% off\\b", "\\b\\$\\d+ off\\b",
  "\\bdeals?\\b[^.]*\\bfor \\$\\d",
  "\\bprime day\\b",
  "\\b(wordle|quordle|connections|crossword|sudoku|strands)\\b[^.]*\\b(answer|answers|hint|hints|clue|clues)\\b",
  "^crossword\\b", "\\bhoroscope\\b", "^sign up for\\b",
  "\\b(parlay|prop bets|best bets|daily fantasy|dfs)\\b",
  "\\bbetting (preview|promo)\\b",
].join("|"), "i");

// Real reporting, but derivative: recaps, rankings, listicles. These are worth
// keeping for a quiet day in their own topic, and never worth a Trending slot.
const LOW_VALUE = new RegExp([
  "\\btakeaways\\b", "\\bwinners and losers\\b", "\\bpower rankings\\b",
  "\\bmock draft\\b", "\\bwaiver wire\\b", "\\bfantasy (football|baseball|basketball)\\b",
  "\\bwhat we learned\\b", "\\bthings we learned\\b",
  "^(the )?\\d+ (best|worst|things|ways|reasons|tips|tricks|gifts|gadgets|alternatives)\\b",
  "\\bhow to watch\\b", "\\bwhere to watch\\b", "\\bwatch live\\b",
  "\\b(review )?roundup\\b", "\\bweek in review\\b",
  "\\bodds, (start )?time\\b", "\\bprediction, odds\\b", "\\bpicks by\\b",
  "\\bodds, predictions?\\b", "\\bby proven (model|computer)\\b",
  "\\b(nba|nfl|mlb|nhl|ncaa|college football|college basketball) picks\\b",
  // Archives and asides: a closed live blog, a clip, a quiz about the news.
  "\\bas it happened\\b", "^watch:", "^quiz:", "\\((video|podcast|audio)\\)$",
  // A match or a market in progress. Audited against two days of live
  // headlines: every hit was a live blog, a stream link or a scorecard.
  "(^|[:\u2013\u2014-]\\s*)live\\b\\s*([\u2013\u2014:-]|$)",
  "\\blive (blog|updates|coverage|stream|scorecard)\\b", "\\bmatchday live\\b",
  "^news wrap:", "^who said it\\b", "\\b(news|daily) quiz\\b",
  "\\bnewsletter:", "^here.s the latest\\.?$",
].join("|"), "i");

// Two unrelated stories in one headline is a briefing, not a report: NPR's
// "Democrats have a midterm edge, poll shows. And, Israelis vote" belongs to
// neither story well. Case matters — "U.S. and Israeli" is one story.
const BRIEFING = /[.?!]\s+And,\s/;

// A headline a reader of an English digest can't read is not a headline for
// them. Judged by which script the title is mostly in, never by the presence
// of a single character: of 1,127 live titles, one was majority non-Latin and
// none were English headlines that merely quoted a foreign name.
const FOREIGN_SCRIPT =
  /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]/g;

function mostlyForeign(title) {
  const foreign = (title.match(FOREIGN_SCRIPT) || []).length;
  if (foreign < 2) return false;
  const latin = (title.match(/[A-Za-z]/g) || []).length;
  return foreign > latin;
}

// ---------- a small RSS/Atom reader ----------
// MV3 service workers have no DOM, so DOMParser isn't available here.
// Feeds are a narrow, predictable shape, so this reads them directly.

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
};

// Feeds that double-encode ("Mbapp&amp;eacute;") leave a named accent behind
// once &amp; is undone. Accents come in a regular family, so the family is
// decoded rather than listed one by one.
const ACCENTS = { acute: "\u0301", grave: "\u0300", circ: "\u0302", tilde: "\u0303", uml: "\u0308", cedil: "\u0327" };

function decodeEntities(text) {
  return decodeOnce(decodeOnce(text));
}

function decodeOnce(text) {
  return text
    .replace(/&([a-z])(acute|grave|circ|tilde|uml|cedil);/gi,
      (_, letter, accent) => (letter + ACCENTS[accent.toLowerCase()]).normalize("NFC"))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z#0-9]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function clean(text) {
  if (!text) return "";
  return decodeEntities(
    text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function pickTag(block, tag) {
  const match = block.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
  return match ? match[1] : "";
}

function pickLink(block) {
  // Atom puts the URL in an attribute; RSS puts it in the element body.
  const atom = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
    || block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (atom) return decodeEntities(atom[1].trim());

  const rss = clean(pickTag(block, "link"));
  if (rss) return rss;

  return clean(pickTag(block, "guid"));
}

// A one-line lead, taken from whatever the feed offers.
function pickSummary(block, title) {
  let best = "";
  for (const tag of ["description", "summary", "content:encoded", "content"]) {
    const text = clean(pickTag(block, tag));
    if (text.length > best.length) best = text;
  }

  if (!best) return "";

  // Some feeds just repeat the headline; that's noise, not context.
  const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalize(best).startsWith(normalize(title)) && best.length < title.length * 1.4) {
    return "";
  }
  if (best.length < 30) return "";

  if (best.length <= SUMMARY_MAX) return best;

  // cut on a word boundary so it reads as a sentence trailing off
  const cut = best.slice(0, SUMMARY_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > SUMMARY_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:—-]+$/, "") + "…";
}

// The picture the outlet chose for its own story. Feeds offer it several ways
// and often several sizes, so take the largest declared one; fall back to the
// first picture in the body. Inline images in a body include tracking pixels
// (NerdWallet ships one on every item), which must never be loaded — a
// picture is only taken from the body when nothing about it says pixel.
const IMAGE_TAGS = /<(media:content|media:thumbnail|enclosure)\b[^>]*>/gi;
const NOT_A_PICTURE = /\.gif(\?|$)|pixel|tracking|beacon|feedburner|doubleclick|\b1x1\b|gravatar/i;

function attr(tag, name) {
  const match = tag.match(new RegExp("\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i"));
  return match ? decodeEntities(match[2].trim()) : "";
}

function pickImage(block) {
  let best = "";
  let bestWidth = -1;
  for (const [tag] of block.matchAll(IMAGE_TAGS)) {
    const url = attr(tag, "url");
    if (!/^https:\/\//i.test(url) || NOT_A_PICTURE.test(url)) continue;
    const type = attr(tag, "type");
    const medium = attr(tag, "medium");
    if (type && !/^image\//i.test(type)) continue;
    if (medium && medium !== "image") continue;
    const width = Number(attr(tag, "width")) || 0;
    if (width > bestWidth) {
      best = url;
      bestWidth = width;
    }
  }

  if (!best) {
    const body = (pickTag(block, "content:encoded") || pickTag(block, "description"))
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    const img = decodeEntities(body).match(/<img\b[^>]*>/i);
    const url = img ? attr(img[0], "src") : "";
    const width = img ? attr(img[0], "width") : "";
    // A declared width under 100 is an icon or a pixel, not a photograph.
    const tiny = width !== "" && Number(width) < 100;
    if (/^https:\/\//i.test(url) && !NOT_A_PICTURE.test(url) && !tiny) best = url;
  }

  return sized(best);
}

// Several outlets link the camera original — Semafor's are 2MB, CBS's 2.3MB,
// Politico's 8.5MB — for a picture shown 360px wide. Where the outlet's own
// image service takes a width, ask it for one; each rewrite here was checked
// to return a real, smaller image. Politico's has no such option, and eight
// megabytes for a thumbnail is not a cost to put on a reader, so it goes
// without.
const IMAGE_WIDTH = 800;
const RESIZERS = [
  [/^(https:\/\/ichef\.bbci\.co\.uk\/ace\/standard\/)\d+\//, `$1${IMAGE_WIDTH}/`],
  [/^(https:\/\/npr\.brightspotcdn\.com\/.*\/resize\/)[^/]+\//, `$1${IMAGE_WIDTH}/`],
  [/^(https:\/\/(img\.semafor\.com|sportshub\.cbsistatic\.com)\/[^?]+)$/, `$1?w=${IMAGE_WIDTH}&width=${IMAGE_WIDTH}`],
  [/^(https:\/\/images\.(wsj|mktw)\.net\/im-\d+)$/, `$1?width=${IMAGE_WIDTH}`],
];
const TOO_HEAVY = /^https:\/\/static\.politico\.com\//;

function sized(url) {
  if (!url || TOO_HEAVY.test(url)) return "";
  for (const [pattern, replacement] of RESIZERS) {
    if (pattern.test(url)) return url.replace(pattern, replacement);
  }
  return url;
}

function pickDate(block) {
  const raw =
    pickTag(block, "pubDate") ||
    pickTag(block, "published") ||
    pickTag(block, "updated") ||
    pickTag(block, "dc:date");

  const parsed = new Date(clean(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// A live blog's title leads with its date — "Stock Market News, Oct. 27, 2026:
// Tech Stocks Extend Gains" — which a dated card already says. The headline is
// what follows the colon.
const DATED_PREFIX = /^[^:]{3,40}, (jan|feb|mar|apr|may|june?|july?|aug|sept?|oct|nov|dec)[a-z]*\.? \d{1,2}, \d{4}: (?=\S)/i;

// Designboom writes every headline in lower case, which reads as a typo in a
// serif headline set beside everyone else's. Only a title with no capital
// anywhere is touched, and only its first letter.
function tidyTitle(title) {
  const trimmed = title.replace(DATED_PREFIX, "");
  if (/[A-Z]/.test(trimmed)) return trimmed;
  return trimmed.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function parseFeed(xml, sourceName) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];

  return blocks
    .map((block, index) => {
      const title = tidyTitle(clean(pickTag(block, "title")));
      return {
        title,
        ...(LOW_VALUE.test(title) || BRIEFING.test(title) ? { lowValue: true } : {}),
        summary: pickSummary(block, title),
        image: pickImage(block) || undefined,
        url: pickLink(block),
        source: sourceName,
        // Where the outlet placed it. Editors lead with what they think
        // matters, which is free editorial judgement we'd otherwise discard.
        feedPosition: index,
        publishedAt: pickDate(block) || new Date().toISOString(),
      };
    })
    .filter((item) =>
      item.title &&
      /^https?:\/\//i.test(item.url) &&
      !NOT_NEWS.test(item.title) &&
      !mostlyForeign(item.title)
    );
}

// ---------- ranking ----------
//
// Sorting purely by timestamp surfaces filler: a wallpapers post outranks real
// news just by being newer, and a week-old item leads a slow topic while
// wearing a "new" badge. So: drop the stale, then let agreement between
// independent sources decide what matters.

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "could", "every", "from", "have",
  "into", "more", "most", "nach", "over", "said", "says", "some", "such",
  "than", "that", "their", "them", "then", "there", "these", "they", "this",
  "were", "what", "when", "where", "which", "while", "will", "with", "would",
  "your", "been", "being", "just", "like", "make", "made", "much", "only",
  "other", "still", "take", "very", "year", "years",
]);

function titleTokens(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
  );
}

// Plain word overlap can't tell "both about the NFL" from "the same story":
// two outlets covering one event share rare proper nouns ("Jagex", "Nemotron"),
// while unrelated pieces in a topic share its common vocabulary ("season",
// "predictions"). So weight each word by how rare it is in the batch.
function buildWeights(tokenSets) {
  const docFreq = new Map();
  tokenSets.forEach((set) =>
    set.forEach((word) => docFreq.set(word, (docFreq.get(word) || 0) + 1))
  );

  const total = Math.max(1, tokenSets.length);
  const weights = new Map();
  docFreq.forEach((count, word) => {
    weights.set(word, Math.log(1 + total / count));
  });
  return weights;
}

function weightOf(weights, word) {
  return weights.get(word) ?? Math.log(2);
}

// Weighted Jaccard: shared rare words count for much more than shared common ones.
function similarity(a, b, weights = new Map()) {
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  let union = 0;

  a.forEach((word) => {
    const w = weightOf(weights, word);
    union += w;
    if (b.has(word)) shared += w;
  });
  b.forEach((word) => {
    if (!a.has(word)) union += weightOf(weights, word);
  });

  return union === 0 ? 0 : shared / union;
}

// Tuned empirically against a day of live feeds. Biased toward over-merging:
// losing a story to a false merge is invisible, but the same story twice in a
// three-item list is the redundancy that makes people stop opening this.
const SAME_STORY = 0.30;

// Overlap as a *proportion* of the headline penalises a vivid one. Measured
// live, the Guardian's "Four people killed in 'violent, fast-moving' fire at
// Canadian military base" and NPR's "Carney says 4 service members killed ...
// at Alberta military base" are one story, but the Guardian's extra colour
// dilutes the ratio below the bar — so four outlets were counted as two
// pairs, halving the strongest signal there is. A second test catches these:
// enough rare words in common, close enough in time. Rarity is counted in
// units of a word seen exactly once in the batch, so the bar doesn't drift
// as the batch grows.
const SHARED_WORDS = 3;
const SHARED_RARITY = 2.6;
const SAME_STORY_WINDOW_H = 48;

function sharedRarity(a, b, weights) {
  let weight = 0;
  let count = 0;
  a.forEach((word) => {
    if (!b.has(word)) return;
    weight += weightOf(weights, word);
    count += 1;
  });
  return { weight, count };
}

function hoursApart(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 3.6e6;
}

function sameStory(cluster, tokens, item, weights, singleSighting) {
  if (similarity(cluster.tokens, tokens, weights) >= SAME_STORY) return true;

  const { weight, count } = sharedRarity(cluster.tokens, tokens, weights);
  if (count < SHARED_WORDS) return false;
  if (weight < SHARED_RARITY * singleSighting) return false;
  return hoursApart(item.publishedAt, cluster.item.publishedAt) <= SAME_STORY_WINDOW_H;
}

function ageHours(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / 3.6e6;
}

// Collapse the same story reported by several sources into one item, and
// remember how many sources carried it — agreement is the strongest signal
// we can get without a model.
function cluster(items) {
  const tokenSets = items.map((item) => titleTokens(item.title));
  const weights = buildWeights(tokenSets);
  // What one word is worth if it appears exactly once in this batch.
  const singleSighting = Math.log(1 + Math.max(1, items.length));
  const clusters = [];

  items.forEach((item, index) => {
    const tokens = tokenSets[index];
    const match = clusters.find((c) => sameStory(c, tokens, item, weights, singleSighting));

    if (match) {
      match.sources.add(item.source);
      match.topics.push(item.topicId);
      match.members.push(item);
      // keep the earliest report; it's usually the one that broke it
      if (new Date(item.publishedAt) < new Date(match.item.publishedAt)) {
        match.item = item;
      }
      // but credit the best placement any outlet gave it
      match.bestPosition = Math.min(match.bestPosition, item.feedPosition ?? 9);
    } else {
      clusters.push({
        item,
        tokens,
        sources: new Set([item.source]),
        topics: [item.topicId],
        members: [item],
        bestPosition: item.feedPosition ?? 9,
      });
    }
  });

  return clusters.map((c) => {
    // One row per outlet, newest first, so the reader can pick who to read it
    // from rather than being handed whichever copy we happened to keep.
    const bySource = new Map();
    for (const member of c.members) {
      const existing = bySource.get(member.source);
      if (!existing || new Date(member.publishedAt) > new Date(existing.publishedAt)) {
        bySource.set(member.source, member);
      }
    }

    const coverage = [...bySource.values()]
      .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
      .slice(0, MAX_SOURCES_PER_STORY)
      .map((member) => ({
        source: member.source,
        url: member.url,
        at: member.publishedAt,
        ...(member.paywall ? { paywall: true } : {}),
      }));

    // Which outlets filed on this story lately, counted before the list above
    // is cut to five: an event's pace is the number of desks working it right
    // now, and the five earliest are exactly the wrong five to count.
    const filedRecent = [...bySource.values()]
      .filter((member) => ageHours(member.publishedAt) <= DEVELOPING_WINDOW_H)
      .map((member) => member.source);

    // The earliest report leads — but never let a recap speak for the story
    // it recaps. If any outlet filed the real thing, that's the one shown.
    const reporting = c.members.filter((member) => !member.lowValue);
    const candidates = reporting.length ? reporting : c.members;
    const lead = candidates.reduce((earliest, member) =>
      new Date(member.publishedAt) < new Date(earliest.publishedAt) ? member : earliest
    );

    // If it shipped no summary, borrow one from another outlet rather than
    // showing a bare headline.
    const summary =
      lead.summary || c.members.find((member) => member.summary)?.summary || "";

    // Agreement counted by who agrees, not merely how many. Every outlet
    // beyond the strongest one carrying the story adds its own standing, so
    // two wire-copy blogs agreeing is worth less than two desks agreeing.
    // A quiz that names the same person, or a recap of the same game, is not
    // a second desk deciding the story matters — it is the first desk's story
    // being reused. Only reporting counts toward agreement.
    const independent = new Set(reporting.map((member) => member.source));
    const standings = [...independent].map(standingOf).sort((a, b) => b - a);
    const agreement = standings.slice(1).reduce((sum, value) => sum + value, 0);

    return {
      ...lead,
      summary,
      agreement: Number(agreement.toFixed(3)),
      corroboration: Math.max(1, independent.size),
      filedRecent,
      feedPosition: c.bestPosition,
      fresh: ageHours(lead.publishedAt) < FRESH_HOURS,
      topics: c.topics,
      coverage: coverage.length > 1 ? coverage : undefined,
    };
  });
}

// Ranking by recency hands every slot to whichever outlet publishes fastest:
// measured live, Dev.to held all ten top slots in Programming, and Axios
// outranked the NYT in World purely on volume. Interleaving by source gives
// each outlet its best story before any outlet gets a second one, so a
// selective publisher isn't buried by a prolific one.
function interleaveBySource(ranked, limit) {
  const bySource = new Map();
  for (const item of ranked) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }

  // Sources are visited in the order their best story ranked.
  const queues = [...bySource.values()];
  const out = [];

  for (let round = 0; out.length < limit; round += 1) {
    let placed = false;
    for (const queue of queues) {
      if (!queue[round]) continue;
      out.push(queue[round]);
      placed = true;
      if (out.length >= limit) break;
    }
    if (!placed) break;
  }

  return out;
}

const LOW_VALUE_DRAG = 6;
// Each corroborating outlet's standing is worth this much.
const AGREEMENT_GAIN = 2.2;
// What leading a feed is worth, before the outlet's standing scales it.
const PLACEMENT_LEAD = 2.5;
const PLACEMENT_STEP = 0.25;
// What an outlet's standing is worth on its own.
const AUTHORITY_GAIN = 4;

// What a front page is made of, beyond agreement: the story only one desk has,
// and the story where something large just changed. Both are read off the
// headline, so both are kept narrow and checked by hand against a live day —
// "the secret to slower aging" is a formula, not a scoop, and is left out.
// They scale with the outlet's standing: an exclusive is a claim, and it is
// worth what the newsroom making it is worth.
const SCOOP = new RegExp([
  "^(exclusive|scoop)\\b", "\\bexclusive:",
  "\\b(obtained by|documents show|records show|leaked)\\b",
  "\\bin (advanced |early |exclusive )?talks (to|with|for|over)\\b",
  "\\bsecret(ly)? (court|ruling|memo|deal|plan|talks|program|meeting|recording|files|documents|payments)\\b",
  "\\bhiding a secret\\b",
].join("|"), "i");
const SCOOP_GAIN = 3;

const STAKES = new RegExp([
  "\\b(historic|unprecedented|first[- ]ever|landslide|trillion)\\b",
  "\\brecord (high|low|seats|revenue|number|amounts?|heat|turnout)\\b", "\\ba likely record\\b",
  "\\b(collapses?|collapsed|crash(es|ed)?|plunges?|plunged|soars?|soared|surges?|surged)\\b",
  "\\b(stuns?|stunned|stunning|upset)\\b", "\\bshock (win|defeat|loss|reelection|result|recall)\\b",
  "\\b(resigns?|resigned|ousted|indicted|indictment|arrested|topples?|toppled|fled|flees)\\b",
].join("|"), "i");
const STAKES_GAIN = 1.5;

// How much a story matters, from signals we can actually observe. Recency used
// to decide this on its own, which is why a wallpaper roundup could outrank
// real news simply by being newer.
function importance(item) {
  const standing = standingOf(item.source);

  // Independent outlets choosing the same story remains the strongest signal
  // available without a model — but weighted by whose judgement it is.
  const agreement = (item.agreement || 0) * AGREEMENT_GAIN;

  // A story that belongs to two of your topics is bigger than one that
  // belongs to a single corner of your interests.
  const breadth = (new Set(item.topics || []).size - 1) * 2;

  // Position in the feed is the outlet's own front page, and it is worth
  // more from an outlet that files a dozen considered stories a day than from
  // one that files sixty — leading a feed nobody edits is not a judgement.
  const placement =
    Math.max(0, PLACEMENT_LEAD - (item.feedPosition ?? 9) * PLACEMENT_STEP) * standing;

  // And the standing itself: a front-page lead from a large accountable
  // newsroom is worth surfacing even when nobody else has picked it up yet.
  // Without this the ranking quietly prefers whatever is most duplicated.
  const authority = (standing - 1) * AUTHORITY_GAIN;

  // Recency still counts, but it no longer wins on its own.
  const age = ageHours(item.publishedAt);
  const freshness = Math.max(0, 3 - age / 10);

  // A recap of a game is not the game. Heavy enough that derivative pieces
  // sit below real reporting, light enough that a quiet topic can still
  // show one rather than nothing.
  const derivative = item.lowValue ? LOW_VALUE_DRAG : 0;

  const scoop = SCOOP.test(item.title) ? SCOOP_GAIN * standing : 0;
  const stakes = STAKES.test(item.title) ? STAKES_GAIN * standing : 0;

  return agreement + authority + breadth + placement + freshness + scoop + stakes
    - derivative;
}

function byScore(a, b) {
  return b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt);
}

function rank(items) {
  const stories = cluster(items)
    .map((item) => ({ ...item, score: importance(item) }))
    .sort(byScore);
  return withEvents(stories)
    .map((item) => ({ ...item, score: Number(item.score.toFixed(3)) }))
    .sort(byScore);
}

// ---------- events ----------
//
// Clustering above finds the same *article* told twice: two outlets writing
// "No clear winner in Israel's election". It cannot see that "Rivals in Israel
// Election Strike Tone of Triumph", "Israeli turnout hits three-decade high"
// and "What to Expect Now That Polls Are Closed in Israel" are one *event*.
// Measured on a day of live feeds, the three biggest stories in the world —
// Anthropic's IPO (20 headlines, 12 outlets), Lula's upset in Brazil (21, 10)
// and Israel's election (18, 7) — each reached the ranking as a scatter of
// single-outlet stories. So the day's front page looked like nobody had
// noticed it, while World spent all three of its slots on Israel.
//
// An event is the set of stories that share at least two names-or-rare-words
// with its strongest story. Star-shaped on purpose: joining to the seed alone,
// never to whatever joined last, stops one combined briefing ("Democrats have
// a midterm edge. And, Israelis vote") from chaining two events into one.

// Names that are made of common words; kept whole so "Trump administration"
// is one name, not a name plus a word every second political story shares.
const EVENT_PHRASES = [
  "trump administration", "biden administration", "white house", "wall street",
  "supreme court", "prime minister", "new york", "world cup", "world series",
  "united states", "united nations", "european union", "federal reserve",
  "silicon valley", "middle east", "stock market", "interest rates",
  "climate change", "champions league", "premier league", "super bowl",
  "big tech", "hong kong", "los angeles", "san francisco", "north korea",
  "south korea", "south africa", "saudi arabia", "artificial intelligence",
];
const EVENT_PHRASE_RE = new RegExp("\\b(" + EVENT_PHRASES.join("|") + ")\\b", "g");

// Capitalised, and so mistaken for names, but they name nothing in particular.
const EVENT_GENERIC = new Set(["ipo", "ceo", "cfo", "cto", "gdp", "etf", "nyse", "live", "watch", "opinio", "analys", "game", "review"]);
const EVENT_STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "after",
  "about", "amid", "says", "said", "will", "what", "when", "where", "which",
  "their", "they", "have", "more", "than", "just", "your", "you", "how", "why",
  "who", "new", "year", "years", "day", "days", "week", "today", "first",
  "last", "could", "would", "should", "been", "were", "was", "are", "has",
  "had", "its", "not", "but", "all", "out", "off", "one", "two", "three",
  "can", "may", "now", "get", "got", "make", "makes", "back", "also", "here",
  "there", "news", "update", "video", "report", "she",
  "his", "her", "him", "our", "big", "top", "still", "next", "month", "again",
  "agains", "betwee", "under", "while", "being", "other", "strong", "major",
  "former", "leader", "presid", "govern", "offici", "deal", "plan", "plans",
  "call", "calls", "face", "faces", "take", "takes", "help", "set", "need",
  "want", "show", "shows", "know", "look", "high", "long", "time", "way",
  "people", "world", "countr", "state", "states", "nation", "public", "politi",
  "party", "partie", "vote", "voters", "win", "wins", "lose", "loses", "says",
  "warn", "warns", "push", "pushes", "move", "moves", "amid", "despit",
]);
const EVENT_CALENDAR = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|januar|februa|august|septem|octobe|novemb|decemb|monday|tuesda|wednes|thursd|friday|saturd|sunday|\d+)$/;

// Six letters is enough to make "Israel" and "Israeli", "Brazil" and
// "Brazilian", "election" and "elections" the same word, which is most of
// what matters when one desk writes about a country and another about its
// voters.
function eventStem(word) {
  return word
    .toLowerCase()
    .replace(/['’]s$/, "")
    .normalize("NFD")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6);
}

function eventTokens(title) {
  const merged = title.toLowerCase().replace(EVENT_PHRASE_RE, (phrase) => phrase.replace(/\s+/g, ""));
  const tokens = merged
    .split(/[\s\-–—:,;|]+/)
    .map(eventStem)
    .filter((stem) => stem.length >= 3 && !EVENT_STOP.has(stem) && !EVENT_CALENDAR.test(stem));
  return [...new Set(tokens)];
}

const PHRASE_STEMS = new Set(EVENT_PHRASES.map((phrase) => eventStem(phrase.replace(/\s+/g, ""))));

// Which words are names, learned from the batch itself: a word written with a
// capital in the middle of a sentence-case headline is a name. Headlines in
// Title Case say nothing either way, so they are left out of the count.
function namesIn(titles) {
  const capital = new Map();
  const lower = new Map();
  for (const title of titles) {
    const words = title.split(/\s+/);
    const long = words.filter((word) => /^[A-Za-z]/.test(word) && word.length > 3);
    const capitals = long.filter((word) => /^[A-Z]/.test(word)).length;
    if (capitals / Math.max(1, long.length) > 0.7) continue;     // Title Case
    words.forEach((word, index) => {
      if (index === 0) return;                                  // sentence start
      const stem = eventStem(word);
      if (stem.length < 3) return;
      const tally = /^[^A-Za-z]*[A-Z]/.test(word) ? capital : lower;
      tally.set(stem, (tally.get(stem) || 0) + 1);
    });
  }
  const names = new Set(PHRASE_STEMS);
  capital.forEach((count, stem) => {
    if (count > (lower.get(stem) || 0) && !EVENT_GENERIC.has(stem)) names.add(stem);
  });
  return names;
}

// Measured in units of a word seen once in the batch, as for stories, so the
// bar holds whether you follow three topics or fifteen.
const EVENT_RARITY = 0.98;
const EVENT_WINDOW_H = 48;
// Rarity alone can't separate an event from a beat. "Democrats" and
// "Republicans" are each uncommon enough, and share a headline most days; so
// do "OpenAI" and "GPT". What sets an event apart is either a genuinely rare
// word in common ("Bolsonaro", "Fleetwood", "Comey") or a pairing that keeps
// recurring today: measured live, Israel+election shared 29 headlines and
// Anthropic+IPO 24, while Democrats+Republicans shared 4. A word is rare here
// if it's in fewer than the cube root of the batch; a pairing is surging at 6.
const EVENT_SURGE = 6;
// How much it matters that many outlets are on one event: nothing for two,
// then a little more for every doubling. Logarithmic because the twelfth
// outlet covering an IPO says much less than the third did.
const HEAT_GAIN = 3;
const HEAT_FROM = 3;
// Other angles shown beneath the lead of a big event.
const RELATED_MAX = 2;

// A story is developing while desks are still piling onto it: enough outlets
// to be an event at all, and most of them filing within the last few hours.
// Stateless on purpose — it works from the publication times in the feeds, so
// it is right on the first refresh after a week away, which a before-and-after
// comparison against a stored count would not be.
const DEVELOPING_WINDOW_H = 3;
const DEVELOPING_MIN_OUTLETS = 5;
const DEVELOPING_MIN_RECENT = 4;

function outletsOf(story) {
  return story.coverage ? story.coverage.map((entry) => entry.source) : [story.source];
}

function withEvents(stories) {
  const names = namesIn(stories.map((story) => story.title));
  const tokens = stories.map((story) => eventTokens(story.title));
  const docFreq = new Map();
  tokens.forEach((list) => list.forEach((token) => docFreq.set(token, (docFreq.get(token) || 0) + 1)));
  const total = Math.max(2, stories.length);
  const rarity = (token) => Math.log(total / docFreq.get(token));
  const bar = EVENT_RARITY * Math.log(total);
  const distinctive = Math.cbrt(total);
  const carriers = new Map();
  tokens.forEach((list, index) => list.forEach((token) => {
    if (!carriers.has(token)) carriers.set(token, []);
    carriers.get(token).push(index);
  }));
  const together = (shared) => {
    const [first, ...rest] = shared.map((token) => carriers.get(token)).sort((a, b) => a.length - b.length);
    return first.filter((index) => rest.every((list) => list.includes(index))).length;
  };

  const eventOf = new Array(stories.length).fill(-1);
  const events = [];

  stories.forEach((seed, i) => {
    if (eventOf[i] >= 0) return;
    const id = events.length;
    const core = new Set(tokens[i]);
    const members = [i];
    eventOf[i] = id;

    for (let j = i + 1; j < stories.length; j += 1) {
      if (eventOf[j] >= 0) continue;
      const shared = tokens[j].filter((token) => core.has(token));
      if (shared.length < 2 || !shared.some((token) => names.has(token))) continue;
      // Either path is enough. A surging pairing is common by definition, so
      // holding it to the rarity bar as well would reject exactly the biggest
      // events — measured on a three-topic batch, Anthropic+IPO shared eleven
      // headlines and still fell short of it.
      const rare =
        shared.some((token) => docFreq.get(token) <= distinctive) &&
        shared.reduce((sum, token) => sum + rarity(token), 0) >= bar;
      if (!rare && together(shared) < EVENT_SURGE) continue;
      if (hoursApart(stories[j].publishedAt, seed.publishedAt) > EVENT_WINDOW_H) continue;
      eventOf[j] = id;
      members.push(j);
    }
    events.push(members);
  });

  const outlets = events.map((members) =>
    new Set(members.flatMap((index) => outletsOf(stories[index]))).size);
  // Outlets with something on the event inside the window, across all of it.
  const recent = events.map((members) =>
    new Set(members.flatMap((index) => stories[index].filedRecent || [])).size);

  // How much of the event was filed under each topic, for Trending's tags.
  const reach = events.map((members) => {
    const counts = {};
    for (const index of members) {
      for (const id of stories[index].topics || []) counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  });

  return stories.map((story, index) => {
    const id = eventOf[index];
    const size = outlets[id];
    const heat = size >= HEAT_FROM ? HEAT_GAIN * Math.log2(size / 2) : 0;

    // Other angles on the same event, each from a different outlet than the
    // lead and than each other — the point is breadth, not three takes from
    // one newsroom.
    const related = [];
    if (size >= HEAT_FROM) {
      const used = new Set(outletsOf(story));
      for (const other of events[id]) {
        if (related.length >= RELATED_MAX) break;
        const candidate = stories[other];
        if (other === index || candidate.lowValue || used.has(candidate.source)) continue;
        used.add(candidate.source);
        related.push({
          title: candidate.title,
          source: candidate.source,
          url: candidate.url,
          ...(candidate.paywall ? { paywall: true } : {}),
        });
      }
    }

    return {
      ...story,
      score: story.score + heat,
      event: id,
      eventOutlets: size,
      eventRecent: recent[id],
      ...(size >= DEVELOPING_MIN_OUTLETS && recent[id] >= DEVELOPING_MIN_RECENT
        ? { developing: true } : {}),
      eventTopics: reach[id],
      ...(related.length ? { related } : {}),
    };
  });
}

// One story per event in any list a reader sees. The best-ranked story stands
// for its event; the rest are reachable beneath it, not stacked beside it.
function onePerEvent(stories) {
  const seen = new Set();
  return stories.filter((story) => {
    if (story.event === undefined) return true;
    if (seen.has(story.event)) return false;
    seen.add(story.event);
    return true;
  });
}

// Where a topic sits on your dashboard is a statement about how much you care
// about it, so Trending reads it that way. The weight is a multiplier rather
// than a flat penalty, which is the behaviour worth having: a genuinely big
// story in your last topic still makes it, while a routine one — a contract
// extension, a player ejected for spitting — no longer takes a slot from the
// topics you put first.
// Measured as a fraction of the way down your list rather than a fixed step
// per place, so it reads the same whether you follow three topics or fifteen:
// your first topic counts for its full weight, your last for a little over
// half, everything else in between.
const TOPIC_SPREAD = 0.6;

// The topic a story counts as, for Trending's purposes: the highest one it
// belongs to on your dashboard. A story that is both AI news and sports news
// is judged as AI news if that's what you ranked higher.
function leadTopic(item, order) {
  let best = -1;
  for (const id of new Set(item.topics || [])) {
    const index = order.indexOf(id);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

// home: the tab the story's event lives in, when known. It decides, rather
// than the highest topic the story touches — Al Jazeera files a Barcelona fine
// in its world feed, and that was enough to give a sports story World's weight.
function topicWeight(item, order, home) {
  if (order.length < 2) return 1;
  const index = home !== undefined && home !== null ? order.indexOf(home) : leadTopic(item, order);
  const rank = index < 0 ? order.length - 1 : index;
  return 1 - TOPIC_SPREAD * (rank / (order.length - 1));
}

// The best of everything you follow, in one place. A story earns a place by
// being covered independently by more than one outlet — that is what makes it
// trending rather than merely recent, and it is the clearest evidence
// available that something actually matters.
// A topic shows as a tag on Trending if it carries at least this share of the
// event's coverage. Measured live, Anthropic's IPO had been filed under five
// topics — one stray Al Jazeera piece made it "World" — and five tags is a
// list, not a label.
const TAG_SHARE = 0.25;
const MAX_TAGS = 2;

// Tags for one story: the tab it lives in first, since that's where you'll
// find it, then any other topic carrying a real share of the coverage.
function tagsFor(item, order, home) {
  const counts = item.eventTopics || {};
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const tags = home ? [home] : [];
  for (const id of order) {
    if (tags.length >= MAX_TAGS) break;
    if (!tags.includes(id) && (counts[id] || 0) >= TAG_SHARE * total) tags.push(id);
  }
  return tags;
}

function buildTrending(ranked, order = [], homes = new Map()) {
  // Weighting a negative score by anything would flatter it, so only scores
  // that earned something get scaled.
  const weighted = ranked
    .filter((item) => !item.lowValue)
    .map((item) => ({
      item,
      score: item.score > 0 ? item.score * topicWeight(item, order, homes.get(item.event)) : item.score,
    }))
    .sort((a, b) => b.score - a.score);

  // Several outlets on the same event counts, even when no two of them wrote
  // the same headline — that is what most big news looks like.
  const covered = (item) => Math.max(item.corroboration, item.eventOutlets || 0) > 1;
  const corroborated = onePerEvent(
    weighted
      .filter((entry) => covered(entry.item) && entry.score >= TRENDING_FLOOR)
      .map((entry) => entry.item)
  );

  // One topic shouldn't be the whole of Trending even if it is your first:
  // the point of the tab is a look across everything you follow. Capping by
  // topic rejects candidates, so each shortlist has to be longer than the
  // number of slots or the tab comes up short for the wrong reason.
  // Counted by the tab a story lives in, not the highest topic it touches:
  // World's feeds — a newspaper's front page among them — carry a little of
  // everything, so by that measure nearly every big story was "World" and the
  // cap left Trending three stories long.
  const shortlist = TRENDING_SIZE * 4;
  const cap = Math.max(TRENDING_SIZE / 2, Math.ceil(TRENDING_SIZE / Math.max(1, order.length)));
  const tabOf = (item) => homes.get(item.event) ?? leadTopic(item, order);

  const seen = new Set();
  const perTopic = new Map();
  const out = [];

  function fill(pool, limit) {
    for (const item of interleaveBySource(pool, shortlist)) {
      if (out.length >= limit) return;
      if (seen.has(item.url) || seen.has("event:" + item.event)) continue;
      const topic = tabOf(item);
      if ((perTopic.get(topic) || 0) >= cap) continue;
      seen.add(item.url);
      seen.add("event:" + item.event);
      perTopic.set(topic, (perTopic.get(topic) || 0) + 1);
      out.push(item);
    }
  }

  // No topping up from single-outlet stories: on a thin day Trending runs
  // short, or empty, rather than calling something trending that isn't.
  fill(corroborated, TRENDING_SIZE);

  // Which of your topics each story is under, in your own order, so a mixed
  // tab says where everything came from. The bookkeeping fields go no further.
  return out.map(({ topics, eventTopics, ...item }) => ({
    ...item,
    tags: tagsFor({ eventTopics }, order, homes.get(item.event)),
  }));
}

// ---------- fetching ----------

// Validators and parsed items from the last fetch of each feed, so an
// unchanged feed costs one 304 and no parsing.
// How long to leave a repeatedly failing feed alone: an hour after the third
// failure, doubling to a day. Long enough to stop hammering a host that is
// down, short enough that a feed fixed this morning is back by lunchtime.
function backoffFor(record) {
  if (!record || (record.fails || 0) < FEED_FAIL_GRACE) return 0;
  const steps = record.fails - FEED_FAIL_GRACE;
  return Math.min(FEED_BACKOFF_MAX_MS, FEED_BACKOFF_BASE_MS * 2 ** steps);
}

function restingUntil(record) {
  return (record?.lastFail || 0) + backoffFor(record);
}

function recordHealth(health, feed, result) {
  const now = Date.now();
  const previous = health[feed.url] || {};

  if (result.ok) {
    health[feed.url] = { name: feed.name, fails: 0, lastOk: now };
    return;
  }

  health[feed.url] = {
    name: feed.name,
    fails: (previous.fails || 0) + 1,
    lastOk: previous.lastOk || null,
    lastFail: now,
    // When it first broke, so settings can say how long it's been gone.
    since: previous.since || now,
    error: result.error || "unknown",
  };
}

async function readFeedHealth() {
  const { feed_health: health } = await chrome.storage.local.get({ feed_health: {} });

  // Drop records for feeds that no longer exist, so unfollowing a topic or
  // replacing a dead source doesn't leave a ghost in settings forever.
  const known = new Set();
  for (const topic of NEWSLETTER_TOPICS) {
    for (const feed of topic.feeds) known.add(feed.url);
  }
  for (const url of Object.keys(health)) {
    if (!known.has(url)) delete health[url];
  }
  return health;
}

// Asking again right now, on purpose: clears the backoff so a source the
// person can see is broken gets one more try without waiting out the rest.
async function recheckFeeds() {
  const health = await readFeedHealth();
  for (const record of Object.values(health)) {
    if (record.fails) record.lastFail = 0;
  }
  await chrome.storage.local.set({ feed_health: health });
  return refresh();
}

async function readFeedCache() {
  const { feed_cache: cache } = await chrome.storage.local.get({ feed_cache: {} });
  return cache;
}

async function fetchFeed(feed, cache) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const previous = cache[feed.url];

  const headers = {};
  if (previous?.etag) headers["If-None-Match"] = previous.etag;
  if (previous?.lastModified) headers["If-Modified-Since"] = previous.lastModified;

  try {
    const response = await fetch(feed.url, { signal: controller.signal, headers });

    // Nothing new since last time — the publisher sent no body at all.
    if (response.status === 304 && previous?.items) {
      return { ok: true, items: previous.items, entry: previous, changed: false };
    }

    if (!response.ok) throw new Error("HTTP " + response.status);

    const items = parseFeed(await response.text(), feed.name);

    // A success code carrying nothing is a failure wearing a disguise: ESPN
    // answers 202 with an empty body, which passes every ok check and then
    // parses to zero items. Treated as success it would overwrite a good
    // cache with nothing, so the feed loses even its fallback.
    if (!items.length) throw new Error("no items (HTTP " + response.status + ")");

    // Carried through to the UI so a reader knows before clicking, not after.
    if (feed.paywall) items.forEach((item) => { item.paywall = true; });
    return {
      ok: true,
      items,
      entry: {
        etag: response.headers.get("ETag") || null,
        lastModified: response.headers.get("Last-Modified") || null,
        items: items.slice(0, CACHE_PER_FEED),
      },
      changed: true,
    };
  } catch (error) {
    // One dead feed shouldn't empty a topic. Fall back to whatever we had,
    // and keep the old cache entry rather than replacing it with nothing.
    console.warn("[Drift] feed failed:", feed.url, error.message);
    return {
      ok: false,
      error: error.message,
      items: previous?.items || [],
      entry: previous,
      changed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Raw items for one topic, tagged so clustering can run across all of them.
async function fetchTopicItems(topic, feeds, cache, nextCache, skipNetwork, health) {
  const now = Date.now();
  const fromCache = (feed) => ({
    items: cache[feed.url]?.items || [],
    entry: cache[feed.url],
    changed: false,
  });

  // Clustering runs across every topic, so a single-topic refresh still needs
  // the others' items — it just takes them from cache instead of the network.
  const results = skipNetwork
    ? feeds.map(fromCache)
    : await Promise.all(feeds.map((feed) => {
        // A feed that has failed repeatedly is resting, not abandoned.
        if (health && now < restingUntil(health[feed.url])) return fromCache(feed);
        return fetchFeed(feed, cache).then((result) => {
          if (health) recordHealth(health, feed, result);
          return result;
        });
      }));

  feeds.forEach((feed, index) => {
    if (results[index].entry) nextCache[feed.url] = results[index].entry;
  });

  const seen = new Set();

  return results.flatMap((result) => result.items).filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    item.topicId = topic.id;
    return ageHours(item.publishedAt) <= MAX_AGE_HOURS;
  });
}

// Clustering runs across every followed topic at once, so a story that is both
// AI news and startup news collapses into one item instead of appearing twice
// in two tabs. The cluster lands in whichever topic carried it most, with the
// user's own topic order breaking ties.
function assignToTopics(clusters, topicOrder) {
  const byTopic = {};
  topicOrder.forEach((id) => {
    byTopic[id] = [];
  });

  for (const cluster of clusters) {
    const counts = new Map();
    for (const id of cluster.topics) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    let best = null;
    let bestCount = -1;
    for (const id of topicOrder) {
      const count = counts.get(id) || 0;
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    }

    if (best && byTopic[best]) byTopic[best].push(cluster);
  }

  return byTopic;
}

// An event belongs to one tab. Measured live, Bolsonaro's flight from Brazil
// led World, Politics and Finance at once — three of nine slots on a single
// event, for a reader who opens all three tabs. It lives where most of its
// coverage was filed, your own topic order breaking ties; the other angles
// still show beneath it.
function eventHomes(grouped, order) {
  const tally = new Map();
  order.forEach((id) => {
    for (const story of grouped[id] || []) {
      if (!tally.has(story.event)) tally.set(story.event, new Map());
      const counts = tally.get(story.event);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  });

  const home = new Map();
  tally.forEach((counts, event) => {
    let best = null;
    for (const id of order) {
      if ((counts.get(id) || 0) > (counts.get(best) || 0)) best = id;
    }
    home.set(event, best);
  });
  return home;
}

function homeEvents(grouped, order, home = eventHomes(grouped, order)) {
  const out = {};
  order.forEach((id) => {
    out[id] = (grouped[id] || []).filter((story) => home.get(story.event) === id);
  });
  return out;
}

async function afterRefresh(ranked, only) {
  try {
    await queued(async () => {
      const { followed } = await chrome.storage.local.get({ followed: [] });
      await chrome.storage.local.set({ followed: growFollowed(ranked, followed) });
    });
    // A refresh for one topic reuses cached feeds for the rest, so it is
    // not a fresh look at the news; leave alerts to full ones.
    if (!only) await maybeAlert(ranked);
  } catch (error) {
    console.warn("[Drift] post-refresh bookkeeping failed:", error?.message);
  }
}

async function topicStamps() {
  const { topic_fetched_at: stamps } = await chrome.storage.local.get({ topic_fetched_at: {} });
  return stamps;
}

// Concurrent callers share one fetch rather than each starting their own.
// Keyed so a single-topic refresh doesn't get handed a full refresh's promise.
const inFlight = new Map();

function refresh(only, fromCache) {
  const key = (fromCache ? "cache:" : "") + (only || "*");
  if (!inFlight.has(key)) {
    inFlight.set(key, doRefresh(only, fromCache).finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

// Re-rank what's already been fetched. Dragging a topic to a new place on the
// dashboard changes what Trending thinks is important, which is a question
// about ranking, not about the network — the feeds have nothing new to say.
function rerank() {
  return refresh(undefined, true);
}

// Called when a surface opens or switches tabs: refetches just that topic if
// its own feeds have gone stale.
async function refreshTopicIfStale(topicId) {
  if (!topicId || !getTopic(topicId)) return null;

  const stamps = await topicStamps();
  const { fetched_at: wholeCache } = await chrome.storage.local.get({ fetched_at: 0 });
  const last = Math.max(stamps[topicId] || 0, wholeCache);

  if (Date.now() - last < TOPIC_STALE_AFTER_MS) return null;
  return refresh(topicId);
}

// Refresh only if the cache has gone stale — this is what the panel calls
// each time it opens.
async function refreshIfStale() {
  const { fetched_at: fetchedAt, articles } = await chrome.storage.local.get({
    fetched_at: 0,
    articles: {},
  });

  const isEmpty = Object.keys(articles).length === 0;
  if (isEmpty || Date.now() - fetchedAt > STALE_AFTER_MS) return refresh();
  return articles;
}

async function doRefresh(only, fromCache) {
  const { selected_topics: selected } = await chrome.storage.sync.get({
    selected_topics: DEFAULT_TOPIC_IDS,
  });

  const all = selected.map(getTopic).filter(Boolean);

  // Permission is checked per feed, never per topic. chrome.permissions
  // .contains() is all-or-nothing, so checking a whole topic at once meant
  // adding one new source to an existing topic blacked out that entire topic
  // until the new origin was granted. A topic now uses whichever of its feeds
  // it can reach, and only goes quiet if it can reach none of them.
  const reachable = await Promise.all(
    all.map(async (topic) => {
      const checks = await Promise.all(
        topic.feeds.map((feed) => {
          const origin = originOfFeed(feed.url);
          return origin ? hasOrigins([origin]) : Promise.resolve(false);
        })
      );
      return topic.feeds.filter((_, index) => checks[index]);
    })
  );

  const topics = all.filter((_, index) => reachable[index].length > 0);
  const topicFeeds = reachable.filter((feeds) => feeds.length > 0);

  const cache = await readFeedCache();
  const health = await readFeedHealth();
  const nextCache = {};
  const fetched = await Promise.all(
    topics.map((topic, index) =>
      fetchTopicItems(topic, topicFeeds[index], cache, nextCache,
                      fromCache || (Boolean(only) && topic.id !== only), health)
    )
  );

  const order = topics.map((topic) => topic.id);

  // Stories you opened that have since moved on come back as updates, in place
  // of the story you read; see worker/engagement.js.
  const memory = await chrome.storage.local.get({ followed: [], opened_urls: {}, reading_stats: { sources: {} } });
  const learning = await learningOn();
  const affinity = learning ? sourceAffinity(memory.reading_stats) : {};
  const ranked = rank(fetched.flat());
  const rankedAll = applyUpdates(ranked, findUpdates(ranked, memory.followed, memory.opened_urls));
  const assigned = assignToTopics(rankedAll, order);
  const homes = eventHomes(assigned, order);
  const grouped = homeEvents(assigned, order, homes);

  // Keep empty topics in the map — "quiet today" is a real answer, and
  // dropping the key would make the panel think the fetch failed.
  // A pool rather than exactly three: the surfaces trim it against what
  // you've already seen.
  const articles = {};
  selected.forEach((id) => {
    articles[id] = [];
  });
  articles[TRENDING_ID] = buildTrending(rankedAll, order, homes);
  order.forEach((id) => {
    // The bar applies to the score as ranked; what you tend to read only
    // reorders what already cleared it.
    const good = orderByAffinity(
      onePerEvent(grouped[id] || []).filter((story) => story.score >= STORY_FLOOR),
      affinity
    );
    articles[id] = interleaveBySource(good, POOL_PER_TOPIC)
      // `topics` carries one entry per source article so assignment can count
      // them; it has done its job by now and shouldn't bloat the cache.
      .map(({ topics, eventTopics, ...article }) => article);
  });

  const stamp = { articles, feed_cache: nextCache, feed_health: health };
  // Re-ranking fetched nothing, so it can't make the cache any fresher.
  if (fromCache) delete stamp.fetched_at;
  else if (!only) stamp.fetched_at = Date.now();
  else stamp.topic_fetched_at = { ...(await topicStamps()), [only]: Date.now() };

  await chrome.storage.local.set(stamp);
  await updateBadge(articles);

  // Only a refresh that went to the network has anything new to remember or
  // announce; re-ranking from cache would alert about the same hour twice.
  if (!fromCache) await afterRefresh(ranked, only);
  return articles;
}

// ---------- host access ----------

async function hasOrigins(origins) {
  if (!origins.length) return true;
  try {
    return await chrome.permissions.contains({ origins });
  } catch (error) {
    return false;
  }
}

// The floating bubble needs to run on every page, which is a big ask. It is
// registered only once the user has actually turned it on and granted access,
// so a toolbar-only install never requests page access at all.
async function syncBubbleScript() {
  const [{ display_mode: mode }, allowed] = await Promise.all([
    chrome.storage.sync.get({ display_mode: DEFAULT_DISPLAY_MODE }),
    hasOrigins(["<all_urls>"]),
  ]);

  let registered = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts({
      ids: [BUBBLE_SCRIPT_ID],
    });
  } catch (error) {
    registered = [];
  }

  const wanted = mode === "bubble" && allowed;

  if (wanted && registered.length > 0 && registered[0].js?.join() !== BUBBLE_FILES.join()) {
    // A registration outlives an update. One made by an older version names
    // the files that version shipped, and the bubble would load without the
    // ones added since.
    await chrome.scripting.updateContentScripts([{ id: BUBBLE_SCRIPT_ID, js: BUBBLE_FILES }]);
  } else if (wanted && registered.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: BUBBLE_SCRIPT_ID,
      matches: ["<all_urls>"],
      js: BUBBLE_FILES,
      runAt: "document_idle",
      allFrames: false,
      persistAcrossSessions: true,
    }]);
  } else if (!wanted && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [BUBBLE_SCRIPT_ID] });
  }
}

// ---------- reading history ----------
//
// Kept locally and never sent anywhere. Pruned so it can't grow without bound.

const HISTORY_LIMIT = 500;
const HISTORY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function prune(record) {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  const entries = Object.entries(record)
    .filter(([, value]) => (value?.t ?? value) > cutoff)
    .sort((a, b) => (b[1]?.t ?? b[1]) - (a[1]?.t ?? a[1]))
    .slice(0, HISTORY_LIMIT);
  return Object.fromEntries(entries);
}

async function markSeen(urls) {
  if (!urls?.length) return;
  const { seen_urls: seen } = await chrome.storage.local.get({ seen_urls: {} });
  const now = Date.now();

  // First sightings only: the same story on screen all afternoon is one story
  // shown, not thirty.
  const firstSight = urls.filter((url) => !seen[url]);

  for (const url of urls) {
    const previous = seen[url];
    seen[url] = { n: (previous?.n || 0) + 1, t: now };
  }

  await chrome.storage.local.set({ seen_urls: prune(seen) });
  await updateBadge();
  if (firstSight.length) {
    await bumpMetrics({ shown: firstSight.length });
    await learnShown(firstSight);
  }
}

async function markOpened(url, meta) {
  if (!url) return;
  const { opened_urls: opened } = await chrome.storage.local.get({ opened_urls: {} });
  opened[url] = { t: Date.now() };
  await chrome.storage.local.set({ opened_urls: prune(opened) });
  await updateBadge();
  await recordClick(url, meta);
  await learnOpened(url);
  await followOpened(url);
}

// ---------- what's actually worth your attention ----------
//
// "Fresh" alone isn't enough: a story you already opened isn't news to you.
// This counts topics holding something both recent and unread, and is the
// basis for both the toolbar badge and whether the daily check-in fires.

async function unreadTopicCount(articles) {
  const [{ selected_topics: selected }, local] = await Promise.all([
    chrome.storage.sync.get({ selected_topics: DEFAULT_TOPIC_IDS }),
    chrome.storage.local.get({ opened_urls: {}, seen_urls: {} }),
  ]);

  const history = { opened: local.opened_urls, seen: local.seen_urls };

  let count = 0;
  for (const id of selected) {
    const picked = pickStories(articles[id], history, STORIES_PER_TAB);
    if (picked.some((article) => article.fresh)) count += 1;
  }
  return count;
}

async function updateBadge(articles) {
  const source = articles || (await chrome.storage.local.get({ articles: {} })).articles;
  const count = await unreadTopicCount(source);

  try {
    await chrome.action.setBadgeText({ text: count ? String(count) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#C7A97B" });
    await chrome.action.setBadgeTextColor({ color: "#2A2418" });
  } catch (error) {
    // badge APIs are best-effort; never let them break a refresh
  }
}

// ---------- the once-a-day check-in ----------
//
// "When they open their laptop" isn't something Chrome can observe: most
// people never quit the browser, so runtime.onStartup never fires for them.
// So this is measured as the first browser activity on a new calendar date,
// watched from several angles — startup, window focus, tab switches, alarms.

let checkedDate = null; // in-memory fast path; tab switches are frequent
let dailyCheck = null;  // in-flight guard; triggers can fire simultaneously

async function openDigest() {
  // Marks the next surface open as unprompted, so it knows to be gentler.
  // The surface clears it, so a deliberate open a minute later is unfiltered.
  await chrome.storage.local.set({ unprompted_open: Date.now() });

  // openPopup() needs a focused window and can be refused; the tab always works.
  let failure = null;
  try {
    await chrome.action.openPopup();
    await recordAutoOpen("popup");
    return "popup";
  } catch (error) {
    failure = error?.message || String(error);
    console.warn("[Drift] openPopup unavailable:", failure);
  }

  await chrome.tabs.create({
    url: chrome.runtime.getURL("daily/daily.html"),
    active: true,
  });
  await recordAutoOpen("tab", failure);
  return "tab";
}

// Focus and tab-activation can fire in the same tick at startup. Without this,
// each one reads "not shown yet" before any of them writes, and you get three
// popups. Concurrent callers share the one check.
function maybeShowDaily() {
  if (!dailyCheck) {
    dailyCheck = runDailyCheck().finally(() => {
      dailyCheck = null;
    });
  }
  return dailyCheck;
}

async function runDailyCheck() {
  const { daily_open: enabled, day_starts_at: startHour } = await chrome.storage.sync.get({
    daily_open: true,
    day_starts_at: DAY_STARTS_AT_HOUR,
  });
  if (!enabled) return;

  // Don't greet someone who is up late. This guard is needed on its own: if
  // yesterday stayed quiet and news lands at 02:00, the shifted date alone
  // would still let the digest fire in the middle of the night.
  if (tooEarlyToOpen(startHour)) return;

  const today = todayKey(null, startHour);
  if (checkedDate === today) return;   // only set once we've actually opened

  const stored = await chrome.storage.local.get({ [DAILY_KEY]: null });
  if (stored[DAILY_KEY] === today) {
    checkedDate = today;
    return;
  }

  // Don't re-evaluate on every tab switch for the rest of a quiet day.
  const { daily_quiet_until: quietUntil } = await chrome.storage.local.get({
    daily_quiet_until: 0,
  });
  if (Date.now() < quietUntil) return;

  const articles = await refreshIfStale();
  const worthIt = await unreadTopicCount(articles);

  // Nothing recent and unread. Interrupting someone to show them what they
  // already read is how this feature gets switched off, so stay quiet — and
  // deliberately don't claim the day, so it can still fire when news lands.
  if (worthIt === 0) {
    await chrome.storage.local.set({ daily_quiet_until: Date.now() + 30 * 60 * 1000 });
    console.log("[Drift] daily check-in skipped — nothing new worth opening for");
    return;
  }

  // Claim today before doing anything slow, so two triggers firing at once
  // can't both decide they're first.
  await chrome.storage.local.set({ [DAILY_KEY]: today, daily_quiet_until: 0 });
  checkedDate = today;

  const how = await openDigest();
  console.log(`[Drift] daily check-in shown via ${how} (${worthIt} topics with news)`);
}

// ---------- schedule ----------

function scheduleRefresh() {
  chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MINUTES });
}

chrome.runtime.onInstalled.addListener((details) => {
  scheduleRefresh();
  refresh();
  syncBubbleScript();
  // Nothing has been granted yet on a fresh install, so send people somewhere
  // that explains the product and asks for what it needs.
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRefresh();
  refresh();
  maybeShowDaily();
  syncBubbleScript();
});

// A focused window or a tab switch means someone is actually at the keyboard —
// which is the moment a popup can anchor to something and be seen.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) maybeShowDaily();
});

chrome.tabs.onActivated.addListener(() => {
  maybeShowDaily();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    refresh();
    maybeShowDaily(); // catches a browser left open across midnight
  }
});

// Following a new topic should fill it in right away, not at the next alarm.
// Merely reordering the ones you already follow shouldn't cost 35 requests,
// though — that's a drag of the tab strip, and it only changes the ranking.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;

  if (changes.selected_topics) {
    const before = changes.selected_topics.oldValue || [];
    const after = changes.selected_topics.newValue || [];
    const sameSet =
      before.length === after.length && after.every((id) => before.includes(id));
    if (sameSet) rerank();
    else refresh();
  }

  if (changes.display_mode) syncBubbleScript();
});

// Granting or revoking host access changes what we can fetch and whether the
// bubble may run, so react to both.
chrome.permissions.onAdded.addListener(() => {
  syncBubbleScript();
  bindNotificationClicks();
  refresh();
});

bindNotificationClicks();
chrome.permissions.onRemoved.addListener(() => {
  syncBubbleScript();
  refresh();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (message?.type === "REFRESH") {
    refresh().then((articles) => sendResponse({ articles }));
    return true; // keep the channel open for the async reply
  }

  if (message?.type === "MARK_SEEN") {
    markSeen(message.urls);
    return false;
  }

  if (message?.type === "MARK_OPENED") {
    markOpened(message.url, message.meta);
    return false;
  }

  if (message?.type === "METRIC" && message.kind === "open") {
    recordOpen(sender, Boolean(message.unprompted));
    return false;
  }

  if (message?.type === "REFRESH_TOPIC") {
    refreshTopicIfStale(message.topicId).then((articles) => sendResponse({ articles }));
    return true;
  }

  if (message?.type === "RECHECK_FEEDS") {
    recheckFeeds().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "REFRESH_IF_STALE") {
    refreshIfStale().then((articles) => sendResponse({ articles }));
    return true;
  }

  return false;
});
