// Entry point. Fetches the per-scene aggregations from `data/` and hands each
// off to its scene module. Scrollama wiring will land here as more scenes come
// online.

import { renderTierKey } from "./scenes/00-tier-key.js";
import { renderFlood } from "./scenes/01-flood.js";
import { renderIndieWave } from "./scenes/02-indie-wave.js";
import { renderQuality } from "./scenes/03-quality.js";
import { renderFindYourGame } from "./scenes/04-find-your-game.js";

const log = (...args) => console.log("[main]", ...args);

log("d3 version:", typeof d3 !== "undefined" ? d3.version : "NOT LOADED");

async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function main() {
  // Tier-key preamble — no data fetch needed; the section reads from
  // colors.js constants only.
  const tierKeyHost = document.getElementById("scene-tier-key-viz");
  if (tierKeyHost) {
    renderTierKey(tierKeyHost);
    log("Tier-key preamble rendered");
  }

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

  const qualityHost = document.getElementById("scene-quality-viz");
  if (qualityHost) {
    const qualityData = await loadJSON("./data/quality_by_year.json");
    log(`quality_by_year: ${qualityData.length} years loaded`);
    renderQuality(qualityHost, qualityData);
    log("Scene 3 (Quality) rendered");
  }

  const findYourGameHost = document.getElementById("scene-find-your-game-viz");
  if (findYourGameHost) {
    const games = await loadJSON("./data/game_dots.json");
    log(`game_dots: ${games.length} games loaded`);
    renderFindYourGame(findYourGameHost, games);
    log("Scene 4 (Find Your Game) rendered");
  }
}

main().catch((err) => {
  console.error("[main] startup failed", err);
});
