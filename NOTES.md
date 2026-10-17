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
- a topic may return fewer than three items, **including none** — an honest
  "Quiet in X today" beats three pieces of filler

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
