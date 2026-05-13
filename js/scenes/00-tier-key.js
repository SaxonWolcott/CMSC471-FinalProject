// Tier key (preamble, before Scene 1).
// Establishes the SteamSpy owner-bucket vocabulary the rest of the page uses.
// Five circles in a row sized by RADIUS-DOUBLING (each tier is 2× the radius,
// 4× the area of the previous tier), aligned on a common baseline so the
// progression reads at a glance.
//
// The real ratios are larger still — a Phenomenon-tier game has roughly
// 6,000× the audience of a typical Drowned-tier one, but visualizing that
// strictly would put Drowned at <1px and Phenomenon at 300+ px. The 4×-area
// progression is a compressed-but-readable proxy; the scene__footnote calls
// out the compression so we stay honest.

import { TIERS, TIER_COLORS, TIER_LABELS } from "../lib/colors.js";

// d3 is loaded as a global from the CDN script tag in index.html.

// Radius doubles between tiers. Drowned at 8px is small but readable;
// Phenomenon at 128px (256px diameter) is dramatic without blowing the layout.
const TIER_RADII = {
  drowned: 8,
  niche: 16,
  modest: 32,
  hit: 64,
  phenomenon: 128,
};

// Compact owner-range labels for under each circle. Slightly tighter than
// TIER_DEFINITIONS (which carries an extra parenthetical for the Scene 1
// legend) so the labels stay one short line each.
const TIER_RANGES = {
  drowned: "≤ 20k owners",
  niche: "20k – 100k",
  modest: "100k – 1M",
  hit: "1M – 10M",
  phenomenon: "10M+ owners",
};

export function renderTierKey(host) {
  host.innerHTML = "";
  host.classList.add("tier-key");

  const maxR = TIER_RADII.phenomenon;
  const padTop = 24;
  const padBottom = 12;
  const labelBlockH = 44; // two lines of label below the baseline
  const baselineY = padTop + maxR * 2;
  const height = baselineY + labelBlockH + padBottom;

  // Each "slot" is sized to hold its circle plus enough horizontal room for
  // the label underneath. The smaller tiers have wider slots than their
  // circles need (so the label has room); the larger tiers are circle-driven.
  const minSlot = 130;
  const slotPad = 32;
  const slots = TIERS.map((t) => Math.max(minSlot, TIER_RADII[t] * 2 + slotPad));
  const totalWidth = slots.reduce((a, b) => a + b, 0);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `0 0 ${totalWidth} ${height}`)
    .attr("width", "100%")
    .attr("height", height)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr(
      "aria-label",
      "Five circles sized to convey the relative audience scale of each owner-count tier: Drowned, Niche, Modest, Hit, Phenomenon",
    );

  let cursor = 0;
  for (let i = 0; i < TIERS.length; i++) {
    const tier = TIERS[i];
    const r = TIER_RADII[tier];
    const slotW = slots[i];
    const cx = cursor + slotW / 2;
    const cy = baselineY - r; // align bottoms of all circles to baselineY

    svg
      .append("circle")
      .attr("class", "tier-key__circle")
      .attr("cx", cx)
      .attr("cy", cy)
      .attr("r", r)
      .attr("fill", TIER_COLORS[tier]);

    // Faint baseline tick under each circle so the "common ground" reads
    // even when the eye drifts away from the bottom of the circle itself.
    svg
      .append("line")
      .attr("class", "tier-key__baseline")
      .attr("x1", cx - Math.max(r, 18))
      .attr("x2", cx + Math.max(r, 18))
      .attr("y1", baselineY + 0.5)
      .attr("y2", baselineY + 0.5);

    svg
      .append("text")
      .attr("class", "tier-key__name")
      .attr("x", cx)
      .attr("y", baselineY + 20)
      .attr("text-anchor", "middle")
      .text(TIER_LABELS[tier]);

    svg
      .append("text")
      .attr("class", "tier-key__range")
      .attr("x", cx)
      .attr("y", baselineY + 36)
      .attr("text-anchor", "middle")
      .text(TIER_RANGES[tier]);

    cursor += slotW;
  }
}
