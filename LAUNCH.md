# Launch checklist

Target: Chrome Web Store. Status as of 16 October 2026.

## Done

- [x] Working extension, verified end to end in Chrome
- [x] 35 RSS feeds across 10 topics, all returning items from a real browser
- [x] Ranking: 168h staleness ceiling, 24h "new", rarity-weighted clustering,
      corroboration outranks recency, topics may legitimately be empty
- [x] Redundancy: cross-topic clustering, local reading history
- [x] **Clean install prompt** — no host permissions requested at install;
      access asked per topic, bubble registered only when chosen
- [x] Icons and bundled publisher logos (no runtime image requests)
- [x] Unprompted-open holdback for distressing headlines
- [x] Privacy policy drafted → `store/PRIVACY.md`
- [x] Listing copy and permission justifications → `store/LISTING.md`

## Blocking submission

- [ ] **$5 developer registration** (one-time, Chrome Web Store dashboard)
- [ ] **Host the privacy policy at a public URL** — the store requires a link,
      not a file. A GitHub Pages page or a gist is enough
- [ ] **Screenshots** (1280x800 or 640x400) — must be taken from a real
      browser; see the list in `store/LISTING.md`
- [ ] **Decide listing visibility** — public, or unlisted while testing

## Worth doing before launch, not blocking

- [ ] Verify the daily check-in actually fires, and whether it arrives as a
      popup or the tab fallback. Still never observed
- [ ] Decide whether the per-topic permission prompt feels acceptable — it is
      the cost of the clean install, and only real use will tell
- [ ] Tune `SEEN_DEMOTE_AT` (currently 3) after living with it
- [ ] Finance has only 2 sources; both candidates tested were dead
- [ ] Support email in the listing — currently a personal address

## Known gaps, documented honestly

- Clustering is heuristic. The threshold (0.30) was tuned on one day of live
  feeds and biased toward over-merging
- The holdback list is plain substring matching. It will hold some legitimate
  reporting and miss things it should catch. It only affects unprompted opens
  and never deletes anything
- No video. YouTube's free channel RSS returns 404 as of Oct 2026; the Data
  API needs a key, which can't ship in an extension
- No custom topics or user-supplied feeds. Would need
  `optional_host_permissions` requested at runtime per feed

## Open product questions for the mentor conversation

1. **Who is this for?** The ranking work assumes someone who wants less, not
   more. That's a narrower audience than "news reader" and worth naming.
2. **What does success look like at week 4?** Installs are vanity here; the
   honest metric is *returning opens per user per week*, because the entire
   thesis is habit.
3. **Does the per-topic permission prompt cost more than the clean install
   buys?** Both are defensible. Worth deciding deliberately rather than by
   default.
4. **Is the daily check-in the product, or a feature of it?** If keeping up
   without effort is the promise, the once-a-day open may deserve to be the
   centrepiece rather than an option.
