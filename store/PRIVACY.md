# Drift — Privacy Policy

_Last updated: 16 October 2026_

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
| Cached headlines (title, link, source, publication time) | So the digest opens instantly and works offline |
| Reading history — links you opened, and how many times a headline has been displayed | So you aren't shown the same story repeatedly |
| Which topic tab you last viewed | So the digest reopens where you left it |
| Floating bubble position, if you use it | So it stays where you put it |
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

Synced data is handled by Chrome under Google's privacy policy. Drift does not
read it from anywhere other than your own browser.

## What Drift sends over the network

Only one kind of request: Drift fetches public RSS feeds directly from the news
publishers whose topics you selected. These requests are made by your browser,
to those publishers, exactly as if you had visited them.

Those publishers can see the request as they would any web request, including
your IP address. Drift sends them no information about you, your other topics,
or your reading history.

Drift requests access to a publisher's domain only when you select a topic that
uses it. If you decline, that topic is not enabled and no request is made.
Publisher logos are bundled inside the extension rather than loaded from the
web, so opening the digest sends no request to anyone.

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
