// Scene 1: The Flood.
// Stacked vertical bar chart, one bar per release year. Bar height = total
// releases that year; each bar is split into the five owner-bucket tiers from
// `data/tier_share_by_year.json`. Annotations mark Steam Greenlight (2012) and
// Steam Direct (2017). Hatching on the most recent years flags snapshot bias
// (those games are still accumulating owners).

import { TIERS, TIER_COLORS, TIER_LABELS, TIER_DEFINITIONS } from "../lib/colors.js";

// d3 is loaded as a global from the CDN script tag in index.html.

const RECENT_YEARS_TO_HATCH = [2024, 2025, 2026];
const ANNOTATIONS = [
  { year: 2012, label: "Steam Greenlight" },
  { year: 2017, label: "Steam Direct" },
];

export function renderFlood(container, data) {
  container.innerHTML = "";

  const chartDiv = document.createElement("div");
  chartDiv.className = "flood-chart";
  container.appendChild(chartDiv);

  const legendDiv = document.createElement("div");
  legendDiv.className = "flood-legend";
  container.appendChild(legendDiv);

  renderChart(chartDiv, data);
  renderLegend(legendDiv);
}

function renderChart(host, data) {
  const margin = { top: 50, right: 24, bottom: 50, left: 64 };
  const hostRect = host.getBoundingClientRect();
  const width = Math.max(hostRect.width, 320);
  const height = 560;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const stack = d3.stack().keys(TIERS).value((d, key) => d[key]);
  const stacked = stack(data);

  const xScale = d3
    .scaleBand()
    .domain(data.map((d) => d.year))
    .range([0, innerWidth])
    .padding(0.18);

  const maxTotal = d3.max(data, (d) => d.total);
  const yScale = d3
    .scaleLinear()
    .domain([0, maxTotal])
    .nice()
    .range([innerHeight, 0]);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", "100%")
    .attr("height", height)
    .attr("role", "img")
    .attr("aria-label", "Stacked bar chart of Steam releases by year, split by owner-count tier");

  // Diagonal hatch pattern overlaid on snapshot-bias years.
  const defs = svg.append("defs");
  defs
    .append("pattern")
    .attr("id", "snapshot-bias-hatch")
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", 6)
    .attr("height", 6)
    .attr("patternTransform", "rotate(45)")
    .append("line")
    .attr("x1", 0)
    .attr("y1", 0)
    .attr("x2", 0)
    .attr("y2", 6)
    .attr("stroke", "rgba(255,255,255,0.45)")
    .attr("stroke-width", 2);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Y-axis with subtle horizontal gridlines.
  g.append("g")
    .attr("class", "axis axis--y")
    .call(
      d3
        .axisLeft(yScale)
        .ticks(6)
        .tickFormat((d) => d3.format(",")(d)),
    )
    .call((sel) => sel.select(".domain").remove())
    .call((sel) =>
      sel
        .selectAll(".tick line")
        .attr("x2", innerWidth)
        .attr("stroke", "#ececec"),
    )
    .call((sel) => sel.selectAll(".tick text").attr("dx", -4));

  // Y-axis label.
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2)
    .attr("y", -48)
    .attr("text-anchor", "middle")
    .text("Releases per year");

  // Bars: one group per tier so all rects of one color render together.
  for (const series of stacked) {
    g.append("g")
      .attr("fill", TIER_COLORS[series.key])
      .attr("data-tier", series.key)
      .selectAll("rect")
      .data(series)
      .join("rect")
      .attr("x", (d) => xScale(d.data.year))
      .attr("y", (d) => yScale(d[1]))
      .attr("height", (d) => Math.max(0, yScale(d[0]) - yScale(d[1])))
      .attr("width", xScale.bandwidth());
  }

  // Hatch overlay for years still accumulating owners.
  g.append("g")
    .attr("class", "hatch-overlay")
    .selectAll("rect")
    .data(data.filter((d) => RECENT_YEARS_TO_HATCH.includes(d.year) && d.total > 0))
    .join("rect")
    .attr("x", (d) => xScale(d.year))
    .attr("y", (d) => yScale(d.total))
    .attr("height", (d) => innerHeight - yScale(d.total))
    .attr("width", xScale.bandwidth())
    .attr("fill", "url(#snapshot-bias-hatch)")
    .attr("pointer-events", "none");

  // X-axis: labels every other year so they don't crowd.
  g.append("g")
    .attr("class", "axis axis--x")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .tickValues(xScale.domain().filter((y) => y % 2 === 0))
        .tickSize(0),
    )
    .call((sel) => sel.select(".domain").remove())
    .call((sel) => sel.selectAll(".tick text").attr("dy", "1.2em"));

  // Annotations: dashed verticals at policy-change years with labels above.
  const annotG = g.append("g").attr("class", "annotations");
  for (const a of ANNOTATIONS) {
    const x = xScale(a.year) + xScale.bandwidth() / 2;
    annotG
      .append("line")
      .attr("x1", x)
      .attr("x2", x)
      .attr("y1", -10)
      .attr("y2", innerHeight)
      .attr("stroke", "#444")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3");
    annotG
      .append("text")
      .attr("x", x)
      .attr("y", -16)
      .attr("text-anchor", "middle")
      .attr("class", "annotation-label")
      .text(`${a.label} (${a.year})`);
  }
}

function renderLegend(host) {
  const root = d3.select(host);

  root
    .append("div")
    .attr("class", "flood-legend__title")
    .text("Owner-count tier (SteamSpy estimate)");

  // Reverse so the legend reads top-of-bar to bottom-of-bar (Phenomenon → Drowned).
  const items = root
    .append("div")
    .attr("class", "flood-legend__items");

  for (const tier of [...TIERS].reverse()) {
    const item = items.append("div").attr("class", "flood-legend__item");
    item
      .append("span")
      .attr("class", "flood-legend__swatch")
      .style("background", TIER_COLORS[tier]);
    item
      .append("span")
      .attr("class", "flood-legend__label")
      .text(TIER_LABELS[tier]);
    item
      .append("span")
      .attr("class", "flood-legend__def")
      .text(TIER_DEFINITIONS[tier]);
  }
}
