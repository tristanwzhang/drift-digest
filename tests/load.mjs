// Loads the shipping background.js, worker/engagement.js and shared/data.js
// with chrome stubbed, so the tests run the exact code the extension runs.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export function load(bgSource) {
  const data = fs.readFileSync(ROOT + "/shared/data.js", "utf8");
  const bg = fs.readFileSync(ROOT + "/worker/engagement.js", "utf8") + "\n" +
    (bgSource ?? fs.readFileSync(ROOT + "/background.js", "utf8")).replace(/importScripts\([^)]*\);/, "");
  const stub = `
    const handler = { get: (t, k) => k === Symbol.toPrimitive ? () => "" : new Proxy(function(){}, handler),
                      apply: () => new Proxy(function(){}, handler) };
    const chrome = new Proxy({}, handler);
  `;
  const exportNames = ["parseFeed","rank","assignToTopics","buildTrending","interleaveBySource",
    "NEWSLETTER_TOPICS","getTopic","standingOf","POOL_PER_TOPIC","ageHours","MAX_AGE_HOURS","pickStories","onePerEvent","eventTokens","namesIn","homeEvents","eventHomes","STORY_FLOOR","STORIES_PER_TAB","sourceAffinity","orderByAffinity","pickAlert","findUpdates","applyUpdates","growFollowed","storyUrls","dayKey","UPDATE_BOOST","AFFINITY_CAP"];
  const exp = exportNames.map((n) => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined`).join(",");
  return new Function(stub + data + "\n" + bg + `\n;return {${exp}};`)();
}
