// Entry point. Fetches the per-scene aggregations from `data/` and hands each
// off to its scene module. Scrollama wiring will land here as more scenes come
// online.

import { renderFlood } from "./scenes/01-flood.js";
import { renderIndieWave } from "./scenes/02-indie-wave.js";
import { renderMedianCrashed } from "./scenes/03-median-crashed.js";

const log = (...args) => console.log("[main]", ...args);

log("d3 version:", typeof d3 !== "undefined" ? d3.version : "NOT LOADED");
log("scrollama:", typeof scrollama !== "undefined" ? "loaded" : "NOT LOADED");

async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const tierData = await loadJSON("./data/tier_share_by_year.json");
  log(`tier_share_by_year: ${tierData.length} years loaded`);

  // Drop 2026 — only ~84 games released by snapshot date, the bar is mostly
  // empty and visually noisy. The dropped year is still in the source JSON
  // for any later scene that wants the longer range.
  const floodData = tierData.filter((d) => d.year < 2026);

  const floodHost = document.getElementById("scene-flood-viz");
  if (floodHost) {
    renderFlood(floodHost, floodData);
    log("Scene 1 (Flood) rendered");
  }

  const genreData = await loadJSON("./data/genre_share_by_year.json");
  log(`genre_share_by_year: ${genreData.byYear.length} years, ${genreData.genres.length} genres loaded`);

  const indieHost = document.getElementById("scene-indie-viz");
  if (indieHost) {
    renderIndieWave(indieHost, genreData);
    log("Scene 2 (Indie Wave) rendered");
  }

  const [medianRaw, examplesRaw, engagementRaw] = await Promise.all([
    loadJSON("./data/median_owners_by_year.json"),
    loadJSON("./data/median_examples_by_year.json"),
    loadJSON("./data/engagement_by_year.json"),
  ]);
  log(
    `median_owners: ${medianRaw.length} years, examples: ${examplesRaw.length} years, engagement: ${engagementRaw.length} years`,
  );

  const medianHost = document.getElementById("scene-median-viz");
  if (medianHost) {
    renderMedianCrashed(medianHost, {
      median: medianRaw,
      examples: examplesRaw,
      engagement: engagementRaw,
    });
    log("Scene 3 (Median Crashed) rendered");
  }
}

main().catch((err) => {
  console.error("[main] startup failed", err);
});
