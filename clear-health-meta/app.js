// Clear Health — Meta Ads Performance Dashboard
// Fetches a published Google Sheet CSV and renders KPI tiles + two interactive charts.
//
// Sheet columns:
//   Date, Campaign, Ad set, Ad set ID, Impressions, Frequency, CPM,
//   Amount spent (USD), Link clicks, Cost per link click,
//   Result type, Results, Cost per result, Registrations, Cost per registration
//
// Result type values seen: "Purchase", "Event1"…"Event4" / "Event124".
// Both Purchase and Event<n> rows count toward purchases (registration → purchase ratio).

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRu22jxVc3EYoCCdVHloccctAI3-25GbD_GiL5xylPPfeMDLls6xWncWL2jbgJErCkh0hIu4Rn8LZXr/pub?output=csv";

const METRICS = [
  { key: "spend",         label: "Amount Spent",          color: "#f59e0b", fmt: "currency", agg: "sum" },
  { key: "impressions",   label: "Impressions",           color: "#94a3b8", fmt: "int",      agg: "sum" },
  { key: "frequency",     label: "Frequency",             color: "#8b5cf6", fmt: "decimal",  agg: "ratio", num: "impressions", den: "reachEst" },
  { key: "cpm",           label: "CPM",                   color: "#ef4444", fmt: "currency", agg: "ratio", num: "spend", den: "impressions", mul: 1000 },
  { key: "linkClicks",    label: "Link Clicks",           color: "#06b6d4", fmt: "int",      agg: "sum" },
  { key: "cpc",           label: "Cost / Link Click",     color: "#f97316", fmt: "currency", agg: "ratio", num: "spend", den: "linkClicks" },
  { key: "purchases",     label: "Purchases (Results)",   color: "#4f46e5", fmt: "int",      agg: "sum" },
  { key: "cpr",           label: "Cost / Purchase",       color: "#ec4899", fmt: "currency", agg: "ratio", num: "spend", den: "purchases" },
  { key: "registrations", label: "Registrations",         color: "#22c55e", fmt: "int",      agg: "sum" },
  { key: "cpreg",         label: "Cost / Registration",   color: "#14b8a6", fmt: "currency", agg: "ratio", num: "spend", den: "registrations" },
  { key: "regToPurchase", label: "Reg → Purchase Ratio",  color: "#84cc16", fmt: "decimal",  agg: "ratio", num: "registrations", den: "purchases" },
];
const METRIC_BY_KEY = Object.fromEntries(METRICS.map(m => [m.key, m]));

// A row's Result type counts toward purchases if it is "Purchase" or "Event<digits>".
function isPurchaseRow(resultType) {
  if (!resultType) return false;
  const t = resultType.trim().toLowerCase();
  return t === "purchase" || /^event\d+$/.test(t);
}

// ---------- CSV parsing ----------

function parseCSV(text) {
  const rows = [];
  let cur = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(cell); cell = ""; }
      else if (c === "\n") { cur.push(cell); rows.push(cur); cur = []; cell = ""; }
      else if (c === "\r") {} // ignore
      else cell += c;
    }
  }
  if (cell.length || cur.length) { cur.push(cell); rows.push(cur); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0]));
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function loadRows(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  const idx = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const col = {
    date: idx("Date"),
    campaign: idx("Campaign"),
    adset: idx("Ad set"),
    impressions: idx("Impressions"),
    frequency: idx("Frequency"),
    cpm: idx("CPM"),
    spend: idx("Amount spent (USD)"),
    linkClicks: idx("Link clicks"),
    cpc: idx("Cost per link click"),
    resultType: idx("Result type"),
    results: idx("Results"),
    cpr: idx("Cost per result"),
    registrations: idx("Registrations"),
    cpreg: idx("Cost per registration"),
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[col.date]) continue;
    const resultType = (r[col.resultType] || "").trim();
    const results = num(r[col.results]);
    const purchases = isPurchaseRow(resultType) ? results : 0;
    const impressions = num(r[col.impressions]);
    const frequency = num(r[col.frequency]);
    // Reach is not in the sheet — derive an estimate per row so frequency can be
    // re-aggregated correctly (frequency = impressions / reach).
    const reachEst = frequency > 0 ? impressions / frequency : 0;
    out.push({
      date: r[col.date].trim(),
      campaign: (r[col.campaign] || "").trim(),
      adset: (r[col.adset] || "").trim(),
      impressions,
      reachEst,
      frequency,
      cpm: num(r[col.cpm]),
      spend: num(r[col.spend]),
      linkClicks: num(r[col.linkClicks]),
      cpc: num(r[col.cpc]),
      resultType,
      results,
      purchases,
      cpr: num(r[col.cpr]),
      registrations: num(r[col.registrations]),
      cpreg: num(r[col.cpreg]),
    });
  }
  return out;
}

// ---------- Date helpers ----------

function parseDate(s) { return new Date(s + "T00:00:00Z"); }
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function startOfWeek(d) {
  const x = new Date(d.getTime());
  const day = x.getUTCDay();
  const offset = (day + 6) % 7;
  x.setUTCDate(x.getUTCDate() - offset);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }
function dateRange(rows) {
  if (!rows.length) return null;
  const dates = rows.map(r => parseDate(r.date)).sort((a, b) => a - b);
  return { min: dates[0], max: dates[dates.length - 1] };
}

// ---------- Filtering + aggregation ----------

function filterByWindow(rows, days) {
  if (days === "all") return rows;
  const range = dateRange(rows);
  if (!range) return [];
  const cutoff = addDays(range.max, -(days - 1));
  return rows.filter(r => parseDate(r.date) >= cutoff);
}

function previousWindowRows(rows, days) {
  if (days === "all") return [];
  const range = dateRange(rows);
  if (!range) return [];
  const cutoff = addDays(range.max, -(days - 1));
  const prevEnd = addDays(cutoff, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return rows.filter(r => {
    const d = parseDate(r.date);
    return d >= prevStart && d <= prevEnd;
  });
}

function emptyBucket(date) {
  return {
    date,
    spend: 0, impressions: 0, reachEst: 0, linkClicks: 0,
    purchases: 0, registrations: 0,
  };
}

function deriveBucket(g) {
  g.frequency = g.reachEst > 0 ? g.impressions / g.reachEst : 0;
  g.cpm = g.impressions > 0 ? g.spend / g.impressions * 1000 : 0;
  g.cpc = g.linkClicks > 0 ? g.spend / g.linkClicks : 0;
  g.cpr = g.purchases > 0 ? g.spend / g.purchases : 0;
  g.cpreg = g.registrations > 0 ? g.spend / g.registrations : 0;
  g.regToPurchase = g.purchases > 0 ? g.registrations / g.purchases : 0;
  g.results = g.purchases; // alias
  return g;
}

function groupByBucket(rows, granularity) {
  const groups = new Map();
  for (const r of rows) {
    const d = parseDate(r.date);
    const bucketDate = granularity === "weekly" ? startOfWeek(d) : d;
    const key = fmtDate(bucketDate);
    if (!groups.has(key)) groups.set(key, emptyBucket(key));
    const g = groups.get(key);
    g.spend += r.spend;
    g.impressions += r.impressions;
    g.reachEst += r.reachEst;
    g.linkClicks += r.linkClicks;
    g.purchases += r.purchases;
    g.registrations += r.registrations;
  }
  const sorted = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const g of sorted) deriveBucket(g);
  return sorted;
}

function aggregate(rows) {
  const total = emptyBucket("");
  for (const r of rows) {
    total.spend += r.spend;
    total.impressions += r.impressions;
    total.reachEst += r.reachEst;
    total.linkClicks += r.linkClicks;
    total.purchases += r.purchases;
    total.registrations += r.registrations;
  }
  return deriveBucket(total);
}

// ---------- Formatters ----------

const fmt = {
  currency: v => "$" + (v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  int: v => Math.round(v || 0).toLocaleString(),
  decimal: v => (v || 0).toFixed(2),
  percent: v => (v || 0).toFixed(2) + "%",
};
function formatMetric(value, metricKey) {
  const m = METRIC_BY_KEY[metricKey];
  return fmt[m.fmt](value);
}
function formatDelta(curr, prev, metricKey) {
  if (!isFinite(curr) || !isFinite(prev) || prev === 0) return { text: "—", cls: "flat" };
  const diff = (curr - prev) / prev * 100;
  // For cost metrics, lower is better — invert color.
  const costMetric = ["cpm", "cpc", "cpr", "cpreg", "regToPurchase"].includes(metricKey);
  let cls;
  if (Math.abs(diff) < 0.5) cls = "flat";
  else if (costMetric) cls = diff > 0 ? "down" : "up";
  else cls = diff > 0 ? "up" : "down";
  const arrow = diff > 0.5 ? "▲" : diff < -0.5 ? "▼" : "▬";
  return { text: `${arrow} ${Math.abs(diff).toFixed(1)}% vs prev`, cls };
}
function formatBucketLabel(dateStr, granularity) {
  const d = parseDate(dateStr);
  const dd = ("0" + d.getUTCDate()).slice(-2);
  const mm = ("0" + (d.getUTCMonth() + 1)).slice(-2);
  if (granularity === "weekly") {
    const end = addDays(d, 6);
    const dd2 = ("0" + end.getUTCDate()).slice(-2);
    const mm2 = ("0" + (end.getUTCMonth() + 1)).slice(-2);
    return `${dd}/${mm} – ${dd2}/${mm2}`;
  }
  return `${dd}/${mm}`;
}

// ---------- Chart axis assignment ----------

function metricAxisType(key) {
  if (["spend", "cpm", "cpc", "cpr", "cpreg"].includes(key)) return "yDollar";
  if (["frequency", "regToPurchase"].includes(key)) return "yRatio";
  return "yCount";
}

// ---------- State ----------

const state = {
  rows: [],
  windowDays: 14,
  overall: {
    activeMetrics: ["spend", "purchases", "registrations"],
    granularity: "daily",
    chart: null,
  },
  campaign: {
    activeMetrics: ["spend", "purchases", "regToPurchase"],
    granularity: "daily",
    selectedCampaign: "__all__",
    selectedAdset: "__all__",
    chart: null,
  },
};

// ---------- KPI rendering ----------

function renderKPIs() {
  const grid = document.getElementById("kpi-grid");
  const filtered = filterByWindow(state.rows, state.windowDays);
  const prevRows = previousWindowRows(state.rows, state.windowDays);
  const curr = aggregate(filtered);
  const prev = aggregate(prevRows);

  const tiles = [
    { key: "spend",         label: "Amount Spent" },
    { key: "purchases",     label: "Purchases" },
    { key: "cpr",           label: "Cost / Purchase" },
    { key: "registrations", label: "Registrations" },
    { key: "regToPurchase", label: "Reg → Purchase" },
  ];
  grid.innerHTML = tiles.map(t => {
    const v = curr[t.key];
    const p = prev[t.key];
    const delta = state.windowDays === "all" ? { text: "", cls: "flat" } : formatDelta(v, p, t.key);
    const prevText = state.windowDays === "all" || !isFinite(p) || p === 0
      ? ""
      : `prev ${formatMetric(p, t.key)}`;
    return `<div class="kpi-tile">
      <span class="label">${t.label}</span>
      <span class="value">${formatMetric(v, t.key)}</span>
      <span class="delta ${delta.cls}">${delta.text}</span>
      <span class="prev">${prevText}</span>
    </div>`;
  }).join("");

  // Window info
  const range = dateRange(filtered);
  if (state.windowDays === "all") {
    const totalDays = range ? Math.round((range.max - range.min) / 86400000) + 1 : 0;
    document.getElementById("window-info").textContent =
      range ? `${fmtDate(range.min)} → ${fmtDate(range.max)} (${totalDays} days)` : "";
  } else {
    const labelEnd = range ? fmtDate(range.max) : "";
    const labelStart = range ? fmtDate(addDays(range.max, -(state.windowDays - 1))) : "";
    document.getElementById("window-info").textContent =
      `Last ${state.windowDays} days · ${labelStart} → ${labelEnd}`;
  }
}

// ---------- Pill rendering ----------

function renderPills(containerId, activeMetrics, onChange) {
  const c = document.getElementById(containerId);
  c.innerHTML = METRICS.map(m => {
    const active = activeMetrics.includes(m.key);
    const style = active
      ? `background:${m.color};border-color:${m.color};color:#fff;`
      : "";
    const dotStyle = active ? "background:#fff" : `background:${m.color}`;
    return `<span class="pill${active ? " active" : ""}" data-key="${m.key}" style="${style}">
      <span class="dot" style="${dotStyle}"></span>${m.label}${active ? " ✓" : ""}
    </span>`;
  }).join("");
  c.querySelectorAll(".pill").forEach(p => {
    p.addEventListener("click", () => {
      const key = p.dataset.key;
      const idx = activeMetrics.indexOf(key);
      if (idx >= 0) activeMetrics.splice(idx, 1);
      else activeMetrics.push(key);
      if (activeMetrics.length === 0) activeMetrics.push(key);
      renderPills(containerId, activeMetrics, onChange);
      onChange();
    });
  });
}

// ---------- Chart rendering ----------

function buildChart(canvasId, buckets, activeMetrics, granularity) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  const labels = buckets.map(b => formatBucketLabel(b.date, granularity));
  const usedAxes = new Set(activeMetrics.map(k => metricAxisType(k)));
  const datasets = activeMetrics.map(k => {
    const m = METRIC_BY_KEY[k];
    return {
      label: m.label,
      data: buckets.map(b => b[k]),
      backgroundColor: m.color + "33",
      borderColor: m.color,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      fill: false,
      yAxisID: metricAxisType(k),
      type: "line",
    };
  });

  const scales = {
    x: { grid: { color: "#f1f5f9" }, ticks: { color: "#64748b", maxRotation: 0, autoSkip: true } },
  };
  if (usedAxes.has("yDollar")) {
    scales.yDollar = { type: "linear", position: "left", grid: { color: "#f1f5f9" },
      ticks: { color: "#64748b", callback: v => "$" + v.toLocaleString() } };
  }
  if (usedAxes.has("yCount")) {
    scales.yCount = { type: "linear", position: usedAxes.has("yDollar") ? "right" : "left",
      grid: { color: usedAxes.has("yDollar") ? "transparent" : "#f1f5f9" },
      ticks: { color: "#64748b", callback: v => v.toLocaleString() } };
  }
  if (usedAxes.has("yRatio")) {
    scales.yRatio = { type: "linear", position: "right",
      grid: { color: "transparent" },
      ticks: { color: "#64748b", callback: v => v.toFixed(2) } };
  }

  return new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "top", align: "end",
          labels: { boxWidth: 10, boxHeight: 10, color: "#475569", font: { size: 12 } } },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          titleColor: "#fff", bodyColor: "#e2e8f0", borderColor: "#1e293b",
          borderWidth: 1, padding: 10, cornerRadius: 6,
          callbacks: {
            label: ctx => {
              const m = METRICS.find(x => x.label === ctx.dataset.label);
              return `${ctx.dataset.label}: ${formatMetric(ctx.parsed.y, m.key)}`;
            },
          },
        },
      },
      scales,
    },
  });
}

// ---------- Summary strip ----------

function renderSummary(stripId, total, prevTotal, items) {
  const el = document.getElementById(stripId);
  el.innerHTML = items.map(({ key, label }) => {
    const delta = (prevTotal && state.windowDays !== "all") ? formatDelta(total[key], prevTotal[key]) : null;
    return `<div class="stat">
      <span class="label">${label}</span>
      <span class="value">${formatMetric(total[key], key)}</span>
      ${delta ? `<span class="delta ${delta.cls}">${delta.text}</span>` : ""}
    </div>`;
  }).join("");
}

const SUMMARY_ITEMS = [
  { key: "spend", label: "Spend" },
  { key: "impressions", label: "Impressions" },
  { key: "linkClicks", label: "Link Clicks" },
  { key: "purchases", label: "Purchases" },
  { key: "cpr", label: "Cost / Purchase" },
  { key: "registrations", label: "Registrations" },
  { key: "cpreg", label: "Cost / Reg" },
  { key: "regToPurchase", label: "Reg → Purchase" },
];

// ---------- Overall panel ----------

function renderOverall() {
  const filtered = filterByWindow(state.rows, state.windowDays);
  const buckets = groupByBucket(filtered, state.overall.granularity);
  if (state.overall.chart) state.overall.chart.destroy();
  state.overall.chart = buildChart("overall-chart", buckets, state.overall.activeMetrics, state.overall.granularity);
  renderSummary("overall-summary", aggregate(filtered), aggregate(previousWindowRows(state.rows, state.windowDays)), SUMMARY_ITEMS);
}

// ---------- Campaign panel ----------

function populateCampaignDropdown() {
  const sel = document.getElementById("campaign-select");
  const campaigns = [...new Set(state.rows.map(r => r.campaign).filter(Boolean))].sort();
  sel.innerHTML = `<option value="__all__">All Campaigns</option>` +
    campaigns.map(c => `<option value="${c.replace(/"/g, "&quot;")}">${c}</option>`).join("");
}
function populateAdsetDropdown() {
  const sel = document.getElementById("adset-select");
  const camp = state.campaign.selectedCampaign;
  let pool = state.rows;
  if (camp !== "__all__") pool = pool.filter(r => r.campaign === camp);
  const adsets = [...new Set(pool.map(r => r.adset).filter(Boolean))].sort();
  sel.innerHTML = `<option value="__all__">All Ad Sets</option>` +
    adsets.map(a => `<option value="${a.replace(/"/g, "&quot;")}">${a}</option>`).join("");
}
function renderCampaign() {
  let rows = filterByWindow(state.rows, state.windowDays);
  if (state.campaign.selectedCampaign !== "__all__") {
    rows = rows.filter(r => r.campaign === state.campaign.selectedCampaign);
  }
  if (state.campaign.selectedAdset !== "__all__") {
    rows = rows.filter(r => r.adset === state.campaign.selectedAdset);
  }
  const buckets = groupByBucket(rows, state.campaign.granularity);
  if (state.campaign.chart) state.campaign.chart.destroy();
  state.campaign.chart = buildChart("campaign-chart", buckets, state.campaign.activeMetrics, state.campaign.granularity);
  let _prevCH = previousWindowRows(state.rows, state.windowDays);
  if (state.campaign.selectedCampaign !== "__all__") _prevCH = _prevCH.filter(r => r.campaign === state.campaign.selectedCampaign);
  if (state.campaign.selectedAdset !== "__all__") _prevCH = _prevCH.filter(r => r.adset === state.campaign.selectedAdset);
  renderSummary("campaign-summary", aggregate(rows), aggregate(_prevCH), SUMMARY_ITEMS);
}

// ---------- Wiring ----------

function rerenderAll() { renderKPIs(); renderOverall(); renderCampaign(); }

function wireEvents() {
  document.querySelectorAll("#date-quick button").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#date-quick button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      const d = b.dataset.days;
      state.windowDays = d === "all" ? "all" : parseInt(d, 10);
      rerenderAll();
    });
  });
  document.querySelectorAll("#overall-granularity button").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#overall-granularity button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      state.overall.granularity = b.dataset.gran;
      renderOverall();
    });
  });
  document.querySelectorAll("#campaign-granularity button").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#campaign-granularity button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      state.campaign.granularity = b.dataset.gran;
      renderCampaign();
    });
  });
  document.getElementById("campaign-select").addEventListener("change", e => {
    state.campaign.selectedCampaign = e.target.value;
    state.campaign.selectedAdset = "__all__";
    populateAdsetDropdown();
    renderCampaign();
  });
  document.getElementById("adset-select").addEventListener("change", e => {
    state.campaign.selectedAdset = e.target.value;
    renderCampaign();
  });
  document.getElementById("refresh-btn").addEventListener("click", () => init(true));
}

async function init(force = false) {
  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
  try {
    const url = CSV_URL + (force ? "&_=" + Date.now() : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error("CSV fetch failed: " + res.status);
    const text = await res.text();
    state.rows = loadRows(text);
    if (!state.rows.length) throw new Error("No rows in sheet");

    populateCampaignDropdown();
    populateAdsetDropdown();
    renderPills("overall-metrics", state.overall.activeMetrics, renderOverall);
    renderPills("campaign-metrics", state.campaign.activeMetrics, renderCampaign);
    rerenderAll();

    document.getElementById("last-refreshed").textContent =
      "Refreshed " + new Date().toLocaleString();
    document.getElementById("data-range").textContent =
      `${state.rows.length} rows`;

    document.getElementById("loading").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    document.getElementById("loading").innerHTML =
      `<p style="color:#dc2626">Error loading data: ${err.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  init();
});
