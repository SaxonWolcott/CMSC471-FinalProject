// Entry point. Fetches the per-scene aggregations from `data/` and hands each
// off to its scene module. Scrollama wiring will land here as more scenes come
// online.

import { renderFlood } from "./scenes/01-flood.js";

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

  const floodHost = document.getElementById("scene-flood-viz");
  if (floodHost) {
    renderFlood(floodHost, tierData);
    log("Scene 1 (Flood) rendered");
  }
}

main().catch((err) => {
  console.error("[main] startup failed", err);
});
