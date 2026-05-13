// Phase 0 build pipeline.
//
// Reads raw_data/games.csv against the canonical 40-column schema (the file's
// own header is malformed — see plan.md "CSV header bug"), filters to actual
// games, parses dates / owners ranges / etc., then runs eleven analyses and
// emits one JSON per analysis into ../data/ along with a markdown summary at
// ../phase0-report.md for review.
//
// Run with: npm run build  (from inside scripts/)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW_CSV = join(ROOT, "raw_data", "games.csv");
const DATA_OUT = join(ROOT, "data");
const REPORT_OUT = join(ROOT, "phase0-report.md");

// Canonical 40-column schema. The file's header is missing a comma between
// Discount and DLC count (39 cols there, 40 cols in every data row). We ignore
// the file's header line entirely and project rows against this list.
const COLUMNS = [
  "AppID", "Name", "Release date", "Estimated owners", "Peak CCU",
  "Required age", "Price", "Discount", "DLC count", "About the game",
  "Supported languages", "Full audio languages", "Reviews",
  "Header image", "Website", "Support url", "Support email",
  "Windows", "Mac", "Linux",
  "Metacritic score", "Metacritic url", "User score",
  "Positive", "Negative", "Score rank", "Achievements",
  "Recommendations", "Notes",
  "Average playtime forever", "Average playtime two weeks",
  "Median playtime forever", "Median playtime two weeks",
  "Developers", "Publishers", "Categories", "Genres", "Tags",
  "Screenshots", "Movies",
];

// Steam release-date strings come in a few shapes. Try them in order.
const DATE_FORMATS = [
  d3.timeParse("%b %d, %Y"), // "Oct 21, 2008"
  d3.timeParse("%d %b, %Y"), // "21 Oct, 2008" (rare)
  d3.timeParse("%b %Y"),     // "Oct 2008"
  d3.timeParse("%Y"),         // "2008"
];

function parseReleaseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  for (const fn of DATE_FORMATS) {
    const d = fn(t);
    if (d) return d;
  }
  return null;
}

function parseOwnersRange(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const lo = +m[1], hi = +m[2];
  return { low: lo, high: hi, mid: Math.round((lo + hi) / 2) };
}

function priceTier(p) {
  const n = +p;
  if (!Number.isFinite(n)) return "unknown";
  if (n === 0) return "free";
  if (n < 5) return "<$5";
  if (n < 20) return "$5-$20";
  return "$20+";
}

function parseBool(s) {
  if (s === true || s === "True" || s === "true") return true;
  if (s === false || s === "False" || s === "false") return false;
  return null;
}

// Genres / Tags / Categories are all comma-delimited in this dataset, despite the plan's
// original guess of semicolon. The CSV correctly double-quote-wraps these so d3.csvParseRows
// returns each as one field; we split here. Tag names may contain spaces ("Match 3", "Hidden
// Object") but not commas, so this is safe.
function splitCommaList(s) {
  if (!s) return [];
  return String(s).split(",").map((x) => x.trim()).filter(Boolean);
}

// "['English', 'French', 'German']" -> ['English','French','German']
function parseLangsList(s) {
  if (!s) return [];
  const inner = String(s).replace(/^\[|\]$/g, "");
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((x) => x.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean);
}

// Owner-tier classification with a confidence floor on each tier.
//
// SteamSpy's owner estimates are based on profile scraping and produce
// occasional wild overcounts — a 2025 release named "CyberCorp" listed at 15M
// owners with 322 reviews, "War Robots: Frontiers" at 35M with 3082 reviews,
// etc. Real Phenomenon-tier games have review-rates of 0.27–5.9% (p10–p99,
// median 1.67%); a 0.05% rate is *5× lower* than the floor of any legitimate
// tier and only catches obvious noise. We translate that into a minimum
// review count per tier and recursively downgrade games that fall under the
// floor for their tier. Drowned has no floor — that's where downgrades land.
//
// We change ONLY the tier classification; ownersMid stays the SteamSpy number
// (labeled "estimate" in the UI), so the displayed owner count is honest
// about what its source said while the tier reflects our own confidence.
const TIER_REVIEW_FLOORS = {
  phenomenon: 5000,
  hit: 500,
  modest: 50,
  niche: 10,
  drowned: 0,
};
const TIER_DOWNGRADE = ["phenomenon", "hit", "modest", "niche", "drowned"];

function correctedTier(g) {
  // Start from the SteamSpy-implied tier.
  let tier;
  if (g.ownersHigh <= 20_000) tier = "drowned";
  else if (g.ownersMid <= 100_000) tier = "niche";
  else if (g.ownersMid <= 1_000_000) tier = "modest";
  else if (g.ownersMid <= 10_000_000) tier = "hit";
  else tier = "phenomenon";

  const reviews = (g.positive || 0) + (g.negative || 0);
  while (tier !== "drowned" && reviews < TIER_REVIEW_FLOORS[tier]) {
    tier = TIER_DOWNGRADE[TIER_DOWNGRADE.indexOf(tier) + 1];
  }
  return tier;
}

function isLikelyGame(r) {
  // Drop obvious non-games: soundtracks, demos, playtests, art books.
  const name = (r.Name || "").toLowerCase();
  if (
    /\b(soundtrack|ost|original\s+score|artbook|art\s*book|wallpaper|playtest|demo|prologue)\b/.test(
      name,
    )
  ) {
    return false;
  }
  // Empty Genres → almost always DLC / soundtrack / software.
  if (!(r.Genres || "").trim()) return false;
  return true;
}

async function main() {
  const t0 = performance.now();

  console.log("Reading", RAW_CSV);
  const text = await readFile(RAW_CSV, "utf8");
  console.log(`  ${(text.length / 1e6).toFixed(1)} MB read`);

  console.log("Parsing CSV (ignoring file header, projecting against in-code schema)...");
  const allRows = d3.csvParseRows(text);
  console.log(`  ${allRows.length} total rows (incl. header)`);
  if (allRows[0].length !== 39) {
    console.warn(
      `  unexpected header column count: got ${allRows[0].length}, expected 39 (the known-bad header)`,
    );
  }
  if (allRows[1] && allRows[1].length !== 40) {
    console.warn(
      `  unexpected first-data-row column count: got ${allRows[1].length}, expected 40`,
    );
  }

  const raw = allRows.slice(1).map((row) => {
    const o = {};
    for (let i = 0; i < COLUMNS.length; i++) o[COLUMNS[i]] = row[i];
    return o;
  });
  console.log(`  ${raw.length} data rows projected`);

  console.log("Cleaning + parsing fields...");
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const cleanedAll = raw
    .filter(isLikelyGame)
    .map((r) => {
      const date = parseReleaseDate(r["Release date"]);
      const owners = parseOwnersRange(r["Estimated owners"]);
      return {
        appId: r.AppID,
        name: r.Name,
        date,
        releaseYear: date ? date.getUTCFullYear() : null,
        ownersLow: owners?.low ?? null,
        ownersHigh: owners?.high ?? null,
        ownersMid: owners?.mid ?? null,
        peakCcu: +r["Peak CCU"] || 0,
        price: +r.Price || 0,
        priceTier: priceTier(r.Price),
        genres: splitCommaList(r.Genres),
        tags: splitCommaList(r.Tags),
        categories: splitCommaList(r.Categories),
        developers: r.Developers,
        publishers: r.Publishers,
        positive: +r.Positive || 0,
        negative: +r.Negative || 0,
        metacritic: +r["Metacritic score"] || null,
        windows: parseBool(r.Windows),
        mac: parseBool(r.Mac),
        linux: parseBool(r.Linux),
        languages: parseLangsList(r["Supported languages"]),
        avgPlaytimeForever: +r["Average playtime forever"] || 0,
        medianPlaytimeForever: +r["Median playtime forever"] || 0,
        avgPlaytimeTwoWeeks: +r["Average playtime two weeks"] || 0,
        medianPlaytimeTwoWeeks: +r["Median playtime two weeks"] || 0,
        dlcCount: +r["DLC count"] || 0,
        achievements: +r.Achievements || 0,
      };
    })
    .filter((g) => g.date && g.date <= today)
    .filter((g) => g.releaseYear >= 2003 && g.releaseYear <= currentYear)
    .filter((g) => g.ownersMid !== null);

  // Compute the corrected tier once per game (review-floor adjustment) so
  // every downstream analysis reads from the same classification.
  for (const g of cleanedAll) g.tier = correctedTier(g);

  // Dedup by (name, year): SteamSpy / Kaggle includes regional sub-store and
  // tracking-only entries that share a base game's name+year. Worst observed
  // case was "Shadow of the Tomb Raider: Definitive Edition" with 20 rows for
  // 2018 — one real (2-5M owners, 79k reviews) and 19 ghosts (≤20k each, low
  // review counts). For each (name, year) group we keep the row with the most
  // reviews, which selects the real release in every case observed.
  // True same-name same-year *different games* (rare) collapse to whichever
  // happens to have more reviews — acceptable cost for dropping the noise.
  const reviewCount = (g) => g.positive + g.negative;
  const dedupMap = new Map();
  for (const g of cleanedAll) {
    const k = `${g.name}${g.releaseYear}`;
    const prev = dedupMap.get(k);
    if (!prev || reviewCount(prev) < reviewCount(g)) dedupMap.set(k, g);
  }
  const cleaned = [...dedupMap.values()];
  const droppedDupes = cleanedAll.length - cleaned.length;

  console.log(`  ${cleanedAll.length} games after cleaning`);
  console.log(`  ${cleaned.length} games after (name, year) dedup — dropped ${droppedDupes} ghost duplicates`);

  await mkdir(DATA_OUT, { recursive: true });

  // Group once for cheap per-year lookups.
  const byYear = d3.group(cleaned, (g) => g.releaseYear);
  const minYear = 2004;
  const maxYear = currentYear;
  const years = d3.range(minYear, maxYear + 1);

  const reportSections = [];

  // helper: write JSON, build a markdown table, push into the report
  async function emit(filename, jsonData, mdTitle, mdHeaders, mdRows) {
    await writeFile(join(DATA_OUT, filename), JSON.stringify(jsonData, null, 2));
    const md = [
      `### ${mdTitle}`,
      "",
      "`data/" + filename + "`",
      "",
      "| " + mdHeaders.join(" | ") + " |",
      "| " + mdHeaders.map(() => "---").join(" | ") + " |",
      ...mdRows.map((r) => "| " + r.join(" | ") + " |"),
      "",
    ];
    reportSections.push(md.join("\n"));
  }

  const fmtN = (n) => Number(n ?? 0).toLocaleString();
  const fmtPct = (x) => (Number(x ?? 0) * 100).toFixed(1) + "%";

  // 1. Releases per year
  {
    const data = years.map((year) => ({
      year,
      count: (byYear.get(year) || []).length,
    }));
    await emit(
      "releases_per_year.json",
      data,
      "1. Releases per year",
      ["year", "releases"],
      data.map((r) => [r.year, fmtN(r.count)]),
    );
  }

  // 2. Median + 25th/75th percentile owners by year — feeds Scene 3 (median + band).
  // Percentiles are computed over games with positive owner estimates only:
  // SteamSpy's `0 - 0` bucket means "no data available", not "zero owners",
  // and including those would pull the percentiles toward zero artificially.
  // The total release count still reflects all games for the year.
  {
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const measured = games.filter((g) => g.ownersMid > 0);
      const sorted = measured.slice().sort((a, b) => a.ownersMid - b.ownersMid);
      return {
        year,
        count: games.length,
        measured_count: measured.length,
        median_owners: d3.median(sorted, (g) => g.ownersMid) ?? 0,
        p25_owners: d3.quantile(sorted, 0.25, (g) => g.ownersMid) ?? 0,
        p75_owners: d3.quantile(sorted, 0.75, (g) => g.ownersMid) ?? 0,
      };
    });
    await emit(
      "median_owners_by_year.json",
      data,
      "2. Median owners (with 25th/75th percentile band) by release year",
      ["year", "releases", "measured", "p25 owners", "median owners", "p75 owners"],
      data.map((r) => [
        r.year,
        fmtN(r.count),
        fmtN(r.measured_count),
        fmtN(r.p25_owners),
        fmtN(r.median_owners),
        fmtN(r.p75_owners),
      ]),
    );
  }

  // 3. "Drowned" rate — share of releases with owners_high <= 20,000
  {
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const drowned = games.filter((g) => g.ownersHigh <= 20000).length;
      return {
        year,
        total: games.length,
        drowned,
        drowned_rate: games.length ? drowned / games.length : 0,
      };
    });
    await emit(
      "drowned_rate_by_year.json",
      data,
      "3. \"Drowned\" rate — share of releases with owners_high ≤ 20,000",
      ["year", "total", "drowned", "rate"],
      data.map((r) => [r.year, fmtN(r.total), fmtN(r.drowned), fmtPct(r.drowned_rate)]),
    );
  }

  // 4. Pareto — top-10 share of total owners, per year
  {
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const sorted = games.slice().sort((a, b) => b.ownersMid - a.ownersMid);
      const total = d3.sum(games, (g) => g.ownersMid);
      const top10 = d3.sum(sorted.slice(0, 10), (g) => g.ownersMid);
      return {
        year,
        total_releases: games.length,
        total_owners: total,
        top10_owners: top10,
        top10_share: total ? top10 / total : 0,
      };
    });
    await emit(
      "pareto_by_year.json",
      data,
      "4. Top-10 share of total owners by year",
      ["year", "releases", "total owners", "top-10 owners", "top-10 share"],
      data.map((r) => [
        r.year,
        fmtN(r.total_releases),
        fmtN(r.total_owners),
        fmtN(r.top10_owners),
        fmtPct(r.top10_share),
      ]),
    );
  }

  // 5. Genre share by year (every genre in JSON, headline ones in markdown)
  {
    const allGenres = new Set();
    cleaned.forEach((g) => g.genres.forEach((x) => allGenres.add(x)));
    const allGenresList = [...allGenres].sort();
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const obj = { year, total: games.length };
      for (const genre of allGenresList) {
        const has = games.filter((g) => g.genres.includes(genre)).length;
        obj[genre] = games.length ? has / games.length : 0;
      }
      return obj;
    });
    const showcase = ["Indie", "Casual", "Action", "Adventure", "Strategy", "RPG", "Simulation", "Sports"];
    await emit(
      "genre_share_by_year.json",
      { genres: allGenresList, byYear: data },
      "5. Genre share by year (selected genres)",
      ["year", "total", ...showcase],
      data.map((r) => [r.year, fmtN(r.total), ...showcase.map((g) => fmtPct(r[g]))]),
    );
  }

  // 6. Price tier distribution by year
  {
    const tiers = ["free", "<$5", "$5-$20", "$20+"];
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const obj = { year, total: games.length };
      for (const tier of tiers) {
        obj[tier] = games.length
          ? games.filter((g) => g.priceTier === tier).length / games.length
          : 0;
      }
      return obj;
    });
    await emit(
      "price_tier_by_year.json",
      data,
      "6. Price tier distribution by year",
      ["year", "total", ...tiers],
      data.map((r) => [r.year, fmtN(r.total), ...tiers.map((t) => fmtPct(r[t]))]),
    );
  }

  // 7. Rank-1 vs rank-100 owners gap per year
  {
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const sorted = games.slice().sort((a, b) => b.ownersMid - a.ownersMid);
      const r1 = sorted[0]?.ownersMid ?? 0;
      const r100 = sorted[99]?.ownersMid ?? 0;
      return {
        year,
        total: games.length,
        rank_1_owners: r1,
        rank_100_owners: r100,
        ratio: r100 ? r1 / r100 : null,
      };
    });
    await emit(
      "rank_gap_by_year.json",
      data,
      "7. Rank-1 vs rank-100 owners per release year",
      ["year", "releases", "rank-1", "rank-100", "1 / 100"],
      data.map((r) => [
        r.year,
        fmtN(r.total),
        fmtN(r.rank_1_owners),
        fmtN(r.rank_100_owners),
        r.ratio ? r.ratio.toFixed(1) + "x" : "n/a",
      ]),
    );
  }

  // 8. Native platform-support share by year
  {
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const total = games.length || 1;
      return {
        year,
        total: games.length,
        windows: games.filter((g) => g.windows).length / total,
        mac: games.filter((g) => g.mac).length / total,
        linux: games.filter((g) => g.linux).length / total,
      };
    });
    await emit(
      "platform_support_by_year.json",
      data,
      "8. Native platform-support share by release year",
      ["year", "releases", "Windows", "Mac", "Linux"],
      data.map((r) => [
        r.year,
        fmtN(r.total),
        fmtPct(r.windows),
        fmtPct(r.mac),
        fmtPct(r.linux),
      ]),
    );
  }

  // 9. Languages supported per game by year
  {
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      return {
        year,
        total: games.length,
        avg_languages: games.length ? d3.mean(games, (g) => g.languages.length) : 0,
        median_languages: games.length ? d3.median(games, (g) => g.languages.length) : 0,
      };
    });
    await emit(
      "language_count_by_year.json",
      data,
      "9. Languages supported per game by release year",
      ["year", "releases", "avg languages", "median languages"],
      data.map((r) => [
        r.year,
        fmtN(r.total),
        (r.avg_languages || 0).toFixed(1),
        (r.median_languages || 0).toFixed(0),
      ]),
    );
  }

  // 10. Recent engagement — median 2-week playtime by release cohort
  {
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const stillPlayed = games.filter((g) => g.medianPlaytimeTwoWeeks > 0);
      return {
        year,
        total: games.length,
        share_currently_played: games.length ? stillPlayed.length / games.length : 0,
        median_two_week_minutes: games.length
          ? d3.median(games, (g) => g.medianPlaytimeTwoWeeks)
          : 0,
      };
    });
    await emit(
      "engagement_by_year.json",
      data,
      "10. Recent engagement (median 2-week playtime) by release year",
      ["year", "releases", "share still played", "median 2wk minutes"],
      data.map((r) => [
        r.year,
        fmtN(r.total),
        fmtPct(r.share_currently_played),
        fmtN(r.median_two_week_minutes),
      ]),
    );
  }

  // 12. Indie identity: Genre "Indie" vs Tag "Indie" vs composite indie-flavored tags.
  // Genres are dev-set and short; Tags are community-applied and richer. Hypothesis: Tag
  // captures "indie identity" much more broadly than Genre.
  {
    const indieFlavorTags = ["Indie", "Casual", "Pixel Graphics", "Roguelike", "2D"];
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const total = games.length || 1;
      const genreIndie = games.filter((g) => g.genres.includes("Indie")).length;
      const tagIndie = games.filter((g) => g.tags.includes("Indie")).length;
      const anyFlavor = games.filter((g) =>
        indieFlavorTags.some((t) => g.tags.includes(t)),
      ).length;
      return {
        year,
        total: games.length,
        genre_indie_share: genreIndie / total,
        tag_indie_share: tagIndie / total,
        any_indie_flavor_tag_share: anyFlavor / total,
      };
    });
    await emit(
      "indie_share_by_year.json",
      data,
      "12. Indie identity: Genre vs Tag vs composite-flavor",
      ["year", "releases", "Genre 'Indie'", "Tag 'Indie'", "any indie-flavored tag"],
      data.map((r) => [
        r.year,
        fmtN(r.total),
        fmtPct(r.genre_indie_share),
        fmtPct(r.tag_indie_share),
        fmtPct(r.any_indie_flavor_tag_share),
      ]),
    );
  }

  // 13. Most-applied tags overall (sanity check: does "Indie" rank near the top?
  // If yes, the Tag "Indie" is a real, broadly-applied label across the catalog.)
  {
    const tagCounts = new Map();
    for (const g of cleaned) {
      for (const t of g.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
    const top = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
    await emit(
      "top_tags_overall.json",
      top.map(([tag, count]) => ({ tag, count })),
      "13. Top 30 most-applied tags across the catalog",
      ["rank", "tag", "games"],
      top.map(([tag, count], i) => [i + 1, tag, fmtN(count)]),
    );
  }

  // 11. DLC adoption — share of games with any DLC, per release year
  {
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const withDlc = games.filter((g) => g.dlcCount > 0).length;
      return {
        year,
        total: games.length,
        with_dlc: withDlc,
        share_with_dlc: games.length ? withDlc / games.length : 0,
        avg_dlc_count: games.length ? d3.mean(games, (g) => g.dlcCount) : 0,
      };
    });
    await emit(
      "dlc_adoption_by_year.json",
      data,
      "11. DLC adoption — share of games with any DLC, by release year",
      ["year", "releases", "with DLC", "share", "avg DLC count"],
      data.map((r) => [
        r.year,
        fmtN(r.total),
        fmtN(r.with_dlc),
        fmtPct(r.share_with_dlc),
        (r.avg_dlc_count || 0).toFixed(2),
      ]),
    );
  }

  // 14. Owner-bucket tier share by year — feeds Scene 1 (The Flood). Each game
  // lands in exactly one of five tiers via correctedTier() (see top of file —
  // SteamSpy bucket adjusted by the review-density floor). Per-year counts add
  // up to that year's total releases.
  {
    const TIERS = ["drowned", "niche", "modest", "hit", "phenomenon"];
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const counts = { drowned: 0, niche: 0, modest: 0, hit: 0, phenomenon: 0 };
      for (const g of games) counts[g.tier]++;
      return { year, total: games.length, ...counts };
    });
    await emit(
      "tier_share_by_year.json",
      data,
      "14. Owner-bucket tier share by release year (Scene 1 source)",
      ["year", "total", ...TIERS.map((t) => t)],
      data.map((r) => [
        r.year,
        fmtN(r.total),
        ...TIERS.map((t) =>
          `${fmtN(r[t])} (${fmtPct(r.total ? r[t] / r.total : 0)})`,
        ),
      ]),
    );
  }

  // 15. Median-cohort example games — feeds Scene 3 (The Median Crashed).
  // For each year, pick three games whose owners_mid is closest to the year's
  // median (computed over games with positive owner estimates, matching
  // analysis 2). The Scene 3 hover tooltip surfaces these so the viewer can
  // see "this is what the median game looks like" — usually obscure, often weird.
  {
    const data = years.map((year) => {
      const games = (byYear.get(year) || []).filter((g) => g.ownersMid > 0);
      if (!games.length) return { year, median_owners: 0, examples: [] };
      const median = d3.median(games, (g) => g.ownersMid) ?? 0;
      const ranked = games
        .map((g) => ({
          name: g.name,
          appId: g.appId,
          owners_mid: g.ownersMid,
          distance: Math.abs(g.ownersMid - median),
        }))
        .sort(
          (a, b) => a.distance - b.distance || a.name.localeCompare(b.name),
        )
        .slice(0, 3);
      return {
        year,
        median_owners: median,
        examples: ranked.map(({ distance, ...rest }) => rest),
      };
    });
    await emit(
      "median_examples_by_year.json",
      data,
      "15. Three example games closest to each year's median owners (Scene 3 source)",
      ["year", "median", "examples"],
      data.map((r) => [
        r.year,
        fmtN(r.median_owners),
        r.examples.map((e) => e.name).join("; ") || "—",
      ]),
    );
  }

  // 16. Per-game slim records — feeds Scene 4 (Find Your Game). Tabular format
  // (a `fields` header plus `rows` of value arrays) cuts JSON key overhead vs
  // an array-of-objects shape, since this file ships to every visitor of the
  // site — keeping it small matters more than ergonomics. The browser-side
  // module reconstitutes objects from the rows on load. Tier is read from the
  // precomputed g.tier (correctedTier(), with the review-density floor).
  {
    // Price intentionally omitted — the SteamSpy snapshot captures whatever the
    // price was at scrape time, including sales (Witcher 3 at $2.99, etc.), so
    // displaying it as "the game's price" would be misleading.
    // dateString is the parsed release date re-formatted as "MMM d, YYYY" so
    // we can show e.g. "Oct 21, 2008" without re-parsing in the browser. Using
    // d3.timeFormat for consistency with Steam's own display style.
    const formatDate = d3.timeFormat("%b %-d, %Y");
    const fields = [
      "appId",
      "name",
      "year",
      "dateString",
      "ownersMid",
      "tier",
      "isIndie",
      "genres",
      "tags",
      "positive",
      "negative",
      "avgPlaytimeMin",
      "peakCcu",
      "windows",
      "mac",
      "linux",
      "developer",
    ];
    const rows = cleaned.map((g) => [
      g.appId,
      g.name,
      g.releaseYear,
      g.date ? formatDate(g.date) : "",
      g.ownersMid,
      g.tier,
      g.genres.includes("Indie") ? 1 : 0,
      g.genres.slice(0, 3).join(","),
      // Tags are listed in community-vote order in the source CSV. We ship
      // the top 10 — the first 5 are usually displayed (chip strip), tags
      // 6-10 power the filter dropdown so deeper-but-popular tags like
      // "Open World" (typically rank ~6-10 within a game) become filterable.
      // Joined with `|` so we can split safely — tag names never contain
      // pipes but can contain commas (e.g., "Match 3").
      g.tags.slice(0, 10).join("|"),
      g.positive,
      g.negative,
      g.avgPlaytimeForever,
      g.peakCcu,
      g.windows ? 1 : 0,
      g.mac ? 1 : 0,
      g.linux ? 1 : 0,
      // Developer is shipped verbatim — usually a single studio name, sometimes
      // comma-separated co-developments. Rendered as one attribution line.
      g.developers || "",
    ]);
    await writeFile(
      join(DATA_OUT, "game_dots.json"),
      JSON.stringify({ fields, rows }),
    );
    reportSections.push(
      `### 16. Per-game slim records (Scene 4 source)\n\n` +
      `\`data/game_dots.json\` — ${fmtN(rows.length)} games in tabular format ` +
      `(\`fields\` + \`rows\`) with: ${fields.join(", ")}. ` +
      `Used by Find Your Game for autocomplete + cohort comparison.\n`,
    );
  }

  // 17. Quality distribution by release year — feeds Scene 3 (Has Quality Held Up?).
  // Two parallel signals per year:
  //   - Steam positive ratio: Positive / (Positive + Negative), restricted to
  //     games with ≥50 reviews. A 3-review game's ratio is too noisy to put in
  //     a per-year distribution; the floor cuts that out.
  //   - Metacritic score: only ~3.5% of games have one (critic-reviewed titles),
  //     with strong selection bias toward games critics chose to cover. Kept as
  //     a supplementary lens — its quantiles trend the same way as Steam's.
  // Five quantiles per signal per year support a nested-band area chart.
  {
    const STEAM_MIN_REVIEWS = 50;
    const quantile = (sorted, p) =>
      sorted.length ? d3.quantile(sorted, p) : null;
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      const steamSamples = games
        .filter((g) => g.positive + g.negative >= STEAM_MIN_REVIEWS)
        .map((g) => g.positive / (g.positive + g.negative))
        .sort(d3.ascending);
      const metaSamples = games
        .filter((g) => g.metacritic > 0)
        .map((g) => g.metacritic)
        .sort(d3.ascending);
      return {
        year,
        total: games.length,
        n_steam: steamSamples.length,
        steam_p10: quantile(steamSamples, 0.10),
        steam_p25: quantile(steamSamples, 0.25),
        steam_p50: quantile(steamSamples, 0.50),
        steam_p75: quantile(steamSamples, 0.75),
        steam_p90: quantile(steamSamples, 0.90),
        n_meta: metaSamples.length,
        meta_p10: quantile(metaSamples, 0.10),
        meta_p25: quantile(metaSamples, 0.25),
        meta_p50: quantile(metaSamples, 0.50),
        meta_p75: quantile(metaSamples, 0.75),
        meta_p90: quantile(metaSamples, 0.90),
      };
    });
    await emit(
      "quality_by_year.json",
      data,
      "17. Quality distribution by release year (Scene 3 source)",
      ["year", "releases", "n ≥50 rev", "Steam p25 / p50 / p75", "n meta", "meta p25 / p50 / p75"],
      data.map((r) => [
        r.year,
        fmtN(r.total),
        fmtN(r.n_steam),
        r.steam_p50 !== null
          ? `${fmtPct(r.steam_p25)} / ${fmtPct(r.steam_p50)} / ${fmtPct(r.steam_p75)}`
          : "—",
        fmtN(r.n_meta),
        r.meta_p50 !== null
          ? `${r.meta_p25.toFixed(0)} / ${r.meta_p50.toFixed(0)} / ${r.meta_p75.toFixed(0)}`
          : "—",
      ]),
    );
  }

  // Write the consolidated markdown report.
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  const report = [
    "# Phase 0 — Data Validation Report",
    "",
    `Generated ${new Date().toISOString()} from \`raw_data/games.csv\` in ${elapsed}s.`,
    "",
    `- Total raw rows: **${fmtN(raw.length)}**`,
    `- After cleaning (real games, parseable date, valid owners range): **${fmtN(cleaned.length)}**`,
    `- Drop rate: **${fmtPct(1 - cleaned.length / raw.length)}**`,
    `- Year range: **${minYear}–${maxYear}**`,
    "",
    `${reportSections.length} analyses below. Each is also serialized as a JSON file in \`data/\``,
    "for the browser to fetch later. Several feed specific scrollytelling scenes",
    "(tier_share → Scene 1, genre_share → Scene 2, quality_by_year → Scene 3,",
    "game_dots → Scene 4); the rest are exploratory checks on the original Flood",
    "thesis and broader trend candidates.",
    "",
    "## Analyses",
    "",
    ...reportSections,
  ].join("\n");
  await writeFile(REPORT_OUT, report);

  console.log(`\nWrote ${reportSections.length} analyses + report to ${REPORT_OUT}`);
  console.log(`Total time: ${elapsed}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
