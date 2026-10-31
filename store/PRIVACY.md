# Drift — Privacy Policy

_Last updated: 31 October 2026_

Drift is a browser extension that shows a short digest of news headlines from
publishers you choose. This policy describes exactly what it stores and what it
sends. It is short because Drift does very little.

## Drift has no servers

There is no Drift account, no Drift backend, and no Drift database. Nothing you
do in the extension is transmitted to the developer. There is no analytics,
telemetry, crash reporting, or advertising code in the extension.

## What Drift stores on your device

Stored locally in your browser (`chrome.storage.local`), never transmitted:

| Data | Why |
|---|---|
| Cached headlines (title, link, source, publication time, picture link) | So the digest opens instantly and works offline |
| Reading history — links you opened, and how many times a headline has been displayed | So you aren't shown the same story repeatedly |
| Which topic tab you last viewed | So the digest reopens where you left it |
| Floating bubble position, if you use it | So it stays where you put it |
| Per-day counts: how many times Drift was opened (and how many of those it opened itself), how many stories you opened, and which position in the list they were | So you can see your own use in Settings, and so the digest can be tuned from what is actually read. Counts only — no titles, no links |
| For each outlet: how many of its stories were shown to you, and how many you opened | So outlets you tend to open can lead a little more often. It reorders stories that already made the cut and never decides which ones do. Can be switched off in Settings |
| Titles and links of stories you opened in the last 48 hours | So that a follow-up to something you read can be marked "Update". Dropped after 48 hours |
| Which big stories have already triggered an alert, kept 72 hours | So the same story isn't announced twice |
| The time and method of the last 20 automatic daily openings | So Settings can tell you whether the check-in opened as a popup or a tab |
| The date the daily check-in last ran | So it runs once a day, not repeatedly |

Reading history is pruned automatically: at most 500 entries, and nothing
older than 14 days.

Stored in Chrome's synced storage (`chrome.storage.sync`), which Google
syncs between your own signed-in Chrome installations:

| Data | Why |
|---|---|
| The topics you follow | So your choices follow you between your devices |
| Whether you use the toolbar icon or the floating bubble | Same |
| Whether the daily check-in is on | Same |
| Whether pictures are shown | Same |
| Whether Drift learns which outlets you open | Same |
| Whether alerts are on | Same |

Synced data is handled by Chrome under Google's privacy policy. Drift does not
read it from anywhere other than your own browser.

## What Drift sends over the network

Two kinds of request, both made by your browser directly to news publishers —
never to the developer or anyone else.

**Feeds.** Drift fetches public RSS feeds from the publishers whose topics you
selected, exactly as if you had visited them. Drift requests access to a
publisher's domain only when you select a topic that uses it. If you decline,
that topic is not enabled and no request is made.

**Pictures, if you leave them on.** When the digest shows a story, it loads the
photo that publisher attached to the story in its feed, from that publisher's
image server. This tells the publisher's image server that the picture was
displayed, as loading any image on the web does. No referrer is sent, so it
isn't told where the request came from. Pictures are never loaded in the
floating bubble, because the bubble sits inside other websites, and a website
can see which images are loaded into its pages. You can turn pictures off in
Drift's settings; with them off, opening the digest sends no request to anyone.

None of the counts above is sent anywhere. Settings shows them to you, and
"Erase these numbers" deletes them.

**Notifications, if you turn alerts on.** Alerts use Chrome's notifications
permission, which Drift asks for only at the moment you switch alerts on. They
are drawn on your device from what Drift has already fetched; nothing is
requested from anyone to show one.

Publishers can see these requests as they would any web request, including your
IP address. Drift sends them no information about you, your other topics, or
your reading history. Publisher logos are bundled inside the extension rather
than loaded from the web.

## The floating bubble

The optional floating bubble draws on the pages you visit, which requires
permission to access those pages. It is not installed by default and is only
registered after you choose it and grant that access. It reads nothing from the
pages it appears on — it draws its own panel and nothing else. Turning the
bubble off removes it.

## Your control

- Remove topics at any time in the extension's options.
- Revoke host access at any time in Chrome's extension settings.
- Uninstalling Drift deletes everything it stored on your device.

## Contact

Questions about this policy: _(add a contact address before publishing — the
Chrome Web Store requires one. Consider an alias rather than a personal inbox,
since this page is public.)_
