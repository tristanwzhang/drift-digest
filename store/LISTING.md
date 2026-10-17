# Chrome Web Store listing

## Name
Drift — Daily Digest

## Short description (132 char max)
Two or three fresh headlines per topic you follow, one click away. No feed to
scroll, no inbox to clear, no tab to keep open.

## Category
News & Weather

## Detailed description

Keeping up shouldn't mean a feed that never ends.

Drift puts a short digest behind one icon in your toolbar. Pick the topics you
care about — AI, climate, space, startups, health, gaming, design, finance,
science, sports — and Drift keeps two or three current headlines for each,
ready whenever you want them. Click one to read it at the source.

**Built to be worth opening**

Most readers show you whatever was published most recently. That's how you end
up with a wallpaper roundup at the top of a design feed and a week-old article
wearing a "new" badge. Drift does more work before anything reaches you:

- Anything older than a week is dropped rather than used as filler
- "New" means published in the last 24 hours — never a label on a stale item
- When two independent outlets cover the same story, Drift merges them and
  ranks that story higher, because agreement is a signal
- A topic can show fewer than three stories, or none at all. A quiet day is
  reported honestly instead of padded

**It remembers where you were**

Stories you've opened drop out. Stories you've scrolled past several times step
aside for newer ones. Open it twice in a morning and the second look isn't the
same as the first.

**Optional: a once-a-day check-in**

If you'd like, Drift can open itself the first time you use your browser each
day — once, never more — so keeping up doesn't depend on remembering to.

**Optional: a floating bubble**

Prefer it on the page instead of the toolbar? Drift can float as a small bubble
you drag anywhere, or tuck off the edge of the screen until you want it back.

**Private by construction**

No account, no servers, no analytics. Drift fetches public RSS feeds straight
from the publishers you chose, and that's the only network request it makes.
Publisher logos are bundled in the extension, so opening the digest doesn't
even phone home for an image. Your reading history never leaves your device.

Drift asks for access to a news site only when you pick a topic that uses it.
Install it and it asks for nothing at all.

## Permission justifications (for the developer dashboard)

**storage** — saves your topic choices and caches fetched headlines so the
digest opens instantly and works offline.

**alarms** — refreshes the digest on a 30-minute schedule in the background.

**scripting** — registers the optional floating bubble at runtime, only if the
user enables it. Not used otherwise.

**Optional host permissions (news domains)** — fetches public RSS feeds from
the publishers behind the topics the user selected. Requested per topic, at the
moment the topic is chosen, never at install.

**Optional `<all_urls>`** — required only for the optional floating bubble,
which draws its panel over the current page. Requested only when the user
switches to bubble mode. The extension reads no page content.

## Screenshots needed (1280x800 or 640x400)
1. The popup open over a real article page, showing headlines and topic tabs
2. The options page, showing topic selection
3. The daily check-in page
4. The floating bubble on a page, mid-drag or docked
5. Light and dark side by side

## Still required before submission
- [ ] $5 one-time Chrome Web Store developer registration
- [ ] Privacy policy hosted at a public URL (store/PRIVACY.md is the text)
- [ ] 128x128 store icon (icons/icon128.png exists)
- [ ] Screenshots above, taken from a real browser
- [ ] Decide: publish publicly, or unlisted for testing first
