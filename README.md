# Drift

**A browser digest that's worth opening.** Two or three current headlines per
topic you follow, behind one icon in your toolbar. No feed to scroll, no inbox
to clear, no tab to keep open.

A Chrome extension (Manifest V3), no build step, no dependencies, no backend.

> _Screenshot goes here — popup open over a real page._

---

## Why it exists

Most readers sort by timestamp and show you whatever landed most recently.
That's how a design feed leads with a desktop-wallpaper roundup, and how a
week-old article ends up wearing a "new" badge.

The bet behind Drift is that **mediocre content is worse than no content** — a
digest that's reliably unremarkable stops getting opened within a week, and you
don't get that habit back. So most of the work here went into what *doesn't*
reach you.

## What that meant in practice

**Recency is not relevance.** Items older than a week are dropped rather than
used as filler. "New" means published in the last 24 hours, read off the
article itself rather than its position in the list — so a slow topic's lead
story never claims to be fresh when it isn't.

**Agreement is a signal.** When two independent outlets cover the same story,
Drift merges them and ranks the result above single-source items. Getting this
working was the interesting part: plain word overlap can't separate "the same
story" from "both about the NFL", because both share words. Weighting each word
by how rare it is in the batch fixes it — two outlets covering one event share
proper nouns like *Jagex* or *Nemotron*, while unrelated pieces in a topic share
its common vocabulary. Measured against a day of live feeds, the unweighted
version merged **zero** pairs; it was dead code that looked like a feature.

**Where you put a topic is a statement about it.** Dragging topics into your
own order doesn't just rearrange tabs — it tells Trending how much each one is
worth. Measured on one day's feeds, moving sports from first to last took it
from two of the six Trending slots to one, without touching any other signal.

**A quiet day is a real answer.** A topic can return fewer than three stories,
or none, and says so plainly instead of padding.

**It remembers you.** Stories you opened drop out. Stories shown repeatedly and
ignored fall behind newer ones. Clustering runs across all your topics at once,
so a story that's both AI news and startup news appears once, not twice.

## Privacy as an architecture decision, not a policy page

Installing Drift requests **no permissions at all**. Access to a publisher is
requested when you pick a topic that uses it, and the optional floating bubble
— the only part that touches page content — is registered at runtime via
`scripting.registerContentScripts` only if you turn it on.

The first version declared a content script matching `<all_urls>`, which makes
Chrome show *"Read and change all your data on all the websites you visit"* —
the scariest prompt it has, for a product that just reads RSS. Moving every host
to `optional_host_permissions` removed it entirely.

There's no account, no server, and no analytics. Publisher logos are bundled in
the extension, so opening the digest makes zero network requests. Reading
history never leaves the device. [Full policy](store/PRIVACY.md).

## A constraint worth knowing about

MV3 service workers have no DOM, so `DOMParser` doesn't exist there — which is
inconvenient when your whole job is parsing XML. Rather than bundle a library or
stand up an offscreen document, `background.js` contains a small hand-rolled
RSS/Atom reader handling both formats, CDATA and numeric entities. Verified
against live feeds: 25 items, zero malformed, no leftover markup.

## Running it

```
1. chrome://extensions  →  Developer mode on
2. Load unpacked  →  select this folder
3. Click the Drift icon, pick your topics
```

## Layout

```
background.js     service worker: fetch → parse → rank → cache
shared/data.js    topics, feeds, and helpers shared by every surface
popup/            the toolbar popup — the default surface
daily/            full-page digest for the once-a-day check-in
content/          optional floating bubble, registered only if enabled
options/          topic picker, display mode, settings
store/            privacy policy and Web Store listing copy
```

[NOTES.md](NOTES.md) has the architecture in more depth, including storage keys
and an honest list of known gaps. [LAUNCH.md](LAUNCH.md) tracks what's left
before a store submission.

## Status

Working prototype, running against 35 live RSS feeds across 10 topics. Not yet
on the Chrome Web Store.
