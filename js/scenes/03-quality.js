// Scene 3: Will anyone see your game?
// Two-mode look at what it actually feels like to release a game on Steam.
//
//   - Discoverability (default): single line per year showing the share of
//     releases that eventually crossed 50 Steam reviews. The cleanest dev-
//     facing signal — "will any audience notice my game?" — and the story
//     where the platform's growth genuinely hurts new entrants.
//   - Ratings: quantile-band chart of positive-review ratio for games that
//     DID clear 50 reviews. Conditional-on-being-found, are games well-
//     liked? The middle and top barely moved; the bottom collapsed in
//     2014-2017 and recovered post-Direct.
//
// 2025 is excluded from Discoverability — games released that year haven't
// had time to accumulate reviews, so their ratio is still climbing. Ratings
// mode keeps 2025 because the per-game ratio (for games that already cleared
// 50 reviews) is stable regardless of release year.
//
// Greenlight (2012) and Steam Direct (2017) annotations match Scenes 1 and 2
// so the same eras visually anchor the page.
//
// d3 is loaded as a global from the CDN script tag in index.html.

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

const FIRST_YEAR = 2008; // Pre-2008 cohorts have <150 games — quantiles wobble.
const LAST_YEAR_DISCOVERABILITY = 2024; // 2025 still accumulating Steam reviews.
const LAST_YEAR_RATINGS = 2025;
const TRANSITION_MS = 600;

const ACCENT = "#66c0f4";
const BAND_OUTER = "rgba(102, 192, 244, 0.16)"; // p10–p90
const BAND_INNER = "rgba(102, 192, 244, 0.36)"; // p25–p75
const LINE_AREA = "rgba(102, 192, 244, 0.14)";  // soft fill under the discoverability line

// Each mode declares what data fields to read off each year row, how to label
// the axis, and how far right the chart should draw (lastYear).
const MODES = {
  discoverability: {
    key: "discoverability",
    label: "Discoverability",
    type: "line",
    domain: [0, 1],
    tickFormat: d3.format(".0%"),
    yAxisLabel: "% of releases reaching 50 Steam reviews",
    accessor: (d) => (d.total > 0 ? d.n_steam / d.total : null),
    lastYear: LAST_YEAR_DISCOVERABILITY,
  },
  ratings: {
    key: "ratings",
    label: "Ratings",
    type: "band",
    domain: [0.4, 1.0],
    tickFormat: d3.format(".0%"),
    valueFormat: (v) => (v * 100).toFixed(1) + "%",
    yAxisLabel: "% positive reviews (per game with ≥50 reviews)",
    quantiles: (d) => ({
      p10: d.steam_p10,
      p25: d.steam_p25,
      p50: d.steam_p50,
      p75: d.steam_p75,
      p90: d.steam_p90,
    }),
    sampleN: (d) => d.n_steam,
    sampleLabel: "games ≥50 reviews",
    lastYear: LAST_YEAR_RATINGS,
  },
};

export function renderQuality(container, data) {
  container.innerHTML = "";
  container.classList.add("quality");

  const usable = data.filter((d) => d.year >= FIRST_YEAR && d.year <= 2025);

  const controls = document.createElement("div");
  controls.className = "quality-controls";
  container.appendChild(controls);

  const chartHost = document.createElement("div");
  chartHost.className = "quality-chart";
  container.appendChild(chartHost);

  const tooltip = document.createElement("div");
  tooltip.className = "quality-tooltip";
  tooltip.hidden = true;
  container.appendChild(tooltip);

  const chart = createChart(chartHost, tooltip, usable);
  buildToggle(controls, chart);
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

function buildToggle(host, chart) {
  const modes = [
    { key: "discoverability", label: "Discoverability" },
    { key: "ratings", label: "Ratings" },
  ];

  const wrap = d3.select(host).append("div").attr("class", "quality-controls__group");
  wrap
    .append("span")
    .attr("class", "quality-controls__label")
    .text("View:");

  const buttons = wrap
    .selectAll("button")
    .data(modes)
    .join("button")
    .attr("class", (d) => "quality-controls__btn" + (d.key === chart.mode() ? " is-active" : ""))
    .attr("type", "button")
    .text((d) => d.label)
    .on("click", function (event, d) {
      chart.setMode(d.key);
      buttons.classed("is-active", (m) => m.key === d.key);
    });
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

function createChart(host, tooltip, data) {
  const margin = { top: 56, right: 28, bottom: 50, left: 64 };
  const hostRect = host.getBoundingClientRect();
  const width = Math.max(hostRect.width, 320);
  const height = 540;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  let mode = "discoverability";

  // xScale spans the full data range. When Discoverability mode skips 2025,
  // the line simply stops short of the right edge — cleaner than re-scaling
  // x on every mode switch.
  const xScale = d3
    .scaleLinear()
    .domain(d3.extent(data, (d) => d.year))
    .range([0, innerWidth]);

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
      "Toggleable chart of release-cohort outcomes: discoverability (share reaching 50 reviews) or rating quantiles, by release year",
    );

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

  // Ratings-mode generators (read MODES.ratings directly so each mode owns
  // its own data access — no need to reach through `mode`).
  const areaOuter = d3
    .area()
    .x((d) => xScale(d.year))
    .y0((d) => yScale(MODES.ratings.quantiles(d).p10))
    .y1((d) => yScale(MODES.ratings.quantiles(d).p90))
    .curve(d3.curveMonotoneX)
    .defined((d) => MODES.ratings.quantiles(d).p10 !== null);

  const areaInner = d3
    .area()
    .x((d) => xScale(d.year))
    .y0((d) => yScale(MODES.ratings.quantiles(d).p25))
    .y1((d) => yScale(MODES.ratings.quantiles(d).p75))
    .curve(d3.curveMonotoneX)
    .defined((d) => MODES.ratings.quantiles(d).p25 !== null);

  const medianLine = d3
    .line()
    .x((d) => xScale(d.year))
    .y((d) => yScale(MODES.ratings.quantiles(d).p50))
    .curve(d3.curveMonotoneX)
    .defined((d) => MODES.ratings.quantiles(d).p50 !== null);

  // Discoverability-mode generators (line + soft area underneath for visual
  // weight — a bare 2px line on a 540px canvas reads as too thin).
  const discoverabilityLine = d3
    .line()
    .x((d) => xScale(d.year))
    .y((d) => yScale(MODES.discoverability.accessor(d)))
    .curve(d3.curveMonotoneX)
    .defined((d) => MODES.discoverability.accessor(d) !== null);

  const discoverabilityArea = d3
    .area()
    .x((d) => xScale(d.year))
    .y0(innerHeight)
    .y1((d) => yScale(MODES.discoverability.accessor(d)))
    .curve(d3.curveMonotoneX)
    .defined((d) => MODES.discoverability.accessor(d) !== null);

  // Paths — all created upfront, hidden/shown per mode in update().
  const outerPath = g
    .append("path")
    .attr("class", "quality-band quality-band--outer")
    .attr("fill", BAND_OUTER);

  const innerPath = g
    .append("path")
    .attr("class", "quality-band quality-band--inner")
    .attr("fill", BAND_INNER);

  const medianPath = g
    .append("path")
    .attr("class", "quality-median")
    .attr("fill", "none")
    .attr("stroke", ACCENT)
    .attr("stroke-width", 2.5);

  const lineAreaPath = g
    .append("path")
    .attr("class", "quality-line-area")
    .attr("fill", LINE_AREA);

  const linePath = g
    .append("path")
    .attr("class", "quality-line")
    .attr("fill", "none")
    .attr("stroke", ACCENT)
    .attr("stroke-width", 2.5);

  // X-axis (static — same range across modes).
  const xAxisGroup = g
    .append("g")
    .attr("class", "axis axis--x")
    .attr("transform", `translate(0,${innerHeight})`);
  const xTicks = data.map((d) => d.year).filter((y) => y % 2 === 0);
  xAxisGroup
    .call(
      d3
        .axisBottom(xScale)
        .tickValues(xTicks)
        .tickFormat(d3.format("d"))
        .tickSize(0),
    )
    .call((sel) => sel.select(".domain").remove())
    .call((sel) => sel.selectAll(".tick text").attr("dy", "1.2em"));

  // Greenlight + Direct annotations. Hover hit-target is the LABEL TEXT
  // ONLY — the dashed line and bar area get pointer-events: none so the
  // chart's hover-overlay underneath still catches year-hover. (Matches
  // Scene 1 after the same tightening.)
  const annotG = g.append("g").attr("class", "annotations");
  for (const a of ANNOTATIONS) {
    const x = xScale(a.year);
    const lineEl = annotG
      .append("line")
      .attr("x1", x)
      .attr("x2", x)
      .attr("y1", -10)
      .attr("y2", innerHeight)
      .attr("stroke", "#c7d5e0")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3")
      .attr("class", "annotation-line")
      .style("pointer-events", "none");

    const labelEl = annotG
      .append("text")
      .attr("x", x)
      .attr("y", -16)
      .attr("text-anchor", "middle")
      .attr("class", "annotation-label")
      .style("cursor", "help")
      .text(`${a.label} (${a.year})`)
      .datum(a);

    labelEl
      .on("mouseenter", (event, datum) => {
        lineEl.attr("stroke", "#ffffff").attr("stroke-width", 1.5);
        labelEl.attr("fill", "#ffffff");
        showAnnotationTooltip(tooltip, host, x, datum);
      })
      .on("mouseleave", () => {
        lineEl.attr("stroke", "#c7d5e0").attr("stroke-width", 1);
        labelEl.attr("fill", null);
        hideTooltip(tooltip);
      });
  }

  // Hover layer — vertical focus line + dot, full-width overlay snaps to
  // the nearest valid year for the current mode.
  const focusLine = g
    .append("line")
    .attr("class", "quality-focus-line")
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("stroke", "#c7d5e0")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "2,3")
    .attr("display", "none")
    .attr("pointer-events", "none");

  const focusDot = g
    .append("circle")
    .attr("class", "quality-focus-dot")
    .attr("r", 4)
    .attr("fill", ACCENT)
    .attr("stroke", "#0f1822")
    .attr("stroke-width", 1.5)
    .attr("display", "none")
    .attr("pointer-events", "none");

  g.append("rect")
    .attr("class", "quality-hover-overlay")
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
      const datum = data.find((d) => d.year === year);
      const m = MODES[mode];
      // Past mode.lastYear (e.g. 2025 in Discoverability) the chart is blank
      // — hide hover state so the dot doesn't snap to a phantom point.
      if (!datum || year > m.lastYear) {
        focusLine.attr("display", "none");
        focusDot.attr("display", "none");
        hideTooltip(tooltip);
        return;
      }

      let yVal;
      if (m.type === "line") {
        yVal = m.accessor(datum);
      } else {
        const q = m.quantiles(datum);
        yVal = q.p50;
      }
      if (yVal === null || yVal === undefined) {
        focusLine.attr("display", "none");
        focusDot.attr("display", "none");
        hideTooltip(tooltip);
        return;
      }
      const x = xScale(year);
      focusLine.attr("display", null).attr("x1", x).attr("x2", x);
      focusDot.attr("display", null).attr("cx", x).attr("cy", yScale(yVal));
      showHoverTooltip(tooltip, host, x, yScale(yVal), datum, mode);
    });

  function update(animate) {
    const m = MODES[mode];
    yScale.domain(m.domain);

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(7)
      .tickFormat(m.tickFormat);

    const t = animate ? d3.transition().duration(TRANSITION_MS) : null;

    (animate ? yAxisGroup.transition(t) : yAxisGroup)
      .call(yAxis)
      .call((sel) => sel.select(".domain").remove())
      .call((sel) =>
        sel
          .selectAll(".tick line")
          .attr("x2", innerWidth)
          .attr("stroke", "rgba(199, 213, 224, 0.12)"),
      )
      .call((sel) => sel.selectAll(".tick text").attr("dx", -4));

    yLabel.text(m.yAxisLabel);

    const visible = data.filter((d) => d.year <= m.lastYear);

    if (m.type === "line") {
      outerPath.style("display", "none");
      innerPath.style("display", "none");
      medianPath.style("display", "none");
      lineAreaPath.style("display", null);
      linePath.style("display", null);
      (animate ? lineAreaPath.transition(t) : lineAreaPath).attr(
        "d",
        discoverabilityArea(visible),
      );
      (animate ? linePath.transition(t) : linePath).attr(
        "d",
        discoverabilityLine(visible),
      );
    } else {
      outerPath.style("display", null);
      innerPath.style("display", null);
      medianPath.style("display", null);
      lineAreaPath.style("display", "none");
      linePath.style("display", "none");
      (animate ? outerPath.transition(t) : outerPath).attr("d", areaOuter(visible));
      (animate ? innerPath.transition(t) : innerPath).attr("d", areaInner(visible));
      (animate ? medianPath.transition(t) : medianPath).attr("d", medianLine(visible));
    }
  }

  update(false);

  return {
    mode: () => mode,
    setMode(next) {
      if (next === mode) return;
      mode = next;
      // Hide hover state during the transition — the dot would otherwise
      // snap because the y-domain changes underneath it.
      focusLine.attr("display", "none");
      focusDot.attr("display", "none");
      hideTooltip(tooltip);
      update(true);
    },
  };
}

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

function chartToScreen(host, anchorXInChart, anchorYInChart) {
  const chartEl = host.querySelector("svg");
  const chartRect = chartEl.getBoundingClientRect();
  const containerRect = host.parentElement.getBoundingClientRect();
  const svgViewBox = chartEl.viewBox.baseVal;
  const scale = chartRect.width / svgViewBox.width;
  const marginLeft = 64;
  const marginTop = 56;
  return {
    x: chartRect.left - containerRect.left + (marginLeft + anchorXInChart) * scale,
    y: chartRect.top - containerRect.top + (marginTop + anchorYInChart) * scale,
  };
}

function showAnnotationTooltip(el, host, anchorXInChart, datum) {
  el.innerHTML = `
    <div class="quality-tooltip__title">${datum.label} (${datum.year})</div>
    <div class="quality-tooltip__body">${datum.tooltip}</div>
  `;
  el.hidden = false;
  const { x, y } = chartToScreen(host, anchorXInChart, -16);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.transform = "translate(-50%, -100%)";
}

function showHoverTooltip(el, host, anchorXInChart, anchorYInChart, datum, mode) {
  const m = MODES[mode];
  let body;
  if (m.type === "line") {
    const v = m.accessor(datum);
    const reached = d3.format(",")(datum.n_steam);
    const total = d3.format(",")(datum.total);
    body = `
      <div class="quality-tooltip__title">${datum.year}</div>
      <div class="quality-tooltip__body">
        <strong>${(v * 100).toFixed(1)}%</strong> reached 50 reviews
        <span class="quality-tooltip__sub">${reached} of ${total} releases</span>
      </div>
    `;
  } else {
    const q = m.quantiles(datum);
    const n = m.sampleN(datum);
    // Rows ordered top→bottom of the band so eye-position matches chart-position.
    const rows = [
      ["p90", q.p90],
      ["p75", q.p75],
      ["median", q.p50],
      ["p25", q.p25],
      ["p10", q.p10],
    ]
      .map(
        ([label, value]) => `
        <span class="quality-tooltip__row-label${label === "median" ? " is-median" : ""}">${label}</span>
        <span class="quality-tooltip__row-value${label === "median" ? " is-median" : ""}">${m.valueFormat(value)}</span>
      `,
      )
      .join("");
    body = `
      <div class="quality-tooltip__title">${datum.year} — ${d3.format(",")(n)} ${m.sampleLabel}</div>
      <div class="quality-tooltip__rows">${rows}</div>
    `;
  }
  el.innerHTML = body;
  el.hidden = false;
  const { x, y } = chartToScreen(host, anchorXInChart, anchorYInChart - 12);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.transform = "translate(-50%, -100%)";
}

function hideTooltip(el) {
  el.hidden = true;
}
