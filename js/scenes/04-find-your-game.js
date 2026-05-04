// Scene 4: Find Your Game (capstone).
// Personally-meaningful exploration. The viewer types a Steam game name; the
// scene autocompletes from ~113k games and shows where that game sits in
// its release-year cohort: owner tier, percentile rank, genre context, and a
// horizontal stacked-bar of the year's tier mix with a marker pointing at the
// game's tier.
//
// game_dots.json ships in tabular form (fields + rows of value arrays) to
// keep the file small; this module reconstitutes objects on load.

import { TIERS, TIER_COLORS, TIER_LABELS } from "../lib/colors.js";

// d3 is loaded as a global from the CDN script tag in index.html.

const SUGGESTIONS = [
  "Half-Life 2",
  "Portal 2",
  "The Witcher 3",
  "Stardew Valley",
  "Hollow Knight",
  "Hades",
  "Baldur's Gate 3",
];
const RESULT_LIMIT = 10;
const TIER_ORDER = TIERS; // bottom-to-top: drowned → phenomenon
const TIER_COMPARE_HIGHER = (() => {
  // Map a tier name to a numeric rank so we can compute "share of cohort
  // at or above this game's tier."
  const rank = {};
  TIER_ORDER.forEach((t, i) => (rank[t] = i));
  return rank;
})();

export function renderFindYourGame(host, packed) {
  host.innerHTML = "";
  host.classList.add("find-your-game");

  const games = unpack(packed);
  // Pre-compute lowercase search keys once, not every keystroke.
  for (const g of games) g._search = g.name.toLowerCase();
  // Group by year to make cohort lookups O(1).
  const gamesByYear = d3.group(games, (g) => g.year);

  buildShell(host);
  const searchInput = host.querySelector(".fyg-search__input");
  const resultsList = host.querySelector(".fyg-results");
  const detailHost = host.querySelector(".fyg-detail");
  const suggestionsHost = host.querySelector(".fyg-suggestions");

  // Initial empty state plus quick-pick suggestion chips.
  renderEmpty(detailHost);
  renderSuggestions(suggestionsHost, SUGGESTIONS, (name) => {
    searchInput.value = name;
    searchInput.dispatchEvent(new Event("input"));
    // After triggering search, auto-select the top match for that suggestion.
    setTimeout(() => {
      const first = resultsList.querySelector(".fyg-result");
      if (first) first.click();
    }, 0);
  });

  let lastQuery = "";
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    if (q === lastQuery) return;
    lastQuery = q;

    if (!q) {
      resultsList.innerHTML = "";
      resultsList.hidden = true;
      return;
    }

    const matches = searchGames(q, games, RESULT_LIMIT);
    renderResults(resultsList, matches, (game) => {
      resultsList.hidden = true;
      searchInput.value = game.name;
      lastQuery = game.name;
      renderDetail(detailHost, game, gamesByYear);
    });
    resultsList.hidden = matches.length === 0;
  });

  // Click outside the search area dismisses the results list.
  document.addEventListener("click", (event) => {
    if (!host.contains(event.target)) resultsList.hidden = true;
  });
}

// ---------------------------------------------------------------------------
// Data unpack
// ---------------------------------------------------------------------------

function unpack({ fields, rows }) {
  const idx = Object.fromEntries(fields.map((f, i) => [f, i]));
  return rows.map((row) => ({
    appId: row[idx.appId],
    name: row[idx.name],
    year: row[idx.year],
    ownersMid: row[idx.ownersMid],
    tier: row[idx.tier],
    isIndie: row[idx.isIndie] === 1,
    genres: row[idx.genres] ? String(row[idx.genres]).split(",") : [],
  }));
}

// Steam serves header images for any appId at this CDN path. Returns null
// when the image fails to load so we can hide the element gracefully.
function steamHeaderUrl(appId) {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

// ---------------------------------------------------------------------------
// UI scaffolding
// ---------------------------------------------------------------------------

function buildShell(host) {
  host.innerHTML = `
    <div class="fyg-search">
      <input
        type="text"
        class="fyg-search__input"
        placeholder="Type a Steam game name…"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <ul class="fyg-results" hidden></ul>
    <div class="fyg-suggestions"></div>
    <div class="fyg-detail"></div>
  `;
}

function renderEmpty(host) {
  host.innerHTML = `
    <div class="fyg-detail__empty">
      Pick a game above (or click one of the suggestions) to see how it
      compared to the rest of the games released in its year.
    </div>
  `;
}

function renderSuggestions(host, names, onPick) {
  host.innerHTML =
    `<span class="fyg-suggestions__label">Try:</span>` +
    names
      .map(
        (n) =>
          `<button type="button" class="fyg-suggestion" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`,
      )
      .join("");
  host.querySelectorAll(".fyg-suggestion").forEach((btn) => {
    btn.addEventListener("click", () => onPick(btn.dataset.name));
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function searchGames(query, games, limit) {
  const q = query.toLowerCase();
  const exact = [];
  const startsWith = [];
  const contains = [];
  for (const g of games) {
    if (g._search === q) exact.push(g);
    else if (g._search.startsWith(q)) startsWith.push(g);
    else if (g._search.includes(q)) contains.push(g);
    if (exact.length + startsWith.length >= limit * 4) break;
  }
  // Within each priority bucket, sort by owners descending so famous games surface first.
  const byOwners = (a, b) => b.ownersMid - a.ownersMid;
  const ranked = [
    ...exact.sort(byOwners),
    ...startsWith.sort(byOwners),
    ...contains.sort(byOwners),
  ];
  return ranked.slice(0, limit);
}

function renderResults(host, results, onPick) {
  host.innerHTML = results
    .map(
      (g) => `
        <li class="fyg-result" data-app-id="${escapeHtml(g.appId)}">
          <span class="fyg-result__name">${escapeHtml(g.name)}</span>
          <span class="fyg-result__year">${g.year}</span>
        </li>
      `,
    )
    .join("");
  host.querySelectorAll(".fyg-result").forEach((li, i) => {
    li.addEventListener("click", () => onPick(results[i]));
  });
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function renderDetail(host, game, gamesByYear) {
  const cohort = gamesByYear.get(game.year) || [];
  const cohortSize = cohort.length;

  // Per-tier counts for the cohort.
  const tierCounts = Object.fromEntries(TIER_ORDER.map((t) => [t, 0]));
  for (const g of cohort) tierCounts[g.tier] = (tierCounts[g.tier] || 0) + 1;

  // Share at-or-above this game's tier (the "X% sat at or above" line).
  const myRank = TIER_COMPARE_HIGHER[game.tier];
  const atOrAbove = TIER_ORDER.filter(
    (t) => TIER_COMPARE_HIGHER[t] >= myRank,
  ).reduce((sum, t) => sum + tierCounts[t], 0);
  const atOrAboveShare = cohortSize ? atOrAbove / cohortSize : 0;

  // Headline phrasing — describes the game's position in plain language.
  const tierLabel = TIER_LABELS[game.tier];
  const positionPhrase =
    game.tier === "drowned"
      ? `${tierLabel} — in the smallest SteamSpy bucket along with ${formatShareLabel(
          atOrAboveShare,
        )} of ${game.year} releases.`
      : `${tierLabel} — only ${formatShareLabel(atOrAboveShare)} of ${game.year} releases reached this tier or higher.`;

  const ownersLabel =
    game.ownersMid > 0
      ? `~${d3.format(",")(game.ownersMid)} (SteamSpy estimate)`
      : "no SteamSpy estimate available";
  const genreLabel = game.genres.length ? game.genres.join(", ") : "—";

  host.innerHTML = `
    <div class="fyg-card">
      <img
        class="fyg-card__image"
        src="${steamHeaderUrl(game.appId)}"
        alt=""
        loading="lazy"
        onerror="this.classList.add('is-hidden')"
      />
      <div class="fyg-card__header">
        <h3 class="fyg-card__name">${escapeHtml(game.name)}</h3>
        <div class="fyg-card__meta">${game.year} · ${escapeHtml(genreLabel)}${game.isIndie ? " · Indie" : ""}</div>
      </div>
      <div class="fyg-card__stats">
        <div class="fyg-stat">
          <span class="fyg-stat__label">Estimated owners</span>
          <span class="fyg-stat__value">${escapeHtml(ownersLabel)}</span>
        </div>
        <div class="fyg-stat">
          <span class="fyg-stat__label">Tier in ${game.year}</span>
          <span class="fyg-stat__value">${escapeHtml(positionPhrase)}</span>
        </div>
      </div>
      <div class="fyg-cohort">
        <div class="fyg-cohort__title">${game.year} release cohort — ${d3.format(",")(cohortSize)} games</div>
        <div class="fyg-cohort__bar"></div>
        <div class="fyg-cohort__legend"></div>
      </div>
    </div>
  `;

  drawCohortBar(host.querySelector(".fyg-cohort__bar"), tierCounts, cohortSize, game.tier);
  drawCohortLegend(host.querySelector(".fyg-cohort__legend"), tierCounts, cohortSize, game.tier);
}

function drawCohortBar(host, tierCounts, total, selectedTier) {
  if (!total) {
    host.innerHTML = `<div class="fyg-cohort__empty">No cohort data.</div>`;
    return;
  }
  const segments = TIER_ORDER.map((t) => ({
    tier: t,
    count: tierCounts[t] || 0,
    share: (tierCounts[t] || 0) / total,
  }));

  const barH = 28;
  const markerH = 14;
  const totalH = barH + markerH + 6;
  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `0 0 100 ${totalH}`)
    .attr("preserveAspectRatio", "none")
    .attr("width", "100%")
    .attr("height", totalH * 2);

  let xCursor = 0;
  let markerX = null;
  for (const seg of segments) {
    const w = seg.share * 100;
    svg
      .append("rect")
      .attr("x", xCursor)
      .attr("y", markerH + 6)
      .attr("width", w)
      .attr("height", barH)
      .attr("fill", TIER_COLORS[seg.tier]);
    if (seg.tier === selectedTier) markerX = xCursor + w / 2;
    xCursor += w;
  }

  if (markerX !== null) {
    // Triangle pointer pointing down at the selected tier's segment.
    svg
      .append("polygon")
      .attr(
        "points",
        `${markerX - 4},${markerH - 2} ${markerX + 4},${markerH - 2} ${markerX},${markerH + 4}`,
      )
      .attr("fill", "#ffffff");
  }
}

function drawCohortLegend(host, tierCounts, total, selectedTier) {
  d3.select(host).selectAll("*").remove();
  const root = d3.select(host);
  for (const tier of TIER_ORDER) {
    const count = tierCounts[tier] || 0;
    const share = total ? count / total : 0;
    const item = root
      .append("div")
      .attr("class", "fyg-cohort__legend-item" + (tier === selectedTier ? " is-selected" : ""));
    item
      .append("span")
      .attr("class", "fyg-cohort__legend-swatch")
      .style("background", TIER_COLORS[tier]);
    item
      .append("span")
      .attr("class", "fyg-cohort__legend-label")
      .text(TIER_LABELS[tier]);
    item
      .append("span")
      .attr("class", "fyg-cohort__legend-count")
      .text(`${d3.format(",")(count)} (${(share * 100).toFixed(1)}%)`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Floor a tiny-but-nonzero share to "<1%" so a single Phenomenon out of 13k
// releases doesn't render as a misleading "0%".
function formatShareLabel(share) {
  if (share <= 0) return "0%";
  const formatted = d3.format(".0%")(share);
  return formatted === "0%" ? "<1%" : formatted;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
