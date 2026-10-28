// One story card, built the same way on every surface: the popup, the daily
// page, and the floating bubble. Plain globals, like shared/data.js.
//
// Pictures are the surface's choice, not the card's. The popup and the daily
// page are the extension's own pages, so a picture loads there and nowhere
// else. The bubble lives inside other people's websites, and a page can list
// every image loaded into it — a picture there would tell each site you visit
// what you read. So the bubble never asks for one.

function storySeparator() {
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

function markOpenedOnClick(link, url) {
  link.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "MARK_OPENED", url });
  });
}

function sourceMark(sourceName, className) {
  const mark = document.createElement("img");
  if (className) mark.className = className;
  mark.src = sourceIconUrl(sourceName);
  mark.alt = "";
  // A missing logo shouldn't leave a broken-image gap in the row.
  mark.addEventListener("error", () => mark.remove());
  return mark;
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
    markOpenedOnClick(chip, other.url);

    const name = document.createElement("span");
    name.textContent = other.source;

    chip.append(sourceMark(other.source), name);
    if (other.paywall) chip.appendChild(paywallTag());
    row.appendChild(chip);
  }

  return row;
}

// The same event as other desks told it. A big story is rarely best read in
// one headline — "No clear winner in Israel's election" says what happened;
// "Arab parties on track to win record seats" says why it matters.
function relatedRow(related) {
  const list = document.createElement("div");
  list.className = "story-related";

  for (const angle of related) {
    const link = document.createElement("a");
    link.className = "related-angle";
    link.href = angle.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = angle.source + ": " + angle.title;
    markOpenedOnClick(link, angle.url);

    const title = document.createElement("span");
    title.className = "related-title";
    title.textContent = angle.title;

    link.append(sourceMark(angle.source, "related-mark"), title);
    list.appendChild(link);
  }

  return list;
}

// A picture that fails — a moved file, a blocked host — takes its frame with
// it, so the card falls back to the plain layout rather than an empty box.
// onFail lets the cover layout take back the headline it had set on the photo.
function storyPicture(url, story, onFail) {
  const frame = document.createElement("div");
  frame.className = "story-image";

  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  // Publishers learn nothing from a referrer about where the reader came from.
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => {
    if (onFail) onFail();
    frame.remove();
    story.classList.remove("has-image", "is-cover");
  });
  img.addEventListener("load", () => frame.classList.add("is-loaded"));
  img.src = url;

  frame.appendChild(img);
  return frame;
}

// How many outlets are on this event. Shown from three: two is a pair of
// desks agreeing, three is a story the day is about.
const COVERAGE_BADGE_FROM = 3;

// lead controls size only. The "new" marker comes from the article's own
// freshness, so a slow topic's lead never claims to be new when it isn't.
function storyKicker(tags, outlets) {
  const showReach = outlets >= COVERAGE_BADGE_FROM;
  if (!tags.length && !showReach) return null;

  const kicker = document.createElement("p");
  kicker.className = "story-kicker";

  tags.forEach((label, index) => {
    if (index) kicker.appendChild(document.createTextNode(" · "));
    const tag = document.createElement("span");
    tag.className = "kicker-topic";
    tag.textContent = label;
    kicker.appendChild(tag);
  });

  if (showReach) {
    const reach = document.createElement("span");
    reach.className = "kicker-reach";
    reach.textContent = (tags.length ? " · " : "") + outlets + " outlets";
    reach.title = outlets + " outlets are covering this";
    kicker.appendChild(reach);
  }
  return kicker;
}

// tags: topic names to show above the headline — given on Trending only,
// where they say something; inside a topic's own tab they'd only repeat it.
// rank: Trending's running order, shown as a numeral the way a "most read"
// list does. The lead goes unnumbered; it's already the cover.
// index: position in the list, which staggers the cards in as they arrive.
function renderStory(article, { lead = false, images = false, tags = [], rank = 0, index = 0 } = {}) {
  const story = document.createElement("a");
  story.className = lead ? "story lead" : "story";
  story.href = article.url;
  story.target = "_blank";
  story.rel = "noopener noreferrer";
  story.title = article.title;
  story.style.setProperty("--i", String(index));
  markOpenedOnClick(story, article.url);

  const text = document.createElement("div");
  text.className = "story-text";

  // Above the headline, where a front page puts its kicker: which section it
  // belongs to (on Trending, where sections mix) and how big the story is.
  // The meta row is already full on a narrow card.
  const kicker = storyKicker(tags, article.eventOutlets || 0);

  const headline = document.createElement("p");
  headline.className = "story-title";
  headline.textContent = article.title;

  // The lead with a picture is a cover: the headline set on the photo, as
  // Apple News and a magazine front do. Everything else reads beside a
  // thumbnail, the way a newspaper's inside pages do.
  const cover = lead && images && article.image;
  if (cover) {
    story.classList.add("has-image", "is-cover");
    const overlay = document.createElement("div");
    overlay.className = "cover-text";
    if (kicker) overlay.appendChild(kicker);
    overlay.appendChild(headline);
    const frame = storyPicture(article.image, story, () => text.prepend(...overlay.childNodes));
    frame.appendChild(overlay);
    story.appendChild(frame);
  } else {
    if (images && article.image) {
      story.classList.add("has-image");
      story.appendChild(storyPicture(article.image, story));
    }
    if (kicker) text.appendChild(kicker);
    text.appendChild(headline);
  }

  if (rank) {
    const numeral = document.createElement("span");
    numeral.className = "story-rank";
    numeral.textContent = String(rank);
    numeral.setAttribute("aria-hidden", "true");
    story.classList.add("is-ranked");
    story.prepend(numeral);
  }

  // Not every feed ships one — Hacker News, for instance, has nothing useful.
  if (article.summary) {
    const summary = document.createElement("p");
    summary.className = "story-lead";
    summary.textContent = article.summary;
    text.appendChild(summary);
  }

  const meta = document.createElement("p");
  meta.className = "story-meta";

  if (article.fresh) {
    const fresh = document.createElement("span");
    fresh.className = "fresh";
    fresh.textContent = "new";
    meta.append(fresh, storySeparator());
  }

  const source = document.createElement("span");
  source.textContent = article.source;
  meta.append(sourceMark(article.source, "story-favicon"), source);
  if (article.paywall) meta.appendChild(paywallTag());

  const when = document.createElement("span");
  when.textContent = timeAgo(article.publishedAt);
  meta.append(storySeparator(), when);

  text.appendChild(meta);
  story.appendChild(text);

  const others = (article.coverage || []).filter((c) => c.source !== article.source);
  // Other angles only under the lead: beneath every card they would turn a
  // three-story digest into a nine-story one.
  const angles = lead ? article.related || [] : [];
  if (!others.length && !angles.length) return story;

  // Anchors can't nest, so the extras sit beside the story card rather than
  // inside its click target.
  const wrap = document.createElement("div");
  wrap.className = "story-wrap";
  wrap.style.setProperty("--i", String(index));
  wrap.appendChild(story);
  if (angles.length) wrap.appendChild(relatedRow(angles));
  if (others.length) wrap.appendChild(coverageRow(others));
  return wrap;
}

// Trending's tags for a story: the short names of the topics it's under.
function trendingTags(article) {
  return (article.tags || []).map((id) => getTopic(id)?.short).filter(Boolean);
}
