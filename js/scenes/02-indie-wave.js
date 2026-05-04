// Scene 2: The Indie Wave.
// Multi-line chart of genre share over time. Each featured genre is one line:
// "share of that year's releases tagged with this genre". Lines aren't
// mutually exclusive (most Steam games carry 2-3 genre tags), so the lines
// can cross and don't sum to 100% — the small footnote on the page flags this.
//
// One genre is highlighted at a time in the Scene-1 blue; the others render
// as muted gray context. Right-edge labels are clickable; clicking a label
// promotes that genre to the highlight. Hovering anywhere on the plot drops
// a vertical guide and shows a tooltip with every genre's value for the year
// (sorted descending so the biggest is on top).

// d3 is loaded as a global from the CDN script tag in index.html.

const FEATURED_GENRES = [
  "Indie",
  "Casual",
  "Action",
  "Adventure",
  "Simulation",
  "RPG",
  "Strategy",
];
const DEFAULT_SELECTED = "Indie";

const SELECTED_COLOR = "#66c0f4";   // Steam iconic cyan
const MUTED_COLOR = "#4b6479";      // muted blue-gray, visible on dark bg
const SELECTED_TEXT = "#ffffff";
const MUTED_TEXT = "#8f98a0";
const TRANSITION_MS = 320;

export function renderIndieWave(container, data) {
  container.innerHTML = "";
  container.classList.add("indie-wave");

  const chartHost = document.createElement("div");
  chartHost.className = "indie-wave-chart";
  container.appendChild(chartHost);

  const tooltip = document.createElement("div");
  tooltip.className = "indie-wave-tooltip";
  tooltip.hidden = true;
  container.appendChild(tooltip);

  // Drop 2026 to match Scene 1's range (84-game sample is too noisy to plot).
  const byYear = data.byYear.filter((d) => d.year < 2026);
  createChart(chartHost, tooltip, byYear);
}

function createChart(host, tooltip, byYear) {
  let selected = DEFAULT_SELECTED;

  const margin = { top: 32, right: 130, bottom: 50, left: 60 };
  const hostRect = host.getBoundingClientRect();
  const width = Math.max(hostRect.width, 320);
  const height = 520;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xScale = d3
    .scaleLinear()
    .domain(d3.extent(byYear, (d) => d.year))
    .range([0, innerWidth]);

  const dataMax = d3.max(byYear, (d) =>
    d3.max(FEATURED_GENRES, (g) => d[g] || 0),
  );
  const yScale = d3
    .scaleLinear()
    .domain([0, dataMax])
    .nice()
    .range([innerHeight, 0]);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", "100%")
    .attr("height", height)
    .attr("role", "img")
    .attr(
      "aria-label",
      "Multi-line chart of selected Steam genre shares from 2004 to 2025",
    );

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Y-axis with subtle gridlines.
  g.append("g")
    .attr("class", "axis axis--y")
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(".0%")))
    .call((sel) => sel.select(".domain").remove())
    .call((sel) =>
      sel
        .selectAll(".tick line")
        .attr("x2", innerWidth)
        .attr("stroke", "rgba(199, 213, 224, 0.12)"),
    )
    .call((sel) => sel.selectAll(".tick text").attr("dx", -4));

  // X-axis (integer years, no domain line).
  g.append("g")
    .attr("class", "axis axis--x")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(11)
        .tickFormat(d3.format("d"))
        .tickSize(0),
    )
    .call((sel) => sel.select(".domain").remove())
    .call((sel) => sel.selectAll(".tick text").attr("dy", "1.2em"));

  // Y-axis label.
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .text("% of year's releases tagged with genre");

  // Series: one entry per featured genre, with year/value points.
  const seriesByGenre = FEATURED_GENRES.map((genre) => ({
    genre,
    points: byYear.map((d) => ({ year: d.year, value: d[genre] || 0 })),
  }));

  const lineGen = d3
    .line()
    .x((d) => xScale(d.year))
    .y((d) => yScale(d.value))
    .curve(d3.curveMonotoneX);

  // Lines.
  const linesGroup = g.append("g").attr("class", "lines");
  const linePaths = {};
  for (const series of seriesByGenre) {
    linePaths[series.genre] = linesGroup
      .append("path")
      .datum(series.points)
      .attr("class", "indie-line")
      .attr("data-genre", series.genre)
      .attr("fill", "none")
      .attr("stroke-width", 1.5)
      .attr("stroke", MUTED_COLOR)
      .attr("d", lineGen);
  }

  // Right-edge labels (clickable, double as legend).
  const labelGroup = g.append("g").attr("class", "line-labels");
  const labelTexts = {};
  for (const series of seriesByGenre) {
    const lastValue = series.points[series.points.length - 1].value;
    labelTexts[series.genre] = labelGroup
      .append("text")
      .attr("class", "line-label")
      .attr("data-genre", series.genre)
      .attr("x", innerWidth + 8)
      .attr("y", yScale(lastValue))
      .attr("dy", "0.32em")
      .attr("text-anchor", "start")
      .style("cursor", "pointer")
      .style("font-size", "12px")
      .style("fill", MUTED_TEXT)
      .text(series.genre)
      .on("click", () => select(series.genre));
  }

  // Avoid label collisions: simple anti-overlap pass that nudges crowded
  // labels apart vertically while keeping their natural ordering.
  resolveLabelOverlaps(seriesByGenre, labelTexts, yScale, innerHeight);

  // Vertical focus line (drawn under the hover overlay so it doesn't intercept events).
  const focusLine = g
    .append("line")
    .attr("class", "focus-line")
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("stroke", "#c7d5e0")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "2,3")
    .attr("display", "none")
    .attr("pointer-events", "none");

  // Per-year focus dots, one per genre. Hidden by default.
  const focusDotsGroup = g.append("g").attr("class", "focus-dots");
  const focusDots = {};
  for (const series of seriesByGenre) {
    focusDots[series.genre] = focusDotsGroup
      .append("circle")
      .attr("data-genre", series.genre)
      .attr("r", 3)
      .attr("fill", MUTED_COLOR)
      .attr("display", "none")
      .attr("pointer-events", "none");
  }

  // Full-area hover overlay.
  g.append("rect")
    .attr("class", "hover-overlay")
    .attr("width", innerWidth)
    .attr("height", innerHeight)
    .attr("fill", "transparent")
    .style("cursor", "crosshair")
    .on("mouseenter", () => {
      focusLine.attr("display", null);
      for (const genre of FEATURED_GENRES) {
        focusDots[genre].attr("display", null);
      }
    })
    .on("mouseleave", () => {
      focusLine.attr("display", "none");
      for (const genre of FEATURED_GENRES) {
        focusDots[genre].attr("display", "none");
      }
      hideTooltip(tooltip);
    })
    .on("mousemove", function (event) {
      const [mx] = d3.pointer(event);
      const yearGuess = xScale.invert(mx);
      const year = Math.round(yearGuess);
      const yearData = byYear.find((d) => d.year === year);
      if (!yearData) return;

      const x = xScale(year);
      focusLine.attr("x1", x).attr("x2", x);
      for (const genre of FEATURED_GENRES) {
        focusDots[genre]
          .attr("cx", x)
          .attr("cy", yScale(yearData[genre] || 0))
          .attr("fill", genre === selected ? SELECTED_COLOR : MUTED_COLOR);
      }
      showHoverTooltip(tooltip, host, x, yearData, () => selected);
    });

  function select(genre) {
    if (genre === selected) return;
    selected = genre;
    apply();
  }

  function apply() {
    for (const series of seriesByGenre) {
      const isSelected = series.genre === selected;
      linePaths[series.genre]
        .transition()
        .duration(TRANSITION_MS)
        .attr("stroke", isSelected ? SELECTED_COLOR : MUTED_COLOR)
        .attr("stroke-width", isSelected ? 2.75 : 1.5);
      if (isSelected) linePaths[series.genre].raise();

      labelTexts[series.genre]
        .transition()
        .duration(TRANSITION_MS)
        .style("fill", isSelected ? SELECTED_TEXT : MUTED_TEXT)
        .style("font-weight", isSelected ? 700 : 400);
    }
  }

  // Initial render with default selection.
  apply();
}

// Tooltip rows are sorted descending by value so the biggest genre is on top.
// Selected genre's row is bolded + colored.
function showHoverTooltip(el, host, anchorXInChart, yearData, getSelected) {
  const selected = getSelected();
  const sortedGenres = [...FEATURED_GENRES].sort(
    (a, b) => (yearData[b] || 0) - (yearData[a] || 0),
  );
  const rows = sortedGenres
    .map((genre) => {
      const v = yearData[genre] || 0;
      const isSel = genre === selected;
      return `
        <span class="indie-wave-tooltip__row-name${isSel ? " is-selected" : ""}">${genre}</span>
        <span class="indie-wave-tooltip__row-value${isSel ? " is-selected" : ""}">${(v * 100).toFixed(1)}%</span>
      `;
    })
    .join("");

  el.innerHTML = `
    <div class="indie-wave-tooltip__title">${yearData.year} — ${d3.format(",")(yearData.total)} releases</div>
    <div class="indie-wave-tooltip__rows">${rows}</div>
  `;
  el.hidden = false;

  const { x, y } = chartToScreen(host, anchorXInChart, 0);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.transform = "translate(-50%, -110%)";
}

function hideTooltip(el) {
  el.hidden = true;
}

function chartToScreen(host, anchorXInChart, anchorYInChart) {
  const chartEl = host.querySelector("svg");
  const chartRect = chartEl.getBoundingClientRect();
  const containerRect = host.parentElement.getBoundingClientRect();
  const svgViewBox = chartEl.viewBox.baseVal;
  const scale = chartRect.width / svgViewBox.width;
  const marginLeft = 60;
  const marginTop = 32;
  return {
    x: chartRect.left - containerRect.left + (marginLeft + anchorXInChart) * scale,
    y: chartRect.top - containerRect.top + (marginTop + anchorYInChart) * scale,
  };
}

// Greedy vertical-spacing pass for the right-edge labels — order by current
// y-position, then push labels apart that are too close together. Keeps
// labels readable when several genres end up at similar shares (Action and
// Adventure in 2025, for example).
function resolveLabelOverlaps(seriesByGenre, labelTexts, yScale, innerHeight) {
  const minSpacing = 16;
  const placements = seriesByGenre
    .map((s) => {
      const last = s.points[s.points.length - 1];
      return { genre: s.genre, y: yScale(last.value) };
    })
    .sort((a, b) => a.y - b.y);

  for (let i = 1; i < placements.length; i++) {
    if (placements[i].y - placements[i - 1].y < minSpacing) {
      placements[i].y = placements[i - 1].y + minSpacing;
    }
  }
  // If we pushed below the chart, shift everything up.
  const overflow = placements[placements.length - 1].y - innerHeight;
  if (overflow > 0) {
    for (const p of placements) p.y -= overflow;
  }
  for (const p of placements) {
    labelTexts[p.genre].attr("y", p.y);
  }
}
