// Tier key (preamble, before Scene 1).
// Establishes the SteamSpy owner-bucket vocabulary the rest of the page uses.
//
// Layout (two stacked rows per tier):
//   - Top row: uniform-size Steam header thumbnail (110×51) so each tier's
//     representative game is equally legible regardless of audience size.
//     Drowned has no single representative — that slot shows a 3×3 mini-grid
//     of real Drowned-tier games at low opacity ("many small things").
//   - Bottom row: colored circle whose RADIUS doubles each tier (4× area).
//     Aligned to a common baseline so the size progression reads at a glance.
//   - Below the baseline: tier name + owner-count range.
//
// The real ratios are larger still — a Phenomenon-tier game has roughly
// 6,000× the audience of a typical Drowned-tier one, but visualizing that
// strictly would put Drowned at <1px and Phenomenon at 300+ px. The 4×-area
// progression is a compressed-but-readable proxy; the scene__footnote calls
// out the compression so we stay honest.

import { TIERS, TIER_COLORS, TIER_LABELS } from "../lib/colors.js";

// d3 is loaded as a global from the CDN script tag in index.html.

// Radius grows ~1.5× per tier — a softer progression than radius-doubling.
// The Drowned-to-Phenomenon ratio is ~5× by radius (~26× by area), still
// readable as "things get bigger" without Phenomenon dominating the layout.
const TIER_RADII = {
  drowned: 14,
  niche: 22,
  modest: 32,
  hit: 48,
  phenomenon: 72,
};

// Compact owner-range labels for under each circle.
const TIER_RANGES = {
  drowned: "≤ 20k owners",
  niche: "20k – 100k",
  modest: "100k – 1M",
  hit: "1M – 10M",
  phenomenon: "10M+ owners",
};

// Representative Steam game per tier. Picked for recognizability AND for
// actually-living-in-that-tier per the SteamSpy estimates in game_dots.json.
//   - Wilmot's Warehouse: ~35k owners, genuinely niche
//   - Pizza Tower: ~500k owners (Modest range upper)
//   - Hollow Knight: ~5M owners (Hit)
//   - CS2 / CS:GO: ~50M+ owners (Phenomenon)
const TIER_EXAMPLE_APPID = {
  drowned: null,
  niche: "839870",     // Wilmot's Warehouse
  modest: "2231450",   // Pizza Tower
  hit: "367520",       // Hollow Knight
  phenomenon: "730",   // Counter-Strike 2 / GO
};

// Nine real Drowned-tier games (one per release year 2015-2025) shown as a
// 3x3 mini-grid in the Drowned slot. At ~36x15px each, specific titles aren't
// legible — the density of the grid carries the metaphor, not the names.
const DROWNED_CLUSTER_APPIDS = [
  "383590",   // 2015
  "566180",   // 2017
  "991510",   // 2019
  "1443430",  // 2020
  "1598590",  // 2021
  "2137000",  // 2022
  "2318760",  // 2023
  "2677140",  // 2024
  "3743430",  // 2025
];

// Uniform thumbnail dimensions across all tiers (Steam header aspect 460:215).
const THUMB_W = 100;
const THUMB_H = 47;
const GAP_ABOVE_THUMB = 18;

function steamHeaderUrl(appId) {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

export function renderTierKey(host) {
  host.innerHTML = "";
  host.classList.add("tier-key");

  const maxR = TIER_RADII.phenomenon;
  const padTop = 12;
  const padBottom = 12;
  // Vertical layout (top to bottom):
  //   padTop → circle area → baseline → name label → range label
  //     → gap → thumbnail row → padBottom
  const baselineY = padTop + maxR * 2;
  const nameY = baselineY + 20;
  const rangeY = baselineY + 36;
  const thumbY = rangeY + GAP_ABOVE_THUMB;
  const height = thumbY + THUMB_H + padBottom;

  // Slot widths accommodate the larger of (label-width-min, circle-diameter,
  // thumbnail-width). minSlot covers the small-circle tiers where the label
  // text or the thumbnail width drives the slot width.
  const minSlot = Math.max(130, THUMB_W + 24);
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
      "Owner-tier key: five circles sized to convey the relative audience scale of each tier (Drowned, Niche, Modest, Hit, Phenomenon), each with a representative game thumbnail below",
    );

  let cursor = 0;
  for (let i = 0; i < TIERS.length; i++) {
    const tier = TIERS[i];
    const r = TIER_RADII[tier];
    const slotW = slots[i];
    const cx = cursor + slotW / 2;
    const cy = baselineY - r;
    const thumbX = cx - THUMB_W / 2;

    // ===== Tier color circle (size carries the audience-scale story) =====
    svg
      .append("circle")
      .attr("class", "tier-key__circle")
      .attr("cx", cx)
      .attr("cy", cy)
      .attr("r", r)
      .attr("fill", TIER_COLORS[tier]);

    // ===== Baseline tick under each circle =====
    svg
      .append("line")
      .attr("class", "tier-key__baseline")
      .attr("x1", cx - Math.max(r, 18))
      .attr("x2", cx + Math.max(r, 18))
      .attr("y1", baselineY + 0.5)
      .attr("y2", baselineY + 0.5);

    // ===== Name + range labels =====
    svg
      .append("text")
      .attr("class", "tier-key__name")
      .attr("x", cx)
      .attr("y", nameY)
      .attr("text-anchor", "middle")
      .text(TIER_LABELS[tier]);

    svg
      .append("text")
      .attr("class", "tier-key__range")
      .attr("x", cx)
      .attr("y", rangeY)
      .attr("text-anchor", "middle")
      .text(TIER_RANGES[tier]);

    // ===== Thumbnail row (below labels) =====
    if (tier === "drowned") {
      // 3x3 grid of real Drowned-tier games at low opacity. Each tile is
      // tiny enough that the specific game isn't recognizable — what reads
      // is the *density* of small games crammed into the same visual slot
      // a single Steam header occupies for every other tier.
      const cols = 3;
      const rows = 3;
      const cellGap = 2;
      const cellW = (THUMB_W - (cols - 1) * cellGap) / cols;
      const cellH = (THUMB_H - (rows - 1) * cellGap) / rows;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          const appId = DROWNED_CLUSTER_APPIDS[idx];
          if (!appId) continue;
          const tileClipId = `tier-key-drowned-clip-${idx}`;
          const tx = thumbX + col * (cellW + cellGap);
          const ty = thumbY + row * (cellH + cellGap);
          svg
            .append("clipPath")
            .attr("id", tileClipId)
            .append("rect")
            .attr("x", tx)
            .attr("y", ty)
            .attr("width", cellW)
            .attr("height", cellH)
            .attr("rx", 1)
            .attr("ry", 1);
          svg
            .append("image")
            .attr("class", "tier-key__drowned-tile")
            .attr("href", steamHeaderUrl(appId))
            .attr("x", tx)
            .attr("y", ty)
            .attr("width", cellW)
            .attr("height", cellH)
            .attr("preserveAspectRatio", "xMidYMid slice")
            .attr("clip-path", `url(#${tileClipId})`);
        }
      }
    } else if (TIER_EXAMPLE_APPID[tier]) {
      // Single uniform-size thumbnail with rounded corners.
      const clipId = `tier-key-thumb-clip-${tier}`;
      svg
        .append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("x", thumbX)
        .attr("y", thumbY)
        .attr("width", THUMB_W)
        .attr("height", THUMB_H)
        .attr("rx", 4)
        .attr("ry", 4);
      svg
        .append("image")
        .attr("class", "tier-key__thumb")
        .attr("href", steamHeaderUrl(TIER_EXAMPLE_APPID[tier]))
        .attr("x", thumbX)
        .attr("y", thumbY)
        .attr("width", THUMB_W)
        .attr("height", THUMB_H)
        .attr("preserveAspectRatio", "xMidYMid slice")
        .attr("clip-path", `url(#${clipId})`);
    }

    cursor += slotW;
  }
}
