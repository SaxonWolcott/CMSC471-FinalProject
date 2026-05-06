# Steam, Over Time

CMSC471 Information Visualization final project, University of Maryland, Spring 2026.
A scrollytelling visualization of how Steam's catalog has evolved across two decades —
from a handful of Valve titles in 2004 to over 100,000 games today, with most of them
reaching almost no audience.

**Live demo:** https://saxonwolcott.github.io/CMSC471-FinalProject/

## What it shows

Five sections — three narrative scenes and two interactive capstones:

1. **The Flood** — release counts per year, broken into five owner-count tiers. Watch
   the smallest-bucket "Drowned" share grow from 4% in 2007 to 95% by 2025. Toggle between
   *Proportions* (every bar 100%, read the tier mix) and *Counts* (bar height = total
   releases, read the explosion).
2. **The Indie Wave** — genre composition over time. Indie went from 17% of releases (2008)
   to 77% (2018). Click any genre on the right edge of the chart to highlight its line;
   hover anywhere to see every genre's value at that year.
3. **Has Quality Held Up?** — Metacritic + review ratios over the catalog explosion.
   *(In progress.)*
4. **Find Your Game** — type a Steam game name and see where it sits in its release-year
   cohort. Includes ~113,500 games (after filtering adult-content titles), Steam header
   images pulled live from Valve's CDN, suggestion chips, and a 🎲 random pick button.
5. **Test Your Hypothetical Game** — sliders for release year, price, indie / AAA, etc.,
   with a verdict on where the resulting game would likely land. *(In progress.)*

## Tech stack

- Vanilla HTML, CSS, and JavaScript with native ES modules. No bundler, no build step.
- D3.js v7 and Scrollama loaded from CDN.
- Node.js with d3 (`scripts/build.js`) for the offline data pipeline. The browser only
  fetches small pre-aggregated JSONs.
- Hosted on GitHub Pages directly from `main`.

## Running locally

Serve the project root with any static file server:

```
npx serve
```

Then open the URL the server reports (usually `http://localhost:3000`). Live Server in
VS Code or `python -m http.server` work just as well.

## Regenerating the data

The data pipeline is offline; the browser only fetches the JSONs in `data/`.
To rebuild from scratch you'll need the raw CSV from the
[fronkongames Kaggle dataset](https://www.kaggle.com/datasets/fronkongames/steam-games-dataset),
placed at `raw_data/games.csv` (gitignored — too large to commit).

```
cd scripts
npm install
npm run build
```

Outputs are written to `data/*.json` (committed, served to the browser) and a markdown
summary to `phase0-report.md` at the project root.

## Repo layout

```
Final Project/
├── index.html              # entry point
├── css/styles.css          # Steam-themed dark stylesheet
├── js/
│   ├── main.js             # wires scrollama + each scene controller
│   ├── lib/colors.js       # owner-tier palette
│   └── scenes/             # one module per scene (01-flood, 02-indie-wave, …)
├── data/                   # pre-aggregated JSONs (committed, fetched by browser)
├── scripts/
│   ├── build.js            # CSV → JSONs pipeline
│   ├── inspect.js          # debug: CSV header bug
│   └── inspect-tags.js     # debug: list-field delimiter
├── phase0-report.md        # auto-generated data-validation report
├── plan.md                 # design plan + status (gitignored)
└── README.md               # this file
```

## Data source & caveats

- **Dataset:** [`fronkongames/steam-games-dataset`](https://www.kaggle.com/datasets/fronkongames/steam-games-dataset)
  on Kaggle (CC BY 4.0), based on the Steam Web API and SteamSpy estimates.
- **Owner counts are SteamSpy algorithmic estimates**, not real sales figures, and come
  bucketed in coarse ranges (the smallest bucket is 0–20,000 owners). Off-by-30–50% per
  individual game is common; in aggregate the trends are reasonable.
- **The dataset is a snapshot.** Older games have had more time to accumulate owners than
  recent ones, so 2024–2025 cohorts are flagged on the chart with diagonal hatching as
  "still accumulating."
- **Two parsing fixes** worth knowing if you regenerate the pipeline: the source CSV has a
  malformed header (39 columns vs 40 in data rows — a missing comma between `Discount` and
  `DLC count`), and `Genres` / `Tags` / `Categories` are comma-delimited rather than
  semicolon-delimited. Both fixes live in `scripts/build.js`.

## Attribution

- Data: SteamSpy and the fronkongames Kaggle dataset (CC BY 4.0). Attribution is also
  present on the visualization itself, in the footer.
- Built with [D3.js](https://d3js.org/) and
  [Scrollama](https://github.com/russellsamora/scrollama).
- "Steam" and the Motiva Sans typeface are properties of Valve Corporation. This is an
  academic project, unaffiliated with Valve.

## AI usage

This project was developed with extensive use of Claude (Anthropic) as a pair programmer.
A working log of which prompts produced which parts is kept in `docs/ai-usage.md` (in
progress).

## Team

CMSC471 Spring 2026 — Group 13.
