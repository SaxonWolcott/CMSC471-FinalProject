// End-of-Phase-0 entry point. Verifies CDN globals and a real data fetch.
// Real scrollama wiring + scene controllers land in Phase 1.

const log = (...args) => console.log("[main]", ...args);

log("d3 version:", typeof d3 !== "undefined" ? d3.version : "NOT LOADED");
log("scrollama:", typeof scrollama !== "undefined" ? "loaded" : "NOT LOADED");

const target = document.getElementById("viz-placeholder");

try {
  const releasesByYear = await fetch("./data/releases_per_year.json").then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  const totalReleases = releasesByYear.reduce((sum, r) => sum + r.count, 0);
  const yearSpan = `${releasesByYear[0].year}–${releasesByYear[releasesByYear.length - 1].year}`;
  log("releases per year loaded:", releasesByYear.length, "rows,", totalReleases, "games");
  if (target) {
    target.textContent =
      `loaded ${releasesByYear.length} years (${yearSpan}), ` +
      `${totalReleases.toLocaleString()} total releases tracked`;
  }
} catch (err) {
  log("fetch failed:", err);
  if (target) target.textContent = `fetch failed: ${err.message}`;
}
