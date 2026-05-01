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
  const cleaned = raw
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

  console.log(`  ${cleaned.length} games after cleaning`);

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

  // 2. Median owners by year
  {
    const data = years.map((year) => {
      const games = byYear.get(year) || [];
      return {
        year,
        count: games.length,
        median_owners: d3.median(games, (g) => g.ownersMid) ?? 0,
      };
    });
    await emit(
      "median_owners_by_year.json",
      data,
      "2. Median owners by release year",
      ["year", "releases", "median owners (mid)"],
      data.map((r) => [r.year, fmtN(r.count), fmtN(r.median_owners)]),
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
    "Eleven analyses below. Each is also serialized as a JSON file in `data/`",
    "for the browser to fetch later. The first seven validate the original Flood",
    "thesis (median collapse, indie flip, Pareto). The last four explore broader",
    "trend candidates (platform support, localization, recent engagement, DLC).",
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
