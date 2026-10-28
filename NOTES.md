# Drift

A browser digest. The headlines worth reading in each topic you follow, one click
away on any page — no feed to scroll, no inbox to clear, no tab to keep open.

## Running it

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Click the Drift icon in the toolbar

To see the service worker's logs, click **service worker** on the extension's
card. Feed failures log there as `[Drift] feed failed: <url>`.

## How it fits together

```
shared/data.js      topics, their RSS feeds, and shared helpers (loaded by everything)
background.js       service worker: fetch → parse → rank → cache
popup/              the toolbar popup — the default surface
content/            optional floating bubble, registered at runtime if enabled
daily/              full-page digest, used for the daily check-in
options/            topic picker, display mode, daily check-in toggle
store/              privacy policy and Chrome Web Store listing copy
```

## Permissions

Nothing broad is requested at install. `storage`, `alarms` and `scripting`
produce no warning prompt. Every host sits in `optional_host_permissions`:
selecting a topic requests access to that topic's publishers, and choosing the
floating bubble requests page access and registers the content script at
runtime. A toolbar-only install never asks for page access at all.

The service worker is the only thing that touches the network. It writes a
normalized cache to `chrome.storage.local`, and every surface reads from that —
so opening the digest is instant and works offline on the last batch.

### Storage

| Key | Where | Meaning |
|---|---|---|
| `selected_topics` | sync | topic ids the user follows |
| `display_mode` | sync | `toolbar` (default) or `bubble` |
| `daily_open` | sync | whether the once-a-day check-in is on |
| `articles` | local | the cache, keyed by topic id |
| `fetched_at` | local | cache age, drives the stale check |
| `active_topic` | local | last tab viewed |
| `bubble_pos` / `bubble_docked` | local | bubble placement, per device |
| `last_daily_open` | local | date the check-in last fired |

### Refresh

A 30-minute alarm, plus a stale check whenever a surface opens (5-minute
threshold, so rapid reopening doesn't re-fetch). Concurrent callers share one
in-flight request.

### Ranking

Recency alone surfaces filler, so:

- items older than **48h** are dropped entirely. It was a week, with a growing
  drag after two days; measured on 23 topics, every one still had stories
  inside 48h, though Design (7) and Food (8) get thin
- **"new" means under 24h**, read off the article rather than its position
- the same story from two sources collapses into one, and agreement between
  independent outlets outranks raw recency
- two headlines also merge on **enough rare words in common, close enough in
  time**, not just proportional overlap — a vivid headline was being punished
  for its own colour, splitting four outlets into two pairs
- affiliate pages, puzzle answers and sportsbook promos are **dropped at parse
  time** (~2% of everything fetched); recaps, rankings and listicles are kept
  but carry a drag and are barred from Trending
- a title that is **mostly** non-Latin script is dropped — judged by majority,
  never by the presence of one character, so a quoted foreign name survives
- **editorial standing** scales both agreement and feed placement, because
  agreement alone rewards commodity news (see below)
- **no quota**: a story must score **6** to be shown. At 5 — what an
  ordinary outlet's own lead earns in its first few hours — the bottom of thin
  tabs was "Roller coaster safety is a matter of science", a fiber-supplement
  study and an advertorial; at 6 a lone story needs a reputable newsroom
  leading with it, or another outlet, a scoop, or real stakes. Busy tabs
  (World, Finance) are unaffected — they have 20+ stories above it. A tab shows up to **8**, and may show
  **none** — an honest "Quiet in X today" beats filler. A fixed three had a
  slow topic padding with "UX Disciplines: Glossary" while a busy one hid its
  fourth-best story
- headlines in all lower case (Designboom's house style) get a capital first
  letter, and nothing else
- dated live-blog prefixes are trimmed: "Stock Market News, Oct. 27, 2026:
  Tech Stocks Extend Gains" shows as "Tech Stocks Extend Gains"
- a headline that **breaks news only one desk has** ("Scoop:", "Exclusive:",
  "documents show") or reports **a large change** ("crash", "ousted",
  "historic", "trillion") gets a bonus scaled by the outlet's standing. Both
  lists are narrow and were checked by hand against a live day; "the secret to
  slower aging" is a formula, not a scoop, and doesn't match

### Events

Clustering finds the same *article* told twice. It can't see that "Rivals in
Israel Election Strike Tone of Triumph" and "Israeli turnout hits three-decade
high" are one *event*. Measured on a live day, the three biggest stories in the
world — Anthropic's IPO (20 headlines, 12 outlets), Lula's upset in Brazil, and
Israel's election (28 headlines, 12 outlets) — each reached the ranking as a
scatter of single-outlet stories, while World spent all three slots on Israel.

So stories are grouped a second time, into events:

- a story joins an event if it shares **two or more words** with the event's
  strongest story, at least one of them a **name**, within 48h. Star-shaped on
  purpose: joining the seed only, never whatever joined last, stops one
  briefing headline from chaining two events together
- **names are learned from the batch**: a word capitalised mid-sentence in
  sentence-case headlines. Title Case headlines are ignored for this
- words are cut to **six letters** so Israel/Israeli and Brazil/Brazilian match;
  fixed phrases ("Trump administration", "World Series") are kept whole
- rarity alone can't tell an event from a beat — Democrats+Republicans share
  headlines every day. A link needs **a genuinely rare word**, or a pairing that
  **keeps recurring today**: Israel+election shared 29 headlines, Anthropic+IPO
  24, Democrats+Republicans 4. The bar is 6
- **heat**: from three outlets an event earns `3 × log2(outlets / 2)`, so the
  twelfth outlet says much less than the third
- **one story per event** in any list, and **one tab per event** — the tab
  where most of its coverage was filed, your topic order breaking ties.
  Bolsonaro's flight had led World, Politics and Finance at once
- the lead shows **two other angles** from other outlets beneath it, and any
  story on a 3+ outlet event carries an "N outlets" kicker
- derivative pieces (quizzes, recaps, two-story briefings) no longer count
  toward agreement — a quiz naming the same person isn't a second desk deciding
  the story matters

### Feed health

91 feeds are 91 dependencies nobody here controls, and they rot quietly. ESPN
began answering **HTTP 202 with an empty body** and the Sports tab simply had
one fewer source for nine days, with nothing said. Worse, 202 passes every
`response.ok` check, so an empty parse was treated as success and overwrote
that feed's cache with nothing — destroying its own fallback.

- a success code carrying zero items is a **failure**, and never replaces cache
- `feed_health` in `chrome.storage.local` counts consecutive failures per feed
- after 3, the feed rests: one hour, doubling to a day. Resting, not abandoned —
  the window expires on its own, so a feed fixed this morning is back by lunch
- settings lists sources that stopped answering, how long, and why, with a
  "check again now" that clears the backoff
- records for feeds no longer in any topic are pruned

### Editorial standing

Agreement between outlets is the strongest signal available without a model,
but on its own it selects for the generic: a story five outlets ran is the one
nobody owns. Measured on a day of live feeds, the New York Times filed 22 world
stories and **none** were corroborated; its best ranked 13th of 209, below a
celebrity death two outlets happened to carry. Two outlets agreeing was worth
3.5 points and a front-page lead at most 1.5, so a marquee desk could not win.

So `SOURCE_STANDING` in `shared/data.js` gives each outlet a number — 1.6 for a
large accountable newsroom, 1.3 for a serious specialist desk, 1.0 for everyone
else. It does three things: scales what leading that outlet's feed is worth,
adds a flat bonus for the outlet's own judgement, and weights corroboration by
*who* agrees rather than how many. After it, the NYT's best story moved from
13th to 5th, and from zero slots on screen to five.

This is a judgement call and openly one. It is a claim about editing resources,
not about who is right.

### Trending

Only stories **more than one outlet covered** — the same headline, or the same
event in different words — so the tab means agreement rather than recency.
One story per event. Where a topic sits on the dashboard weights what it contributes:
the first topic counts for its full score, the last for 40% of it, measured as
a fraction of the way down the list so it reads the same whether you follow
three topics or fifteen. The weight is a multiplier, so a genuinely big story
in your last topic still makes it while a routine one no longer takes a slot
from the topics you put first. A story must score **8** after that weighting,
up to eight stories, with no topping up from single-outlet stories — a thin
day runs short, or empty.

Weighting and the per-topic cap (half the slots) both go by the **tab the
event lives in**, not the highest topic a story touches. World's feeds — a
newspaper front page among them — carry a little of everything, so by the old
measure nearly every big story was "World": the cap left Trending three
stories long, and Al Jazeera filing a Barcelona fine under World gave a sports
story World's weight. On the same day's news, Sports last now takes no
Trending slots; Sports first takes three.

Each Trending story is **tagged** with the tab it lives in, plus any other
topic carrying at least a quarter of the event's coverage — at most two.
Anthropic's IPO had been filed under five topics; five tags is a list, not a
label.

### The daily check-in

"When they open their laptop" isn't observable: most people never quit Chrome,
so `runtime.onStartup` never fires for them. It's measured instead as the first
browser activity on a new calendar date, watched from startup, window focus,
tab activation and the alarm. It tries `chrome.action.openPopup()` and falls
back to opening `daily/daily.html` in a tab.

## Parsing

MV3 service workers have no DOM, so there's no `DOMParser`. `background.js`
contains a small hand-rolled RSS/Atom reader instead of pulling in a dependency.
It handles both formats, CDATA, numeric entities, and double-encoded accents
(PBS ships "Mbapp&amp;eacute;"). Verified against live TechCrunch and Quanta
feeds: 25 items, zero malformed, no leftover markup.

**Pictures** come from `media:content`, `media:thumbnail` or an image
`enclosure` (largest declared width wins), falling back to the first `<img>` in
the body — but never a GIF, a declared width under 100, or anything that looks
like a pixel: NerdWallet ships a tracking pixel in every item. 64% of items
carry one. Several outlets link the camera original (Semafor 2MB, CBS 2.3MB,
Politico 8.5MB), so the BBC, NPR, Semafor, CBS, WSJ and MarketWatch image
services are asked for an 800px copy; each rewrite was checked to return a real
image. Politico's service takes no width, so Politico goes without. Median
picture after resizing: 82KB.

## Known gaps

- **`chrome.action.openPopup()` at cold startup is unverified.** The docs don't
  say whether it needs a user gesture. The tab fallback exists because of this,
  and the daily check-in has still never been observed firing.
- **Clustering is heuristic.** The 0.30 threshold was tuned against one day of
  live feeds and is biased toward over-merging, on the grounds that a false
  merge is invisible while a repeated story is not.
- **The unprompted holdback is plain substring matching.** It will hold back
  some legitimate reporting and miss things it should catch. It applies only to
  opens Drift initiated, and never deletes anything.
- **No video.** YouTube's free channel RSS returns 404 as of Oct 2026; the Data
  API needs a key, which can't ship in an extension. LinkedIn, TikTok and Reels
  have no public feeds at all.
- **No custom topics or user-supplied feeds.**

## Testing

No test runner. Logic is checked with throwaway harnesses that eval the real
functions out of `background.js` against a fake `chrome` API or live feeds —
that's how the daily check-in's race condition was caught (three triggers firing
in the same tick opened three popups). Worth making permanent if this grows.
