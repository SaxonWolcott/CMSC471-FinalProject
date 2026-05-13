// Scene 4: Find Your Game (capstone).
// Personally-meaningful exploration. The viewer types a Steam game name; the
// scene autocompletes from ~113k games and shows where that game sits in
// its release-year cohort: owner tier, percentile rank, genre context, and a
// pie chart of the year's tier mix with the game's tier shown at full
// opacity (the rest faded) plus a white outline for thin slices.
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

// Filter out adult/explicit titles from the searchable catalog. Word-bounded
// regex so "popcorn" isn't caught by "porn", "hexxen" isn't caught by "xxx",
// etc. Conservative on purpose: better to drop a few borderline titles than
// to surface explicit content from the random button or autocomplete in an
// academic project. Identity terms (gay, queer) and general profanity are
// intentionally NOT in this list.
const VULGAR_PATTERNS = [
  /\bporn\b/i,
  /\bpornography\b/i,
  /\bhentai\b/i,
  /\bnsfw\b/i,
  /\bxxx\b/i,
  /\beroge\b/i,
  /\berotic\b/i,
  /\bfutanari\b/i,
  /\byiff\b/i,
  /\bahegao\b/i,
  /\becchi\b/i,
  /\bbdsm\b/i,
  /\bnudist\b/i,
  /\blewd\b/i,
  /\bhorny\b/i,
  /\borgy\b/i,
  /\borgies\b/i,
  /\bmasturbat\w*/i,
  /\bwaifu\b/i,
  /\bsex\b/i,
  /\bsexy\b/i,
];

function isCleanName(name) {
  const s = String(name || "");
  for (const re of VULGAR_PATTERNS) {
    if (re.test(s)) return false;
  }
  return true;
}
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

  const games = unpack(packed).filter((g) => isCleanName(g.name));
  // Pre-compute lowercase search keys once, not every keystroke.
  for (const g of games) g._search = g.name.toLowerCase();
  // Group by year to make cohort lookups O(1).
  const gamesByYear = d3.group(games, (g) => g.year);
  // Per-year aggregates the narrative callout reads from. Computed once.
  const yearStats = computeYearStats(gamesByYear);

  buildShell(host);
  const searchInput = host.querySelector(".fyg-search__input");
  const resultsList = host.querySelector(".fyg-results");
  const detailHost = host.querySelector(".fyg-detail");
  const suggestionsHost = host.querySelector(".fyg-suggestions");
  const scatterHost = host.querySelector(".fyg-scatter");

  let lastQuery = "";

  // Single source of truth for "user picked a game." Search-result clicks,
  // suggestion chips, the random button, and scatter-dot clicks all funnel
  // here so the detail card, cohort pie, search box, and scatter highlight
  // stay in sync.
  const pickGame = (game) => {
    searchInput.value = game.name;
    lastQuery = game.name;
    resultsList.hidden = true;
    renderDetail(detailHost, game, gamesByYear, yearStats, scatter);
    scatter.setYear(game.year);
    scatter.setSelected(game.appId);
  };

  // Initial empty state plus quick-pick suggestion chips and a Random button.
  renderEmpty(detailHost);
  const pickByName = (name) => {
    // The text-search match might find a different game than `name` exactly
    // (e.g., disambiguation by ownership rank), so route through search →
    // first result for parity with what the user would see typing.
    searchInput.value = name;
    searchInput.dispatchEvent(new Event("input"));
    setTimeout(() => {
      const first = resultsList.querySelector(".fyg-result");
      if (first) first.click();
    }, 0);
  };
  const pickRandom = () => {
    // Random within games that have a measurable owner estimate (skip
    // SteamSpy "no data" entries so the user doesn't keep rolling blanks).
    const candidates = games.filter((g) => g.ownersMid > 0);
    if (!candidates.length) return;
    pickGame(candidates[Math.floor(Math.random() * candidates.length)]);
  };
  renderSuggestions(suggestionsHost, SUGGESTIONS, pickByName, pickRandom);

  // Cohort scatter — defaults to 2025; clicking a dot fully picks that game.
  const scatter = createCohortScatter(scatterHost, gamesByYear, pickGame);
  scatter.setYear(2025);

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
    renderResults(resultsList, matches, pickGame);
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
  // dateString format matches the pipeline's d3.timeFormat("%b %-d, %Y") output.
  const parseDate = d3.timeParse("%b %-d, %Y");
  return rows.map((row) => {
    const dateString = row[idx.dateString] || "";
    const positive = row[idx.positive] || 0;
    const negative = row[idx.negative] || 0;
    const reviewCount = positive + negative;
    const ratio = reviewCount > 0 ? positive / reviewCount : 0;
    return {
      appId: row[idx.appId],
      name: row[idx.name],
      year: row[idx.year],
      dateString,
      // Pre-parse so the scatter doesn't re-parse 113k strings on every render.
      // Falls back to Jan 1 of the year so games with month-only or year-only
      // source dates still land somewhere valid (they cluster at year-start —
      // a known data quirk, not a bug).
      dateParsed: parseDate(dateString) || new Date(row[idx.year], 0, 1),
      ownersMid: row[idx.ownersMid],
      tier: row[idx.tier],
      isIndie: row[idx.isIndie] === 1,
      genres: row[idx.genres] ? String(row[idx.genres]).split(",") : [],
      // Tags joined with `|` in the pipeline (commas appear inside tag names
      // like "Match 3" and would corrupt a comma-split).
      tags: row[idx.tags] ? String(row[idx.tags]).split("|") : [],
      positive,
      negative,
      avgPlaytimeMin: row[idx.avgPlaytimeMin] || 0,
      peakCcu: row[idx.peakCcu] || 0,
      windows: row[idx.windows] === 1,
      mac: row[idx.mac] === 1,
      linux: row[idx.linux] === 1,
      developer: row[idx.developer] || "",
      // Cache the Steam-style sentiment label so the review filter doesn't
      // recompute it for 17k games per filter change.
      sentiment: ratingSentiment(ratio, reviewCount).label,
    };
  });
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
    <div class="fyg-scatter"></div>
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

function renderSuggestions(host, names, onPick, onRandom) {
  host.innerHTML =
    `<span class="fyg-suggestions__label">Try:</span>` +
    names
      .map(
        (n) =>
          `<button type="button" class="fyg-suggestion" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`,
      )
      .join("") +
    `<span class="fyg-suggestions__divider">or</span>` +
    `<button type="button" class="fyg-suggestion fyg-suggestion--random">🎲 Random</button>`;
  host.querySelectorAll(".fyg-suggestion[data-name]").forEach((btn) => {
    btn.addEventListener("click", () => onPick(btn.dataset.name));
  });
  const randomBtn = host.querySelector(".fyg-suggestion--random");
  if (randomBtn) randomBtn.addEventListener("click", onRandom);
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

function renderDetail(host, game, gamesByYear, yearStats, scatter) {
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
  const drownedShare = cohortSize ? (tierCounts.drowned || 0) / cohortSize : 0;

  // Headline phrasing — describes the game's position in plain language.
  // Drowned games use the drowned-share specifically (saying "100% of releases
  // are at or above drowned" is tautological and reads as nonsense to the user
  // — drowning is the floor, everything is at or above it). Non-drowned games
  // use at-or-above share since that genuinely measures rarity.
  const tierLabel = TIER_LABELS[game.tier];
  const positionPhrase =
    game.tier === "drowned"
      ? `${tierLabel} — alongside ${formatShareLabel(drownedShare)} of ${game.year} releases in the smallest SteamSpy bucket.`
      : `${tierLabel} — ${formatShareLabel(atOrAboveShare)} of ${game.year} releases reached this tier or higher.`;

  const ownersLabel =
    game.ownersMid > 0
      ? `~${d3.format(",")(game.ownersMid)} (SteamSpy estimate)`
      : "no SteamSpy estimate available";
  // Genres render as inline clickable spans so a single click drills the
  // scatter's genre filter to just that genre (and likewise for tag chips
  // below). Empty list shows an em-dash.
  const genreMarkup = game.genres.length
    ? game.genres
        .map(
          (g) =>
            `<button type="button" class="fyg-card__genre" data-genre="${escapeHtml(g)}" title="Filter scatter to ${escapeHtml(g)}">${escapeHtml(g)}</button>`,
        )
        .join(", ")
    : "—";
  const dateLabel = game.dateString || String(game.year);

  const reviewTotal = game.positive + game.negative;
  const reviewRatio = reviewTotal > 0 ? game.positive / reviewTotal : 0;
  const reviewSentiment = ratingSentiment(reviewRatio, reviewTotal);
  const reviewValue =
    reviewTotal > 0
      ? `
        <span class="fyg-rating fyg-rating--${reviewSentiment.tone}">${reviewSentiment.label}</span>
        <span class="fyg-rating__count">— ${(reviewRatio * 100).toFixed(0)}% of ${d3.format(",")(reviewTotal)}</span>
        <span class="fyg-rating-bar" aria-hidden="true">
          <span class="fyg-rating-bar__fill fyg-rating-bar__fill--${reviewSentiment.tone}" style="width:${(reviewRatio * 100).toFixed(1)}%"></span>
        </span>
      `
      : `<span class="fyg-stat__value--muted">No user reviews recorded</span>`;

  // The data ships up to 10 tags per game so deep tags (Open World, Sandbox,
  // etc.) are filterable; cap the visible chips at 5 to keep the card compact.
  const displayTags = game.tags.slice(0, 5);
  const tagsBlock = displayTags.length
    ? `
      <div class="fyg-tags" aria-label="Top community tags">
        ${displayTags
          .map(
            (t) =>
              `<button type="button" class="fyg-tag" data-tag="${escapeHtml(t)}" title="Filter scatter to ${escapeHtml(t)}">${escapeHtml(t)}</button>`,
          )
          .join("")}
      </div>
    `
    : "";

  // Three platform pills, supported ones colored, unsupported muted. Always
  // shown all three so the eye reads "Win+Mac+Linux" or "Win-only" at a glance.
  const platforms = [
    { code: "win", label: "Win", supported: game.windows },
    { code: "mac", label: "Mac", supported: game.mac },
    { code: "linux", label: "Linux", supported: game.linux },
  ];
  const platformsBlock = `
    <div class="fyg-platforms" aria-label="Platform support">
      ${platforms
        .map(
          (p) =>
            `<span class="fyg-platform${p.supported ? " is-supported" : ""}" title="${p.label}${p.supported ? " supported" : " not supported"}">${p.label}</span>`,
        )
        .join("")}
    </div>
  `;

  const developerBlock = game.developer
    ? `<span class="fyg-card__developer">${escapeHtml(game.developer)}</span>`
    : "";

  const storeUrl = `https://store.steampowered.com/app/${encodeURIComponent(game.appId)}/`;

  // Narrative callout — sits under the image and ties the picked game to the
  // platform-history eras Scenes 1 and 3 already established. Same three stats
  // every time so the user learns to read it consistently.
  const yearStat = yearStats[game.year] || { total: 0, indieShare: 0, drownedShare: 0 };
  const narrativeHtml = `
    <div class="fyg-card__narrative">
      <div class="fyg-card__narrative-era">${game.year} — ${escapeHtml(eraContext(game.year))}</div>
      <div class="fyg-card__narrative-stats">
        <strong>${d3.format(",")(yearStat.total)}</strong> releases
        <span class="fyg-card__narrative-sep">·</span>
        <strong>${formatShareLabel(yearStat.indieShare)}</strong> Indie
        <span class="fyg-card__narrative-sep">·</span>
        <strong>${formatShareLabel(yearStat.drownedShare)}</strong> Drowned
      </div>
    </div>
  `;

  host.innerHTML = `
    <div class="fyg-card">
      <img
        class="fyg-card__image"
        src="${steamHeaderUrl(game.appId)}"
        alt=""
        loading="lazy"
        onerror="this.classList.add('is-hidden')"
      />
      <div class="fyg-card__content">
        <div class="fyg-card__header">
          <div class="fyg-card__title-row">
            <h3 class="fyg-card__name">${escapeHtml(game.name)}</h3>
            <a class="fyg-card__store-link" href="${storeUrl}" target="_blank" rel="noopener noreferrer">View on Steam <span aria-hidden="true">↗</span></a>
          </div>
          <div class="fyg-card__meta">${escapeHtml(dateLabel)} · ${genreMarkup}${game.isIndie ? " · Indie" : ""}</div>
          <div class="fyg-card__credits">
            ${developerBlock}
            ${platformsBlock}
          </div>
          ${tagsBlock}
        </div>
        <div class="fyg-card__stats">
          <div class="fyg-stat">
            <span class="fyg-stat__label">Estimated owners</span>
            <span class="fyg-stat__value">${escapeHtml(ownersLabel)}</span>
          </div>
          <div class="fyg-stat">
            <span class="fyg-stat__label">
              Tier in ${game.year}
              <span class="fyg-stat__tier-swatch" style="background:${TIER_COLORS[game.tier]}" aria-hidden="true"></span>
            </span>
            <span class="fyg-stat__value">${escapeHtml(positionPhrase)}</span>
          </div>
          <div class="fyg-stat">
            <span class="fyg-stat__label">Steam reviews</span>
            <span class="fyg-stat__value">${reviewValue}</span>
          </div>
          <div class="fyg-stat">
            <span class="fyg-stat__label">Recent daily peak</span>
            <span class="fyg-stat__value">${d3.format(",")(game.peakCcu)}</span>
          </div>
          <div class="fyg-stat">
            <span class="fyg-stat__label">Avg. playtime</span>
            <span class="fyg-stat__value">${escapeHtml(formatPlaytime(game.avgPlaytimeMin))}</span>
          </div>
        </div>
      </div>
      ${narrativeHtml}
    </div>
  `;

  // Genre/tag chip drill-in: clicking either deselects every other option in
  // its filter dropdown and keeps only the clicked value, so the scatter
  // narrows to games sharing that attribute. setOnly() no-ops if the value
  // isn't part of the filter universe (e.g. a per-game tag below the global
  // top-50), so rare chips just don't trigger anything.
  if (scatter) {
    host.querySelectorAll(".fyg-card__genre").forEach((el) => {
      el.addEventListener("click", () => scatter.genreFilter.setOnly(el.dataset.genre));
    });
    host.querySelectorAll(".fyg-tag").forEach((el) => {
      el.addEventListener("click", () => scatter.tagFilter.setOnly(el.dataset.tag));
    });
  }
}

// ---------------------------------------------------------------------------
// Cohort scatter
// ---------------------------------------------------------------------------
//
// Below the detail card: every game released in a given year as a dot.
//   x = release date within the year (Jan → Dec)
//   y = owner tier band (phenomenon at top, drowned at bottom)
// Defaults to 2025; switches to whatever year the user picks. Hover surfaces
// a tooltip via d3.quadtree spatial lookup (avoids putting pointer-events on
// 17k circles); click fully picks that game.

// Drowned holds ~95% of releases in recent years so it gets the lion's share
// of the chart's vertical space; the rare-tier bands shrink toward the top.
// Sums to 1.0.
const TIER_BAND_FRACTIONS = {
  phenomenon: 0.06,
  hit: 0.10,
  modest: 0.16,
  niche: 0.18,
  drowned: 0.50,
};
const TIER_BAND_TOP_TO_BOTTOM = ["phenomenon", "hit", "modest", "niche", "drowned"];

// Steam-style review sentiment buckets, in display order (positive → negative,
// "No reviews" last). Mirrors the labels ratingSentiment() returns and drives
// the Reviews filter dropdown.
const RATING_SENTIMENTS = [
  "Overwhelmingly Positive",
  "Very Positive",
  "Positive",
  "Mostly Positive",
  "Mixed",
  "Mostly Negative",
  "Negative",
  "Very Negative",
  "Overwhelmingly Negative",
  "No reviews",
];

function createCohortScatter(host, gamesByYear, onPickGame) {
  d3.select(host).selectAll("*").remove();

  host.innerHTML = `
    <div class="fyg-scatter__header">
      <div class="fyg-scatter__title"></div>
      <div class="fyg-scatter__controls">
        <div class="fyg-scatter__view-toggle" role="group" aria-label="View mode">
          <button type="button" class="fyg-scatter__view-btn is-active" data-view="single">Single year</button>
          <button type="button" class="fyg-scatter__view-btn" data-view="all">All years</button>
        </div>
        <div class="fyg-scatter__year-picker">
          <span class="fyg-scatter__year-label">Year:</span>
          <button type="button" class="fyg-scatter__year-step" data-step="prev" aria-label="Previous year">◀</button>
          <select class="fyg-scatter__year-select"></select>
          <button type="button" class="fyg-scatter__year-step" data-step="next" aria-label="Next year">▶</button>
        </div>
        <div class="fyg-scatter__filter-slot" data-slot="genre"></div>
        <div class="fyg-scatter__filter-slot" data-slot="tags"></div>
        <div class="fyg-scatter__filter-slot" data-slot="reviews"></div>
      </div>
    </div>
    <div class="fyg-scatter__timeline"></div>
    <div class="fyg-scatter__chart"></div>
    <div class="fyg-scatter__hint">Hover a dot to see the game · click to pick it · ← → to step years</div>
  `;
  const titleEl = host.querySelector(".fyg-scatter__title");
  const chartHost = host.querySelector(".fyg-scatter__chart");
  const timelineHost = host.querySelector(".fyg-scatter__timeline");
  const yearSelect = host.querySelector(".fyg-scatter__year-select");
  const yearPicker = host.querySelector(".fyg-scatter__year-picker");
  const prevBtn = host.querySelector('[data-step="prev"]');
  const nextBtn = host.querySelector('[data-step="next"]');
  const viewBtns = host.querySelectorAll(".fyg-scatter__view-btn");
  const genreSlot = host.querySelector('[data-slot="genre"]');
  const tagSlot = host.querySelector('[data-slot="tags"]');
  const reviewSlot = host.querySelector('[data-slot="reviews"]');

  // Populate year selector with the years that actually have data, descending
  // so the most recent year sits at the top of the menu. 2026 is excluded —
  // the snapshot only captures ~84 games for it, which renders as a near-empty
  // scatter with no visual story.
  const availableYears = [...gamesByYear.keys()]
    .filter((y) => y < 2026)
    .sort((a, b) => b - a);
  const supportedYearSet = new Set(availableYears);
  for (const y of availableYears) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
  yearSelect.addEventListener("change", () => {
    setYear(parseInt(yearSelect.value, 10));
  });

  // Mini-timeline strip above the chart: 2004-2025 axis with Greenlight and
  // Direct annotations matching Scenes 1 and 3, plus a highlight at the
  // currently-viewed year. Clicking a year jumps there and forces single-year
  // mode (the click expresses intent to view that year specifically).
  const timelineApi = createTimeline(timelineHost, availableYears, (year) => {
    setMode("single");
    setYear(year);
  });

  // Prev/Next year navigation. availableYears is sorted DESCENDING (newest
  // first), so "Prev" (older) means index + 1 and "Next" (newer) is idx - 1.
  prevBtn.addEventListener("click", () => stepYear(+1));
  nextBtn.addEventListener("click", () => stepYear(-1));

  function stepYear(delta) {
    if (mode !== "single") return;
    const idx = availableYears.indexOf(currentYear);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= availableYears.length) return;
    setYear(availableYears[target]);
  }

  // Keyboard ←/→ steps the year. Skipped while the user is typing in any
  // input/textarea (search, year dropdown, etc.) so we don't hijack typing.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const t = event.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (mode !== "single") return;
    stepYear(event.key === "ArrowLeft" ? +1 : -1);
  });

  // View toggle: single year vs all years on one timeline.
  for (const btn of viewBtns) {
    btn.addEventListener("click", () => setMode(btn.dataset.view));
  }

  // Genre + tag filter options. Walk every game once to build the universe of
  // values, ranked by frequency so common ones come first in the dropdowns.
  // Genres are limited (~30 unique) so we ship the full list; tags are huge
  // (~500 unique) so we cap to the top 30 — covers the meaningfully-filterable
  // labels without an unwieldy dropdown.
  const { allGenres, topTags } = (() => {
    const genreCounts = new Map();
    const tagCounts = new Map();
    for (const arr of gamesByYear.values()) {
      for (const g of arr) {
        for (const ge of g.genres) genreCounts.set(ge, (genreCounts.get(ge) || 0) + 1);
        for (const tg of g.tags) tagCounts.set(tg, (tagCounts.get(tg) || 0) + 1);
      }
    }
    const sortByCountDesc = (a, b) => b[1] - a[1];
    return {
      allGenres: [...genreCounts.entries()].sort(sortByCountDesc).map((e) => e[0]),
      // ALL unique tags (~446), ranked by global frequency. The chip-click
      // drill-in only works if a tag is in the dropdown's universe, and chip
      // tags span the entire long tail of community labels — so we ship the
      // full set. The dropdown's search input keeps it usable at any size.
      topTags: [...tagCounts.entries()].sort(sortByCountDesc).map((e) => e[0]),
    };
  })();

  // Filter state lives on the controllers; all default to "all selected"
  // (filter inactive). Render() reads these via getSelected().
  const genreFilter = createFilterDropdown(genreSlot, "Genre", allGenres, () => render());
  const tagFilter = createFilterDropdown(tagSlot, "Tags", topTags, () => render());
  const reviewFilter = createFilterDropdown(reviewSlot, "Reviews", RATING_SENTIMENTS, () => render());

  function passesFilters(game) {
    // A filter is "active" only when not every option is selected. When
    // active, a game passes iff at least one of its values is in the
    // selected set — inclusion semantics. Games with empty genres/tags
    // fail an active filter, which only happens during cleaning anomalies.
    const gSel = genreFilter.getSelected();
    if (gSel.size < allGenres.length) {
      if (!game.genres.some((v) => gSel.has(v))) return false;
    }
    const tSel = tagFilter.getSelected();
    if (tSel.size < topTags.length) {
      if (!game.tags.some((v) => tSel.has(v))) return false;
    }
    const rSel = reviewFilter.getSelected();
    if (rSel.size < RATING_SENTIMENTS.length) {
      if (!rSel.has(game.sentiment)) return false;
    }
    return true;
  }

  const tooltip = document.createElement("div");
  tooltip.className = "fyg-scatter-tooltip";
  tooltip.hidden = true;
  host.appendChild(tooltip);

  const margin = { top: 14, right: 24, bottom: 26, left: 88 };
  const hostRect = chartHost.getBoundingClientRect();
  const width = Math.max(hostRect.width, 360);
  const height = 540;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Compute pixel y-bounds for each tier band, top-to-bottom.
  const bands = (() => {
    const out = {};
    let cursor = 0;
    for (const tier of TIER_BAND_TOP_TO_BOTTOM) {
      const h = TIER_BAND_FRACTIONS[tier] * innerHeight;
      out[tier] = { y0: cursor, y1: cursor + h, height: h };
      cursor += h;
    }
    return out;
  })();

  const svg = d3
    .select(chartHost)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", "100%")
    .attr("height", height)
    .attr("role", "img")
    .attr(
      "aria-label",
      "Scatter of every game released in the selected year, positioned by date and owner tier",
    );

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Darker chart-area background. The Drowned tier color (#3a5570) is too
  // close to the panel's elevated bg (#2a3f5a) to read as visible dots; sitting
  // them on --bg-deep instead gives every tier color a clean contrast edge.
  g.append("rect")
    .attr("class", "fyg-scatter__plot-bg")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerWidth)
    .attr("height", innerHeight);

  // Tier-band separator lines + tier labels on the left, drawn once.
  const labelsGroup = g.append("g").attr("class", "fyg-scatter__y-labels");
  for (const tier of TIER_BAND_TOP_TO_BOTTOM) {
    const band = bands[tier];
    labelsGroup
      .append("line")
      .attr("class", "fyg-scatter__band-line")
      .attr("x1", 0)
      .attr("x2", innerWidth)
      .attr("y1", band.y1)
      .attr("y2", band.y1);
    labelsGroup
      .append("text")
      .attr("class", "fyg-scatter__y-label")
      .attr("x", -10)
      .attr("y", (band.y0 + band.y1) / 2)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("fill", TIER_COLORS[tier])
      .text(TIER_LABELS[tier]);
  }

  const xAxisGroup = g
    .append("g")
    .attr("class", "axis axis--x fyg-scatter__x-axis")
    .attr("transform", `translate(0,${innerHeight})`);

  const dotsLayer = g.append("g").attr("class", "fyg-scatter__dots");

  // Selected-game marker — a hollow white circle drawn above the dots.
  // pointer-events:none so it never blocks hit-testing for the underlying dot.
  const highlight = g
    .append("circle")
    .attr("class", "fyg-scatter__highlight")
    .attr("r", 6)
    .attr("fill", "none")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 2)
    .attr("pointer-events", "none")
    .attr("display", "none");

  // Single transparent overlay catches all hover/click events; we look up the
  // nearest dot via a quadtree built from the rendered positions. Same hover
  // pattern Scene 2 uses, so per-circle handlers don't have to fire across
  // 17k DOM nodes.
  const overlay = g
    .append("rect")
    .attr("class", "fyg-scatter__overlay")
    .attr("width", innerWidth)
    .attr("height", innerHeight)
    .attr("fill", "transparent");

  let xScale = null;
  let positioned = [];
  let quadtree = null;
  let selectedAppId = null;
  let currentYear = null;
  let mode = "single"; // "single" | "all"

  function setMode(next) {
    if (next !== "single" && next !== "all") return;
    if (next === mode) return;
    mode = next;
    for (const btn of viewBtns) {
      btn.classList.toggle("is-active", btn.dataset.view === mode);
    }
    updateNavState();
    render();
  }

  // Year picker + Prev/Next disabled state, refreshed every time mode or
  // currentYear changes. Visual disabling lives in CSS (.is-disabled / [disabled]).
  function updateNavState() {
    const allYears = mode === "all";
    yearPicker.classList.toggle("is-disabled", allYears);
    yearSelect.disabled = allYears;
    if (allYears) {
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }
    const idx = availableYears.indexOf(currentYear);
    // availableYears is DESCENDING (2025 → 2004): idx=0 is newest.
    nextBtn.disabled = idx <= 0;
    prevBtn.disabled = idx >= availableYears.length - 1;
  }

  function setYear(year) {
    // Picking a 2026 game (or any unsupported year) leaves the scatter where
    // it is — the selected highlight just won't show, since the picked game
    // isn't in the rendered cohort. Better than rendering an 84-dot wasteland.
    if (!supportedYearSet.has(year)) return;
    if (year === currentYear) return;
    currentYear = year;
    if (yearSelect.value !== String(year)) yearSelect.value = String(year);
    updateNavState();
    timelineApi.setHighlight(year);
    if (mode === "single") render();
  }

  function render() {
    if (currentYear == null) return;
    const allYears = mode === "all";

    // Source cohort + x-axis domain depend on mode. Single-year mode reads
    // the picked year's group; all-years mode flattens every supported year
    // (excludes 2026 since availableYears already filters it).
    let cohort;
    let xDomain;
    let xTicks;
    let xTickFormat;
    if (allYears) {
      cohort = [];
      for (const y of availableYears) {
        const arr = gamesByYear.get(y);
        if (arr) for (const g of arr) cohort.push(g);
      }
      const minY = availableYears[availableYears.length - 1];
      const maxY = availableYears[0];
      xDomain = [new Date(Date.UTC(minY, 0, 1)), new Date(Date.UTC(maxY, 11, 31))];
      xTicks = d3.timeYear.every(2);
      xTickFormat = d3.timeFormat("%Y");
    } else {
      cohort = gamesByYear.get(currentYear) || [];
      xDomain = [new Date(Date.UTC(currentYear, 0, 1)), new Date(Date.UTC(currentYear, 11, 31))];
      xTicks = d3.timeMonth.every(2);
      xTickFormat = d3.timeFormat("%b");
    }
    const games = cohort.filter(passesFilters);

    const filterActive =
      genreFilter.getSelected().size < allGenres.length ||
      tagFilter.getSelected().size < topTags.length ||
      reviewFilter.getSelected().size < RATING_SENTIMENTS.length;
    const fmt = (n) => d3.format(",")(n);
    let title;
    if (games.length === 0) {
      title = allYears
        ? "No matches in any year — try widening filters."
        : `No matches in ${currentYear} — try widening filters.`;
    } else if (allYears) {
      const minY = availableYears[availableYears.length - 1];
      const maxY = availableYears[0];
      title = filterActive
        ? `${minY}–${maxY} — ${fmt(games.length)} of ${fmt(cohort.length)} games match`
        : `Every game released ${minY}–${maxY} — ${fmt(games.length)} games`;
    } else {
      title = filterActive
        ? `${currentYear} — ${fmt(games.length)} of ${fmt(cohort.length)} games match`
        : `Every game released in ${currentYear} — ${fmt(games.length)} games`;
    }
    titleEl.textContent = title;

    xScale = d3.scaleTime().domain(xDomain).range([0, innerWidth]);
    xAxisGroup
      .call(
        d3
          .axisBottom(xScale)
          .ticks(xTicks)
          .tickFormat(xTickFormat)
          .tickSize(0),
      )
      .call((sel) => sel.select(".domain").remove())
      .call((sel) => sel.selectAll(".tick text").attr("dy", "1em"));

    // Position each (filtered) game once and cache (game, x, y) so the
    // quadtree, the dot bind, and the highlight lookup all read from the
    // same source.
    positioned = games.map((g) => {
      const band = bands[g.tier];
      const innerBandH = Math.max(band.height - 4, 1);
      const y = band.y0 + 2 + jitter(g.appId, innerBandH);
      return { game: g, x: xScale(g.dateParsed), y };
    });

    // Bind dots — keyed by appId so identity persists across filter toggles
    // (avoids re-creating circles for games that survive a filter change).
    const sel = dotsLayer
      .selectAll("circle")
      .data(positioned, (d) => d.game.appId);
    sel.exit().remove();
    const enter = sel
      .enter()
      .append("circle")
      .attr("r", 2.2);
    enter
      .merge(sel)
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("fill", (d) => TIER_COLORS[d.game.tier])
      .attr("fill-opacity", 0.85);

    quadtree = d3
      .quadtree()
      .x((d) => d.x)
      .y((d) => d.y)
      .addAll(positioned);

    updateHighlight();
  }

  function setSelected(appId) {
    selectedAppId = appId;
    updateHighlight();
  }

  function updateHighlight() {
    const found = positioned.find((p) => p.game.appId === selectedAppId);
    if (found) {
      highlight
        .attr("cx", found.x)
        .attr("cy", found.y)
        .attr("display", null)
        .raise();
    } else {
      highlight.attr("display", "none");
    }
  }

  overlay
    .on("mousemove", function (event) {
      if (!quadtree) return;
      const [mx, my] = d3.pointer(event);
      const found = quadtree.find(mx, my, 12);
      if (found) {
        overlay.style("cursor", "pointer");
        showScatterTooltip(tooltip, host, chartHost, found.x, found.y, found.game, margin);
      } else {
        overlay.style("cursor", "default");
        tooltip.hidden = true;
      }
    })
    .on("mouseleave", () => {
      tooltip.hidden = true;
      overlay.style("cursor", "default");
    })
    .on("click", function (event) {
      if (!quadtree) return;
      const [mx, my] = d3.pointer(event);
      const found = quadtree.find(mx, my, 12);
      if (found) onPickGame(found.game);
    });

  return { setYear, setSelected, genreFilter, tagFilter };
}

// Mini-timeline strip rendered above the cohort scatter. Visual frame for the
// scatter — shows where the picked year sits in Steam history, with the same
// Greenlight (2012) and Direct (2017) annotations Scenes 1 and 3 use, so the
// eras stay visually anchored across the page. Clicking a year invokes
// onClickYear; the parent uses that to switch the scatter to that year.
function createTimeline(host, availableYears, onClickYear) {
  d3.select(host).selectAll("*").remove();

  // availableYears is sorted DESCENDING (2025 → 2004); pull min/max from ends.
  const minY = availableYears[availableYears.length - 1];
  const maxY = availableYears[0];
  const yearSet = new Set(availableYears);

  // Match the chart's measure-then-fix sizing pattern. The strip lives at full
  // container width; getBoundingClientRect is reliable here since the host is
  // already in the DOM by the time createTimeline runs.
  const hostRect = host.getBoundingClientRect();
  const width = Math.max(hostRect.width, 600);
  const height = 60;
  const margin = { top: 22, right: 28, bottom: 16, left: 28 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = d3
    .scaleLinear()
    .domain([minY - 0.5, maxY + 0.5])
    .range([0, innerW]);
  const centerY = innerH / 2;

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", height)
    .attr("preserveAspectRatio", "none")
    .attr("role", "img")
    .attr(
      "aria-label",
      `Release-year timeline from ${minY} to ${maxY}; click any year to view it`,
    );

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Center axis line — runs the full width of the year domain.
  g.append("line")
    .attr("class", "fyg-timeline__axis")
    .attr("x1", 0)
    .attr("x2", innerW)
    .attr("y1", centerY)
    .attr("y2", centerY);

  // Greenlight + Direct dashed verticals + labels. Same eras as Scenes 1/3.
  const annotations = [
    { year: 2012, label: "Greenlight" },
    { year: 2017, label: "Direct" },
  ];
  for (const a of annotations) {
    const x = xScale(a.year);
    g.append("line")
      .attr("class", "fyg-timeline__annotation-line")
      .attr("x1", x)
      .attr("x2", x)
      .attr("y1", -8)
      .attr("y2", innerH);
    g.append("text")
      .attr("class", "fyg-timeline__annotation-label")
      .attr("x", x)
      .attr("y", -10)
      .attr("text-anchor", "middle")
      .text(a.label);
  }

  // One small tick per available year along the axis.
  for (const y of availableYears) {
    g.append("line")
      .attr("class", "fyg-timeline__year-tick")
      .attr("x1", xScale(y))
      .attr("x2", xScale(y))
      .attr("y1", centerY - 3)
      .attr("y2", centerY + 3);
  }

  // Endpoint year labels (anchors) — hidden when the highlight sits over them
  // so the highlight's label gets the slot without overlap.
  const endpointMin = g
    .append("text")
    .attr("class", "fyg-timeline__year-label")
    .attr("x", xScale(minY))
    .attr("y", innerH + 12)
    .attr("text-anchor", "middle")
    .text(String(minY));
  const endpointMax = g
    .append("text")
    .attr("class", "fyg-timeline__year-label")
    .attr("x", xScale(maxY))
    .attr("y", innerH + 12)
    .attr("text-anchor", "middle")
    .text(String(maxY));

  // Highlight group — vertical bar plus year label below the axis.
  const highlight = g
    .append("g")
    .attr("class", "fyg-timeline__highlight")
    .style("display", "none");
  highlight
    .append("line")
    .attr("class", "fyg-timeline__highlight-bar")
    .attr("y1", centerY - 8)
    .attr("y2", centerY + 8);
  highlight
    .append("text")
    .attr("class", "fyg-timeline__highlight-label")
    .attr("y", innerH + 12)
    .attr("text-anchor", "middle");

  // Single transparent overlay catches clicks across the whole strip; we
  // invert the x-scale to figure out which year was clicked. Same one-rect
  // pattern the scatter uses for hit-testing.
  const overlay = g
    .append("rect")
    .attr("class", "fyg-timeline__overlay")
    .attr("x", 0)
    .attr("y", -8)
    .attr("width", innerW)
    .attr("height", innerH + 16)
    .attr("fill", "transparent");

  overlay.on("click", function (event) {
    const [mx] = d3.pointer(event);
    const year = Math.round(xScale.invert(mx));
    if (yearSet.has(year)) onClickYear(year);
  });

  function setHighlight(year) {
    if (year == null || !yearSet.has(year)) {
      highlight.style("display", "none");
      endpointMin.style("display", null);
      endpointMax.style("display", null);
      return;
    }
    const x = xScale(year);
    highlight.select(".fyg-timeline__highlight-bar").attr("x1", x).attr("x2", x);
    highlight
      .select(".fyg-timeline__highlight-label")
      .attr("x", x)
      .text(String(year));
    highlight.style("display", null);
    // Hide whichever endpoint label sits at the highlighted year so the two
    // texts don't draw on top of each other.
    endpointMin.style("display", year === minY ? "none" : null);
    endpointMax.style("display", year === maxY ? "none" : null);
  }

  return { setHighlight };
}

// Reusable button-with-dropdown filter. Returns a controller that exposes
// getSelected() — a Set of currently-checked options. Each panel starts
// fully checked (filter inactive); the parent's onChange fires every time the
// selection mutates so the scatter can re-render. Click outside the wrapper
// closes the panel.
function createFilterDropdown(host, label, options, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "fyg-filter";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "fyg-filter__toggle";
  wrap.appendChild(button);

  const panel = document.createElement("div");
  panel.className = "fyg-filter__panel";
  panel.hidden = true;

  const actions = document.createElement("div");
  actions.className = "fyg-filter__actions";
  const selectAllBtn = document.createElement("button");
  selectAllBtn.type = "button";
  selectAllBtn.className = "fyg-filter__action";
  selectAllBtn.textContent = "Select all";
  const deselectAllBtn = document.createElement("button");
  deselectAllBtn.type = "button";
  deselectAllBtn.className = "fyg-filter__action";
  deselectAllBtn.textContent = "Deselect all";
  actions.append(selectAllBtn, deselectAllBtn);
  panel.appendChild(actions);

  // Search input: hides non-matching options on input. Doesn't change
  // selection state — it's purely a visibility filter so a 446-tag list
  // stays usable. Persists across opens (we don't clear on close).
  const search = document.createElement("input");
  search.type = "search";
  search.className = "fyg-filter__search";
  search.placeholder = `Search ${label.toLowerCase()}…`;
  search.autocomplete = "off";
  panel.appendChild(search);

  const list = document.createElement("ul");
  list.className = "fyg-filter__options";
  panel.appendChild(list);

  wrap.appendChild(panel);
  host.appendChild(wrap);

  const selected = new Set(options);
  const inputs = new Map();
  const items = new Map();

  for (const opt of options) {
    const li = document.createElement("li");
    const lbl = document.createElement("label");
    lbl.className = "fyg-filter__option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.addEventListener("change", () => {
      if (input.checked) selected.add(opt);
      else selected.delete(opt);
      updateButton();
      onChange(selected);
    });
    const span = document.createElement("span");
    span.textContent = opt;
    lbl.append(input, span);
    li.appendChild(lbl);

    // Hover-revealed "only" button — collapses the filter to just this
    // option, same drill-in semantics as the detail-card chips use. Hidden
    // by default via opacity:0 so unhovered rows stay quiet, then fades in
    // on row hover (and on keyboard focus inside the row via :focus-within).
    const onlyBtn = document.createElement("button");
    onlyBtn.type = "button";
    onlyBtn.className = "fyg-filter__only";
    onlyBtn.textContent = "only";
    onlyBtn.title = `Show only ${opt}`;
    onlyBtn.addEventListener("click", (event) => {
      // The row's label is a sibling, not a parent, so a label-click wouldn't
      // be triggered here regardless — but stop propagation defensively so the
      // panel's document-level outside-click handler never sees this.
      event.preventDefault();
      event.stopPropagation();
      setOnly(opt);
    });
    li.appendChild(onlyBtn);

    list.appendChild(li);
    inputs.set(opt, input);
    items.set(opt, li);
  }

  // Hide list items whose label doesn't substring-match the query.
  // Selection state is unaffected — this is a visibility-only filter.
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    for (const [opt, li] of items) {
      li.hidden = q !== "" && !opt.toLowerCase().includes(q);
    }
  });

  function applyAll(value) {
    selected.clear();
    if (value) for (const o of options) selected.add(o);
    for (const inp of inputs.values()) inp.checked = value;
    updateButton();
    onChange(selected);
  }
  selectAllBtn.addEventListener("click", () => applyAll(true));
  deselectAllBtn.addEventListener("click", () => applyAll(false));

  function updateButton() {
    const n = selected.size;
    const total = options.length;
    let summary;
    if (n === total) summary = "All";
    else if (n === 0) summary = "None";
    else summary = `${n} of ${total}`;
    button.textContent = `${label}: ${summary} ▾`;
  }
  updateButton();

  // Toggle on button click. We deliberately let the click bubble to the
  // document so OTHER filter dropdowns' document-level listeners fire and
  // close their panels — that's the auto-close-siblings behavior. The
  // document handler for THIS dropdown sees its own button as inside `wrap`
  // and leaves the panel alone (i.e. doesn't immediately re-close it).
  button.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  // Stop clicks INSIDE the panel from bubbling so checkbox / select-all /
  // search-input interactions don't trigger the document handler and close
  // the panel mid-interaction.
  panel.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) panel.hidden = true;
  });

  // Drill-in helper used by the detail card chips: clicking a genre or tag
  // collapses the filter to just that one option (deselecting the rest).
  // No-ops silently if the value isn't part of the filter's universe (e.g.
  // a niche per-game tag that didn't make the global top-50).
  function setOnly(value) {
    if (!inputs.has(value)) return;
    selected.clear();
    selected.add(value);
    for (const [opt, inp] of inputs) inp.checked = opt === value;
    updateButton();
    onChange(selected);
  }

  return {
    getSelected: () => selected,
    setOnly,
  };
}

// Deterministic jitter from appId — a simple LCG so every render places a
// given game at the same y inside its band (no shuffle on year-change).
function jitter(appId, height) {
  const n = (parseInt(appId, 10) || 0) ^ 0x5a5a5a5a;
  return (((n * 9301 + 49297) >>> 0) % 233280) / 233280 * height;
}

function showScatterTooltip(el, host, chartHost, anchorXInChart, anchorYInChart, game, margin) {
  el.innerHTML = `
    <div class="fyg-scatter-tooltip__name">${escapeHtml(game.name)}</div>
    <div class="fyg-scatter-tooltip__meta">
      <span class="fyg-scatter-tooltip__swatch" style="background:${TIER_COLORS[game.tier]}"></span>
      ${TIER_LABELS[game.tier]} · ${escapeHtml(game.dateString || String(game.year))}
    </div>
  `;

  // Convert chart-space coords → screen-space pixels relative to the host.
  // Position is set before we unhide so the tooltip never flashes at (0,0).
  const svgEl = chartHost.querySelector("svg");
  const chartRect = svgEl.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const viewBox = svgEl.viewBox.baseVal;
  const scale = chartRect.width / viewBox.width;
  const screenX = chartRect.left - hostRect.left + (margin.left + anchorXInChart) * scale;
  const screenY = chartRect.top - hostRect.top + (margin.top + anchorYInChart) * scale;
  el.style.left = `${screenX}px`;
  el.style.top = `${screenY - 10}px`;
  el.style.transform = "translate(-50%, -100%)";
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// One pass over the catalog producing the per-year aggregates the narrative
// callout reads from (total releases, indie share, drowned share). Cheap —
// runs once at scene init.
function computeYearStats(gamesByYear) {
  const stats = {};
  for (const [year, arr] of gamesByYear) {
    let indie = 0;
    let drowned = 0;
    for (const g of arr) {
      if (g.isIndie) indie++;
      if (g.tier === "drowned") drowned++;
    }
    stats[year] = {
      total: arr.length,
      indieShare: arr.length ? indie / arr.length : 0,
      drownedShare: arr.length ? drowned / arr.length : 0,
    };
  }
  return stats;
}

// Express a year in terms of Steam's two big policy turning points: Greenlight
// (community-approved publishing, mid-2012) and Direct ($100 self-publish,
// mid-2017). Matches the dashed annotations in Scenes 1 and 3, so the narrative
// reads as a continuation of the same eras.
function eraContext(year) {
  if (year < 2012) {
    const gap = 2012 - year;
    return `${gap} year${gap === 1 ? "" : "s"} before Steam Greenlight`;
  }
  if (year === 2012) return "the year Steam Greenlight launched";
  if (year < 2017) {
    const gap = year - 2012;
    return `${gap} year${gap === 1 ? "" : "s"} into Steam Greenlight`;
  }
  if (year === 2017) return "the year Steam Direct launched";
  const gap = year - 2017;
  return `${gap} year${gap === 1 ? "" : "s"} into Steam Direct`;
}

// Floor a tiny-but-nonzero share to "<1%" so a single Phenomenon out of 13k
// releases doesn't render as a misleading "0%".
function formatShareLabel(share) {
  if (share <= 0) return "0%";
  const formatted = d3.format(".0%")(share);
  return formatted === "0%" ? "<1%" : formatted;
}

// Steam's verbal rating buckets, simplified. Steam itself splits at slightly
// different thresholds for ≥500 and <500 review pools (e.g. Overwhelmingly
// vs Very); this keeps the same idea with a clearer two-axis (ratio + count)
// rule. Returns { label, tone } so the bar color can match.
function ratingSentiment(ratio, count) {
  if (count === 0) return { label: "No reviews", tone: "muted" };
  if (ratio >= 0.95 && count >= 500) return { label: "Overwhelmingly Positive", tone: "positive-strong" };
  if (ratio >= 0.85 && count >= 50) return { label: "Very Positive", tone: "positive" };
  if (ratio >= 0.80) return { label: "Positive", tone: "positive" };
  if (ratio >= 0.70) return { label: "Mostly Positive", tone: "positive-soft" };
  if (ratio >= 0.40) return { label: "Mixed", tone: "mixed" };
  if (ratio >= 0.20) return { label: "Mostly Negative", tone: "negative" };
  if (count >= 500) return { label: "Overwhelmingly Negative", tone: "negative" };
  if (count >= 50) return { label: "Very Negative", tone: "negative" };
  return { label: "Negative", tone: "negative" };
}

// Steam tracks Average playtime forever in minutes. Formats as: "12 minutes"
// for < 1 hour, "X.X hours" up through 10 hours, then "X hours" rounded.
function formatPlaytime(minutes) {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = minutes / 60;
  if (hours < 10) return `${hours.toFixed(1)} hours`;
  return `${Math.round(hours)} hours`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
