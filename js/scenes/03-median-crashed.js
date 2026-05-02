// Scene 3: The Median Crashed.
// Two stacked charts sharing the same x-axis (years 2004-2025):
//   1. Median owners with 25th-75th percentile band, log y-scale. Headline.
//      Toggle between "Median + band" and "Median only" views.
//      Hover surfaces median value plus three example games at that cohort's
//      median (so the viewer sees who the median game actually was).
//   2. Share of releases with any 2-week recent playtime, linear y-scale.
//      Punchline — even when games release, almost nobody is playing them.

// d3 is loaded as a global from the CDN script tag in index.html.

const ANNOTATIONS = [
  { year: 2012, label: "Steam Greenlight" },
  { year: 2017, label: "Steam Direct" },
];

const LINE_COLOR = "#08519c";       // strong blue, continues Scene 1 family
const BAND_COLOR = "rgba(8, 81, 156, 0.18)";
const ANNOTATION_COLOR = "#444";
const TRANSITION_MS = 380;

export function renderMedianCrashed(container, { median, examples, engagement }) {
  container.innerHTML = "";
  container.classList.add("median-crashed");

  // Toggle bar (drives the median chart only).
  const controls = document.createElement("div");
  controls.className = "median-controls";
  container.appendChild(controls);

  const medianHost = document.createElement("div");
  medianHost.className = "median-chart";
  container.appendChild(medianHost);

  // Connective heading + lead between the two charts.
  const bridge = document.createElement("div");
  bridge.className = "median-bridge";
  bridge.innerHTML = `
    <h3 class="median-bridge__title">…and almost no one is playing them.</h3>
    <p class="median-bridge__lead">
      Share of each year's releases that have <em>any</em> recent (two-week)
      median playtime in the SteamSpy snapshot. Older games have had years to
      cycle through audiences; recent games barely break out of the gate.
    </p>
  `;
  container.appendChild(bridge);

  const engagementHost = document.createElement("div");
  engagementHost.className = "engagement-chart";
  container.appendChild(engagementHost);

  const tooltip = document.createElement("div");
  tooltip.className = "median-tooltip";
  tooltip.hidden = true;
  container.appendChild(tooltip);

  const filteredMedian = median.filter((d) => d.year < 2026);
  const filteredEngagement = engagement.filter((d) => d.year < 2026);
  const examplesByYear = new Map(examples.map((e) => [e.year, e]));

  const medianChart = createMedianChart(
    medianHost,
    tooltip,
    filteredMedian,
    examplesByYear,
  );
  buildToggle(controls, medianChart);
  createEngagementChart(engagementHost, tooltip, filteredEngagement);
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

function buildToggle(host, chart) {
  const modes = [
    { key: "band", label: "Median + band" },
    { key: "line", label: "Median only" },
  ];

  const wrap = d3.select(host).append("div").attr("class", "median-controls__group");
  wrap.append("span").attr("class", "median-controls__label").text("View:");

  const buttons = wrap
    .selectAll("button")
    .data(modes)
    .join("button")
    .attr(
      "class",
      (d) => "median-controls__btn" + (d.key === chart.mode() ? " is-active" : ""),
    )
    .attr("type", "button")
    .text((d) => d.label)
    .on("click", function (event, d) {
      chart.setMode(d.key);
      buttons.classed("is-active", (m) => m.key === d.key);
    });
}

// ---------------------------------------------------------------------------
// Median chart (with percentile band)
// ---------------------------------------------------------------------------

function createMedianChart(host, tooltip, data, examplesByYear) {
  let mode = "band";

  const margin = { top: 36, right: 28, bottom: 40, left: 80 };
  const hostRect = host.getBoundingClientRect();
  const width = Math.max(hostRect.width, 320);
  const height = 380;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xScale = d3
    .scaleLinear()
    .domain(d3.extent(data, (d) => d.year))
    .range([0, innerWidth]);

  // Log scale anchored at the smallest SteamSpy bucket midpoint (10k). Values
  // can't go below this anyway because percentile filter excludes mid=0.
  const allValues = data.flatMap((d) => [d.p25_owners, d.median_owners, d.p75_owners])
    .filter((v) => v > 0);
  const yMax = d3.max(allValues);
  const yScale = d3
    .scaleLog()
    .domain([10000, yMax])
    .nice()
    .range([innerHeight, 0])
    .clamp(true);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", "100%")
    .attr("height", height)
    .attr("role", "img")
    .attr(
      "aria-label",
      "Line chart of median Steam game owner counts by release year, with 25th-75th percentile band",
    );

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Y-axis with log-friendly ticks + horizontal gridlines.
  g.append("g")
    .attr("class", "axis axis--y")
    .call(
      d3
        .axisLeft(yScale)
        .ticks(6, "~s") // SI prefixes: 10k, 100k, 1M, 10M
        .tickSize(0),
    )
    .call((sel) => sel.select(".domain").remove())
    .call((sel) =>
      sel
        .selectAll(".tick line")
        .attr("x2", innerWidth)
        .attr("stroke", "#ececec"),
    )
    .call((sel) => sel.selectAll(".tick text").attr("dx", -4));

  // X-axis (integer years).
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
    .attr("y", -64)
    .attr("text-anchor", "middle")
    .text("Estimated owners (log scale)");

  // Annotations (Greenlight 2012, Steam Direct 2017) — labels on this chart only;
  // the engagement chart below repeats the dashed lines without labels.
  drawAnnotations(g, xScale, innerHeight, /* withLabels */ true);

  // Percentile band (drawn first so the line sits on top).
  const bandArea = d3
    .area()
    .x((d) => xScale(d.year))
    .y0((d) => yScale(Math.max(d.p25_owners, 10000)))
    .y1((d) => yScale(Math.max(d.p75_owners, 10000)))
    .curve(d3.curveMonotoneX);

  const bandPath = g
    .append("path")
    .datum(data)
    .attr("class", "median-band")
    .attr("fill", BAND_COLOR)
    .attr("d", bandArea);

  // Median line.
  const lineGen = d3
    .line()
    .x((d) => xScale(d.year))
    .y((d) => yScale(Math.max(d.median_owners, 10000)))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(data)
    .attr("class", "median-line")
    .attr("fill", "none")
    .attr("stroke", LINE_COLOR)
    .attr("stroke-width", 2.5)
    .attr("d", lineGen);

  // Focus dots + vertical guide for hover.
  const focusLine = g
    .append("line")
    .attr("class", "focus-line")
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("stroke", "#888")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "2,3")
    .attr("display", "none")
    .attr("pointer-events", "none");

  const focusDot = g
    .append("circle")
    .attr("class", "focus-dot")
    .attr("r", 4)
    .attr("fill", LINE_COLOR)
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5)
    .attr("display", "none")
    .attr("pointer-events", "none");

  // Hover overlay.
  g.append("rect")
    .attr("class", "hover-overlay")
    .attr("width", innerWidth)
    .attr("height", innerHeight)
    .attr("fill", "transparent")
    .style("cursor", "crosshair")
    .on("mouseenter", () => {
      focusLine.attr("display", null);
      focusDot.attr("display", null);
    })
    .on("mouseleave", () => {
      focusLine.attr("display", "none");
      focusDot.attr("display", "none");
      hideTooltip(tooltip);
    })
    .on("mousemove", function (event) {
      const [mx] = d3.pointer(event);
      const year = Math.round(xScale.invert(mx));
      const row = data.find((d) => d.year === year);
      if (!row) return;

      const x = xScale(year);
      const yMedian = yScale(Math.max(row.median_owners, 10000));
      focusLine.attr("x1", x).attr("x2", x);
      focusDot.attr("cx", x).attr("cy", yMedian);

      showMedianTooltip(tooltip, host, x, yMedian, row, examplesByYear.get(year));
    });

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    bandPath
      .transition()
      .duration(TRANSITION_MS)
      .attr("opacity", mode === "band" ? 1 : 0);
  }

  return {
    mode: () => mode,
    setMode,
  };
}

// ---------------------------------------------------------------------------
// Engagement chart
// ---------------------------------------------------------------------------

function createEngagementChart(host, tooltip, data) {
  const margin = { top: 24, right: 28, bottom: 40, left: 80 };
  const hostRect = host.getBoundingClientRect();
  const width = Math.max(hostRect.width, 320);
  const height = 220;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xScale = d3
    .scaleLinear()
    .domain(d3.extent(data, (d) => d.year))
    .range([0, innerWidth]);

  const yScale = d3
    .scaleLinear()
    .domain([0, 1])
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
      "Line chart of share of Steam releases with recent two-week playtime, by release year",
    );

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g")
    .attr("class", "axis axis--y")
    .call(d3.axisLeft(yScale).ticks(4).tickFormat(d3.format(".0%")))
    .call((sel) => sel.select(".domain").remove())
    .call((sel) =>
      sel
        .selectAll(".tick line")
        .attr("x2", innerWidth)
        .attr("stroke", "#ececec"),
    )
    .call((sel) => sel.selectAll(".tick text").attr("dx", -4));

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

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2)
    .attr("y", -56)
    .attr("text-anchor", "middle")
    .text("% of cohort still being played");

  // Annotations without labels (already labeled on the median chart above).
  drawAnnotations(g, xScale, innerHeight, /* withLabels */ false);

  const lineGen = d3
    .line()
    .x((d) => xScale(d.year))
    .y((d) => yScale(d.share_currently_played))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(data)
    .attr("class", "engagement-line")
    .attr("fill", "none")
    .attr("stroke", LINE_COLOR)
    .attr("stroke-width", 2.5)
    .attr("d", lineGen);

  const focusLine = g
    .append("line")
    .attr("class", "focus-line")
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("stroke", "#888")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "2,3")
    .attr("display", "none")
    .attr("pointer-events", "none");

  const focusDot = g
    .append("circle")
    .attr("class", "focus-dot")
    .attr("r", 4)
    .attr("fill", LINE_COLOR)
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5)
    .attr("display", "none")
    .attr("pointer-events", "none");

  g.append("rect")
    .attr("class", "hover-overlay")
    .attr("width", innerWidth)
    .attr("height", innerHeight)
    .attr("fill", "transparent")
    .style("cursor", "crosshair")
    .on("mouseenter", () => {
      focusLine.attr("display", null);
      focusDot.attr("display", null);
    })
    .on("mouseleave", () => {
      focusLine.attr("display", "none");
      focusDot.attr("display", "none");
      hideTooltip(tooltip);
    })
    .on("mousemove", function (event) {
      const [mx] = d3.pointer(event);
      const year = Math.round(xScale.invert(mx));
      const row = data.find((d) => d.year === year);
      if (!row) return;

      const x = xScale(year);
      const y = yScale(row.share_currently_played);
      focusLine.attr("x1", x).attr("x2", x);
      focusDot.attr("cx", x).attr("cy", y);

      showEngagementTooltip(tooltip, host, "engagement", x, y, row);
    });
}

// ---------------------------------------------------------------------------
// Annotation helper (used by both charts)
// ---------------------------------------------------------------------------

function drawAnnotations(g, xScale, innerHeight, withLabels) {
  const annotG = g.append("g").attr("class", "annotations");
  for (const a of ANNOTATIONS) {
    const x = xScale(a.year);
    annotG
      .append("line")
      .attr("x1", x)
      .attr("x2", x)
      .attr("y1", -8)
      .attr("y2", innerHeight)
      .attr("stroke", ANNOTATION_COLOR)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3");
    if (withLabels) {
      annotG
        .append("text")
        .attr("x", x)
        .attr("y", -14)
        .attr("text-anchor", "middle")
        .attr("class", "annotation-label")
        .text(`${a.label} (${a.year})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

function showMedianTooltip(el, host, anchorXInChart, anchorYInChart, row, examples) {
  const fmt = d3.format(",");
  const exampleHtml = examples && examples.examples.length
    ? `
      <div class="median-tooltip__examples-label">Three games near this median:</div>
      <ul class="median-tooltip__examples">
        ${examples.examples
          .map(
            (e) =>
              `<li><span class="median-tooltip__example-name">${escapeHtml(e.name)}</span><span class="median-tooltip__example-owners">~${fmt(e.owners_mid)}</span></li>`,
          )
          .join("")}
      </ul>
    `
    : "";

  el.innerHTML = `
    <div class="median-tooltip__title">${row.year}</div>
    <div class="median-tooltip__rows">
      <span class="median-tooltip__row-label">Median owners</span>
      <span class="median-tooltip__row-value">${fmt(row.median_owners)}</span>
      <span class="median-tooltip__row-label">25th percentile</span>
      <span class="median-tooltip__row-value">${fmt(row.p25_owners)}</span>
      <span class="median-tooltip__row-label">75th percentile</span>
      <span class="median-tooltip__row-value">${fmt(row.p75_owners)}</span>
    </div>
    ${exampleHtml}
  `;
  el.hidden = false;

  positionTooltip(el, host, "median", anchorXInChart, anchorYInChart);
}

function showEngagementTooltip(el, host, chartKey, anchorXInChart, anchorYInChart, row) {
  const fmt = d3.format(",");
  el.innerHTML = `
    <div class="median-tooltip__title">${row.year}</div>
    <div class="median-tooltip__rows">
      <span class="median-tooltip__row-label">Releases</span>
      <span class="median-tooltip__row-value">${fmt(row.total)}</span>
      <span class="median-tooltip__row-label">% still being played</span>
      <span class="median-tooltip__row-value">${(row.share_currently_played * 100).toFixed(1)}%</span>
    </div>
  `;
  el.hidden = false;

  positionTooltip(el, host, chartKey, anchorXInChart, anchorYInChart);
}

function hideTooltip(el) {
  el.hidden = true;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Tooltip is appended to the scene container (a sibling of both chart hosts),
// so screen-space positioning has to walk through the active chart's SVG and
// translate viewBox coords back to container-relative pixels.
function positionTooltip(el, host, chartKey, anchorXInChart, anchorYInChart) {
  const chartEl = host.querySelector("svg");
  if (!chartEl) return;
  const sceneRect = host.parentElement.getBoundingClientRect();
  const chartRect = chartEl.getBoundingClientRect();
  const viewBox = chartEl.viewBox.baseVal;
  const scale = chartRect.width / viewBox.width;
  const marginLeft = 80;
  const marginTop = chartKey === "median" ? 36 : 24;

  const screenX = chartRect.left - sceneRect.left + (marginLeft + anchorXInChart) * scale;
  const screenY = chartRect.top - sceneRect.top + (marginTop + anchorYInChart) * scale - 12;

  el.style.left = `${screenX}px`;
  el.style.top = `${screenY}px`;
  el.style.transform = "translate(-50%, -100%)";
}
