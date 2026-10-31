import { load } from "./load.mjs";
const T = new Date("2026-10-28T09:00:00-05:00").getTime();
Date.now = () => T;
const D = load();
let bad = 0;
const check = (name, ok, detail = "") => { if (!ok) bad++; console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : "")); };

console.log("source affinity");
const none = D.sourceAffinity({ sources: { A: { s: 30, o: 3 }, B: { s: 30, o: 3 } } });
check("too few opens overall → no opinion", Object.keys(none).length === 0);
const stats = { sources: {
  Loved:  { s: 40, o: 24 }, Ignored: { s: 40, o: 1 }, Average: { s: 40, o: 8 },
  Rare:   { s: 3, o: 3 },   Middle: { s: 40, o: 7 } } };
const aff = D.sourceAffinity(stats);
console.log("     ", JSON.stringify(aff));
check("an outlet you open far more gets a bonus", aff.Loved > 0.8, "" + aff.Loved);
check("an outlet you skip gets a drag", aff.Ignored < -0.8, "" + aff.Ignored);
check("an average outlet is left alone", Math.abs(aff.Average) < 0.4, "" + aff.Average);
check("three opens of a rarely shown outlet is not devotion", aff.Rare === undefined);
check("never beyond the cap", Object.values(aff).every((v) => Math.abs(v) <= D.AFFINITY_CAP));
const lots = D.sourceAffinity({ sources: { X: { s: 70, o: 70 }, Y: { s: 70, o: 0 }, Z: { s: 70, o: 5 } } });
check("a perfect record is held under the cap", lots.X > 1 && lots.X <= D.AFFINITY_CAP && lots.Y === -D.AFFINITY_CAP, JSON.stringify(lots));

console.log("\nordering");
const mk = (source, score) => ({ source, score, title: source });
const ordered = D.orderByAffinity([mk("Ignored", 8), mk("Loved", 7.2), mk("Average", 7.5)], aff);
check("preferred outlet moves up a place", ordered[0].source === "Loved", ordered.map((s) => s.source).join(" > "));
check("it never changes the scores themselves", ordered.every((s) => [8, 7.2, 7.5].includes(s.score)));

console.log("\nalert selection");
const story = (event, outlets, recent, extra = {}) => ({ event, eventOutlets: outlets, eventRecent: recent, url: "https://x/" + event, source: "S", title: "T" + event, score: 10, ...extra });
const hour = (h) => new Date(`2026-10-28T${String(h).padStart(2, "0")}:00:00-05:00`).getTime();
const ranked = [story(1, 12, 6), story(2, 9, 8), story(3, 14, 2), story(4, 11, 7, { lowValue: true })];
check("a big, moving event is picked", D.pickAlert(ranked, [], {}, hour(10), 6)?.story.event === 1);
check("9 outlets is not enough", D.pickAlert([story(2, 9, 8)], [], {}, hour(10), 6) === null);
check("14 outlets that stopped filing is not breaking", D.pickAlert([story(3, 14, 2)], [], {}, hour(10), 6) === null);
check("a live blog never alerts", D.pickAlert([story(4, 11, 7, { lowValue: true })], [], {}, hour(10), 6) === null);
check("not before your day starts", D.pickAlert(ranked, [], {}, hour(4), 6) === null);
check("not late at night", D.pickAlert(ranked, [], {}, hour(23), 6) === null);
const sentToday = [{ t: hour(8), urls: ["https://x/zzz"], title: "earlier" }];
check("one a day", D.pickAlert(ranked, sentToday, {}, hour(10), 6) === null);
const sentYesterday = [{ t: hour(10) - 24 * 3.6e6, urls: ["https://x/1"], title: "same event" }];
check("never the same event twice, even a day later", D.pickAlert(ranked, sentYesterday, {}, hour(10), 6) === null);
check("not something you already read", D.pickAlert(ranked, [], { "https://x/1": { t: 1 } }, hour(10), 6) === null);
const two = D.pickAlert([story(1, 12, 6), story(5, 16, 9)], [], {}, hour(10), 6);
check("when two qualify, the bigger goes first", two?.story.event === 5);

console.log("\n" + (bad ? bad + " FAILED" : "all passed"));
process.exit(bad ? 1 : 0);
