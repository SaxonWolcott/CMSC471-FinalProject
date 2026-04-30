// Phase 0 entry point. Verifies the static-hosting pipeline:
//   - CDN globals (d3, scrollama) loaded
//   - relative fetch from ./data/ works
// Real scrollama wiring + scene controllers come in Phase 1.

const log = (...args) => console.log("[main]", ...args);

log("d3 version:", typeof d3 !== "undefined" ? d3.version : "NOT LOADED");
log("scrollama:", typeof scrollama !== "undefined" ? "loaded" : "NOT LOADED");

const target = document.getElementById("viz-placeholder");

try {
  const data = await fetch("./data/placeholder.json").then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  log("placeholder data:", data);
  if (target) target.textContent = `fetch ok — ${data.message}`;
} catch (err) {
  log("fetch failed:", err);
  if (target) target.textContent = `fetch failed: ${err.message}`;
}
