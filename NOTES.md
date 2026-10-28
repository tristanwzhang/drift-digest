# Drift

A browser digest. Two or three fresh headlines per topic you follow, one click
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

- items older than **168h** are dropped entirely
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
- a topic may return fewer than three items, **including none** — an honest
  "Quiet in X today" beats three pieces of filler

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

Only stories **more than one outlet ran**, so the tab means agreement rather
than recency. Where a topic sits on the dashboard weights what it contributes:
the first topic counts for its full score, the last for 40% of it, measured as
a fraction of the way down the list so it reads the same whether you follow
three topics or fifteen. The weight is a multiplier, so a genuinely big story
in your last topic still makes it while a routine one no longer takes a slot
from the topics you put first. No topic may take more than two of the six
slots, and on a thin day the tab runs short rather than padding.

### The daily check-in

"When they open their laptop" isn't observable: most people never quit Chrome,
so `runtime.onStartup` never fires for them. It's measured instead as the first
browser activity on a new calendar date, watched from startup, window focus,
tab activation and the alarm. It tries `chrome.action.openPopup()` and falls
back to opening `daily/daily.html` in a tab.

## Parsing

MV3 service workers have no DOM, so there's no `DOMParser`. `background.js`
contains a small hand-rolled RSS/Atom reader instead of pulling in a dependency.
It handles both formats, CDATA and numeric entities. Verified against live
TechCrunch and Quanta feeds: 25 items, zero malformed, no leftover markup.

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
