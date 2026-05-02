// Scene 1: The Flood.
// Stacked vertical bar chart, one bar per release year. Two view modes,
// switched via a toggle above the chart:
//   - Proportions (default): every bar at full height; tier segments are %
//     shares of the year's releases. Best for reading the tier shifts.
//   - Counts: bar height = absolute release count for that year. Best for
//     reading the release explosion.
// Annotations mark Steam Greenlight (2012) and Steam Direct (2017) with
// hover tooltips. Hatching on years still accumulating owners.

import { TIERS, TIER_COLORS, TIER_LABELS, TIER_DEFINITIONS } from "../lib/colors.js";

// d3 is loaded as a global from the CDN script tag in index.html.

const RECENT_YEARS_TO_HATCH = [2024, 2025];

const ANNOTATIONS = [
  {
    year: 2012,
    label: "Steam Greenlight",
    tooltip:
      "Launched August 2012. Let the Steam community vote on which user-submitted " +
      "games would make it onto the store — the first major loosening of Valve's " +
      "curation. Heavily criticized for the volume of low-effort submissions it admitted.",
  },
  {
    year: 2017,
    label: "Steam Direct",
    tooltip:
      "Launched June 2017. Replaced Greenlight with a flat $100-per-title submission " +
      "fee and almost no editorial gate. Annual release counts roughly doubled within " +
      "two years, and the median game's audience collapsed.",
  },
];

const TRANSITION_MS = 700;

export function renderFlood(container, data) {
  container.innerHTML = "";
  container.classList.add("flood");

  const controls = document.createElement("div");
  controls.className = "flood-controls";
  container.appendChild(controls);

  const chartHost = document.createElement("div");
  chartHost.className = "flood-chart";
  container.appendChild(chartHost);

  const legendHost = document.createElement("div");
  legendHost.className = "flood-legend";
  container.appendChild(legendHost);

  const tooltip = document.createElement("div");
  tooltip.className = "flood-tooltip";
  tooltip.hidden = true;
  container.appendChild(tooltip);

  const chart = createChart(chartHost, tooltip, data);
  buildToggle(controls, chart);
  renderLegend(legendHost);
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

function buildToggle(host, chart) {
  const modes = [
    { key: "proportional", label: "Proportions" },
    { key: "absolute", label: "Counts" },
  ];

  const wrap = d3.select(host).append("div").attr("class", "flood-controls__group");
  wrap
    .append("span")
    .attr("class", "flood-controls__label")
    .text("View:");

  const buttons = wrap
    .selectAll("button")
    .data(modes)
    .join("button")
    .attr("class", (d) => "flood-controls__btn" + (d.key === chart.mode() ? " is-active" : ""))
    .attr("type", "button")
    .text((d) => d.label)
    .on("click", function (event, d) {
      chart.setMode(d.key);
      buttons.classed("is-active", (m) => m.key === d.key);
    });
}

// ---------------------------------------------------------------------------
// Chart (returns a small controller object so the toggle can drive it)
// ---------------------------------------------------------------------------

function createChart(host, tooltip, data) {
  const margin = { top: 56, right: 24, bottom: 50, left: 64 };
  const hostRect = host.getBoundingClientRect();
  const width = Math.max(hostRect.width, 320);
  const height = 560;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  let mode = "proportional";

  const xScale = d3
    .scaleBand()
    .domain(data.map((d) => d.year))
    .range([0, innerWidth])
    .padding(0.18);

  const yScale = d3.scaleLinear().range([innerHeight, 0]);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", "100%")
    .attr("height", height)
    .attr("role", "img")
    .attr(
      "aria-label",
      "Stacked bar chart of Steam releases by year, split by SteamSpy owner-count tier",
    );

  // Hatch pattern for years still accumulating owners.
  svg
    .append("defs")
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

  const yAxisGroup = g.append("g").attr("class", "axis axis--y");
  const yLabel = g
    .append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2)
    .attr("y", -48)
    .attr("text-anchor", "middle");

  // One <g> per tier; rects are bound on first draw and updated thereafter.
  const tierGroups = TIERS.map((tier) =>
    g.append("g").attr("fill", TIER_COLORS[tier]).attr("data-tier", tier),
  );

  // Hatch overlay sits above the bars; updated on mode change so it tracks bar tops.
  const hatchGroup = g.append("g").attr("class", "hatch-overlay");

  // X-axis (static — same in both modes).
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

  // Annotations (static positions; tooltips wired below).
  const annotG = g.append("g").attr("class", "annotations");
  for (const a of ANNOTATIONS) {
    const x = xScale(a.year) + xScale.bandwidth() / 2;
    const lineEl = annotG
      .append("line")
      .attr("x1", x)
      .attr("x2", x)
      .attr("y1", -10)
      .attr("y2", innerHeight)
      .attr("stroke", "#444")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3")
      .attr("class", "annotation-line");

    const labelEl = annotG
      .append("text")
      .attr("x", x)
      .attr("y", -16)
      .attr("text-anchor", "middle")
      .attr("class", "annotation-label")
      .text(`${a.label} (${a.year})`);

    // Wide invisible hit-target so tiny lines aren't a UX nightmare.
    const hit = annotG
      .append("rect")
      .attr("x", x - 18)
      .attr("y", -28)
      .attr("width", 36)
      .attr("height", innerHeight + 30)
      .attr("fill", "transparent")
      .style("cursor", "help")
      .datum(a);

    const onEnter = (event, datum) => {
      lineEl.attr("stroke", "#000").attr("stroke-width", 1.5);
      labelEl.attr("fill", "#000");
      showTooltip(tooltip, host, x, datum);
    };
    const onLeave = () => {
      lineEl.attr("stroke", "#444").attr("stroke-width", 1);
      labelEl.attr("fill", null);
      hideTooltip(tooltip);
    };
    hit.on("mouseenter", onEnter).on("mouseleave", onLeave);
    lineEl.on("mouseenter", onEnter).on("mouseleave", onLeave);
    labelEl.on("mouseenter", onEnter).on("mouseleave", onLeave);
  }

  function update(animate) {
    const stacked = stackFor(data, mode);
    const yMax = mode === "proportional" ? 1 : d3.max(data, (d) => d.total);
    yScale.domain([0, yMax]).nice(mode === "absolute" ? 6 : 5);

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(6)
      .tickFormat(mode === "proportional" ? d3.format(".0%") : d3.format(","));

    const t = animate ? d3.transition().duration(TRANSITION_MS) : null;

    (animate ? yAxisGroup.transition(t) : yAxisGroup)
      .call(yAxis)
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick line")
          .attr("x2", innerWidth)
          .attr("stroke", "#ececec"),
      )
      .call((sel) => sel.selectAll(".tick text").attr("dx", -4));

    yLabel.text(mode === "proportional" ? "Share of year's releases" : "Releases per year");

    stacked.forEach((series, i) => {
      const sel = tierGroups[i]
        .selectAll("rect")
        .data(series, (d) => d.data.year);
      sel
        .join(
          (enter) =>
            enter
              .append("rect")
              .attr("x", (d) => xScale(d.data.year))
              .attr("width", xScale.bandwidth())
              .attr("y", (d) => yScale(d[1]))
              .attr("height", (d) => Math.max(0, yScale(d[0]) - yScale(d[1]))),
          (update) => update,
        )
        .transition(animate ? t : d3.transition().duration(0))
        .attr("y", (d) => yScale(d[1]))
        .attr("height", (d) => Math.max(0, yScale(d[0]) - yScale(d[1])));
    });

    const hatchData = data.filter(
      (d) => RECENT_YEARS_TO_HATCH.includes(d.year) && d.total > 0,
    );
    const hatchSel = hatchGroup
      .selectAll("rect")
      .data(hatchData, (d) => d.year);

    hatchSel
      .join(
        (enter) =>
          enter
            .append("rect")
            .attr("x", (d) => xScale(d.year))
            .attr("width", xScale.bandwidth())
            .attr("fill", "url(#snapshot-bias-hatch)")
            .attr("pointer-events", "none")
            .attr("y", (d) => barTopY(d, mode, yScale))
            .attr("height", (d) => innerHeight - barTopY(d, mode, yScale)),
      )
      .transition(animate ? t : d3.transition().duration(0))
      .attr("y", (d) => barTopY(d, mode, yScale))
      .attr("height", (d) => innerHeight - barTopY(d, mode, yScale));
  }

  // Initial draw (no animation).
  update(false);

  return {
    mode: () => mode,
    setMode(next) {
      if (next === mode) return;
      mode = next;
      update(true);
    },
  };
}

function stackFor(data, mode) {
  if (mode === "absolute") {
    return d3.stack().keys(TIERS).value((d, key) => d[key])(data);
  }
  return d3
    .stack()
    .keys(TIERS)
    .value((d, key) => (d.total ? d[key] / d.total : 0))(data);
}

function barTopY(d, mode, yScale) {
  return mode === "proportional" ? yScale(1) : yScale(d.total);
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function showTooltip(el, host, anchorXInChart, datum) {
  el.innerHTML = `
    <div class="flood-tooltip__title">${datum.label} (${datum.year})</div>
    <div class="flood-tooltip__body">${datum.tooltip}</div>
  `;
  el.hidden = false;

  // Anchor the tooltip near the annotation's screen-space x position.
  // The chart's SVG fills the chartHost width, so we proportion accordingly.
  const chartEl = host.querySelector("svg");
  const chartRect = chartEl.getBoundingClientRect();
  const containerRect = host.parentElement.getBoundingClientRect();
  const svgViewBox = chartEl.viewBox.baseVal;
  const scale = chartRect.width / svgViewBox.width;
  const margin = 64; // matches chart.margin.left
  const screenX = chartRect.left - containerRect.left + (margin + anchorXInChart) * scale;
  const screenY = chartRect.top - containerRect.top - 8;

  el.style.left = `${screenX}px`;
  el.style.top = `${screenY}px`;
  el.style.transform = "translate(-50%, -100%)";
}

function hideTooltip(el) {
  el.hidden = true;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function renderLegend(host) {
  const root = d3.select(host);

  root
    .append("div")
    .attr("class", "flood-legend__title")
    .text("Owner-count tier (SteamSpy estimate)");

  const items = root.append("div").attr("class", "flood-legend__items");

  // Reverse so the legend reads top-of-bar to bottom (Phenomenon → Drowned).
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
