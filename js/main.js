// Entry point. Fetches the per-scene aggregations from `data/` and hands each
// off to its scene module. Scrollama wiring will land here as more scenes come
// online.

import { renderFlood } from "./scenes/01-flood.js";
import { renderIndieWave } from "./scenes/02-indie-wave.js";
import { renderFindYourGame } from "./scenes/04-find-your-game.js";

const log = (...args) => console.log("[main]", ...args);

log("d3 version:", typeof d3 !== "undefined" ? d3.version : "NOT LOADED");
log("scrollama:", typeof scrollama !== "undefined" ? "loaded" : "NOT LOADED");

async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function main() {
  // Initialize scrollytelling first so the hide/reveal class is in place
  // before any scene renders. Scrollama tracks `.scene` elements, which
  // exist in the HTML before any rendering happens; hosts inside those
  // sections can populate at any later moment without disrupting the
  // entrance animation.
  initScrollama();

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

  // Scene 3 (Quality) is a placeholder for now — content lives in HTML.

  const findYourGameHost = document.getElementById("scene-find-your-game-viz");
  if (findYourGameHost) {
    const games = await loadJSON("./data/game_dots.json");
    log(`game_dots: ${games.length} games loaded`);
    renderFindYourGame(findYourGameHost, games);
    log("Scene 4 (Find Your Game) rendered");
  }
}

// Scrollytelling: fade each scene up as its top crosses 70% of the viewport.
// Gated on `body.has-scrollama` so the page degrades gracefully if scrollama
// never loads — without that class, scenes are always visible regardless of
// whether the entrance class fires.
function initScrollama() {
  if (typeof scrollama === "undefined") {
    log("scrollama not loaded; skipping entrance animations");
    return;
  }
  document.body.classList.add("has-scrollama");
  const scroller = scrollama();
  scroller
    .setup({
      step: ".scene",
      offset: 0.7,
      once: true,
    })
    .onStepEnter((response) => {
      response.element.classList.add("scene--in-view");
    });
  window.addEventListener("resize", () => scroller.resize());
  log(`scrollama wired up for ${document.querySelectorAll(".scene").length} scenes`);
}

main().catch((err) => {
  console.error("[main] startup failed", err);
});
