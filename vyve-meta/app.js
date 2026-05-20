// Vyve Wellness — Meta Ads Performance Dashboard
// Fetches a published Google Sheet CSV and renders KPI tiles + two interactive charts.

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQa79-rJJarc6pSIcozXj9SnQDNrQlYeDjJjDCu4Tece_xedQlnmML80QtSC3gx8wIWL34Iz_Lzy2Z7/pub?gid=0&single=true&output=csv";

// Result types treated as ENGAGEMENT (excluded from "Conversions" KPI).
// Anything else with a non-empty Result Type counts as a conversion.
const ENGAGEMENT_TYPES = new Set([
  "ThruPlay", "Post engagements", "Video Views", "Link Clicks",
  "Landing Page Views", "Reach", "Impressions",
]);

const METRICS = [
  { key: "spend",        label: "Spend",         color: "#f59e0b", fmt: "currency", agg: "sum" },
  { key: "impressions",  label: "Impressions",   color: "#94a3b8", fmt: "int",      agg: "sum" },
  { key: "reach",        label: "Reach",         color: "#cbd5e1", fmt: "int",      agg: "sum" },
  { key: "frequency",    label: "Frequency",     color: "#8b5cf6", fmt: "decimal",  agg: "ratio", num: "impressions", den: "reach" },
  { key: "cpm",          label: "CPM",           color: "#ef4444", fmt: "currency", agg: "ratio", num: "spend", den: "impressions", mul: 1000 },
  { key: "clicks",       label: "Clicks (All)",  color: "#14b8a6", fmt: "int",      agg: "sum" },
  { key: "linkClicks",   label: "Link Clicks",   color: "#06b6d4", fmt: "int",      agg: "sum" },
  { key: "ctr",          label: "CTR",           color: "#22c55e", fmt: "percent",  agg: "ratio", num: "clicks", den: "impressions", mul: 100 },
  { key: "linkCtr",      label: "Link CTR",      color: "#84cc16", fmt: "percent",  agg: "ratio", num: "linkClicks", den: "impressions", mul: 100 },
  { key: "cpc",          label: "Cost/Link Click", color: "#f97316", fmt: "currency", agg: "ratio", num: "spend", den: "linkClicks" },
  { key: "conversions",  label: "Conversions",   color: "#4f46e5", fmt: "int",      agg: "sum" },
  { key: "cpa",          label: "Cost/Conv",     color: "#ec4899", fmt: "currency", agg: "ratio", num: "spend", den: "conversions" },
];
const METRIC_BY_KEY = Object.fromEntries(METRICS.map(m => [m.key, m]));

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
  if (!rows.length) return { rows: [], hasAdset: false };
  const headers = rows[0].map(h => h.trim());
  const idx = name => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  // Column resolution (tolerate "Campaign" / "Campaign name")
  const col = {
    date: idx("Date"),
    campaign: idx("Campaign") !== -1 ? idx("Campaign") : idx("Campaign name"),
    adset: idx("Ad Set"),
    spend: idx("Spend ($)"),
    impressions: idx("Impressions"),
    reach: idx("Reach"),
    frequency: idx("Frequency"),
    cpm: idx("CPM ($)"),
    clicks: idx("Clicks (All)") !== -1 ? idx("Clicks (All)") : idx("Clicks"),
    linkClicks: idx("Link Clicks"),
    ctr: idx("CTR (%)"),
    linkCtr: idx("Link CTR (%)"),
    cpc: idx("Cost / Link Click ($)"),
    resultType: idx("Result Type"),
    results: idx("Results"),
    cpa: idx("Cost / Result ($)"),
  };
  const hasAdset = col.adset !== -1;
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[col.date]) continue;
    const resultType = (r[col.resultType] || "").trim();
    const results = num(r[col.results]);
    const isConversion = resultType && !ENGAGEMENT_TYPES.has(resultType);
    out.push({
      date: r[col.date].trim(),
      campaign: (r[col.campaign] || "").trim(),
      adset: hasAdset ? (r[col.adset] || "").trim() : "",
      spend: num(r[col.spend]),
      impressions: num(r[col.impressions]),
      reach: num(r[col.reach]),
      frequency: num(r[col.frequency]),
      cpm: num(r[col.cpm]),
      clicks: num(r[col.clicks]),
      linkClicks: num(r[col.linkClicks]),
      ctr: num(r[col.ctr]),
      linkCtr: num(r[col.linkCtr]),
      cpc: num(r[col.cpc]),
      resultType,
      results,
      cpa: num(r[col.cpa]),
      conversions: isConversion ? results : 0,
    });
  }
  return { rows: out, hasAdset };
}

// ---------- Date helpers ----------

function parseDate(s) { return new Date(s + "T00:00:00Z"); }
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function startOfWeek(d) {
  const x = new Date(d.getTime());
  const day = x.getUTCDay(); // 0 Sun … 6 Sat
  const offset = (day + 6) % 7; // Monday = 0
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

function groupByBucket(rows, granularity) {
  const groups = new Map();
  for (const r of rows) {
    const d = parseDate(r.date);
    const bucketDate = granularity === "weekly" ? startOfWeek(d) : d;
    const key = fmtDate(bucketDate);
    if (!groups.has(key)) {
      groups.set(key, {
        date: key, spend: 0, impressions: 0, reach: 0,
        clicks: 0, linkClicks: 0, conversions: 0,
      });
    }
    const g = groups.get(key);
    g.spend += r.spend;
    g.impressions += r.impressions;
    g.reach += r.reach;
    g.clicks += r.clicks;
    g.linkClicks += r.linkClicks;
    g.conversions += r.conversions;
  }
  // Compute derived metrics from raw sums
  const sorted = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const g of sorted) {
    g.frequency = g.reach > 0 ? g.impressions / g.reach : 0;
    g.cpm = g.impressions > 0 ? g.spend / g.impressions * 1000 : 0;
    g.ctr = g.impressions > 0 ? g.clicks / g.impressions * 100 : 0;
    g.linkCtr = g.impressions > 0 ? g.linkClicks / g.impressions * 100 : 0;
    g.cpc = g.linkClicks > 0 ? g.spend / g.linkClicks : 0;
    g.cpa = g.conversions > 0 ? g.spend / g.conversions : 0;
  }
  return sorted;
}

function aggregate(rows) {
  const total = { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, conversions: 0 };
  for (const r of rows) {
    total.spend += r.spend;
    total.impressions += r.impressions;
    total.reach += r.reach;
    total.clicks += r.clicks;
    total.linkClicks += r.linkClicks;
    total.conversions += r.conversions;
  }
  total.frequency = total.reach > 0 ? total.impressions / total.reach : 0;
  total.cpm = total.impressions > 0 ? total.spend / total.impressions * 1000 : 0;
  total.ctr = total.impressions > 0 ? total.clicks / total.impressions * 100 : 0;
  total.linkCtr = total.impressions > 0 ? total.linkClicks / total.impressions * 100 : 0;
  total.cpc = total.linkClicks > 0 ? total.spend / total.linkClicks : 0;
  total.cpa = total.conversions > 0 ? total.spend / total.conversions : 0;
  return total;
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
function formatDelta(curr, prev) {
  if (!isFinite(curr) || !isFinite(prev) || prev === 0) return { text: "—", cls: "flat" };
  const diff = (curr - prev) / prev * 100;
  const cls = Math.abs(diff) < 0.5 ? "flat" : (diff > 0 ? "up" : "down");
  const arrow = diff > 0.5 ? "▲" : diff < -0.5 ? "▼" : "▬";
  return { text: `${arrow} ${Math.abs(diff).toFixed(1)}% vs prev`, cls };
}
function formatBucketLabel(dateStr, granularity) {
  const d = parseDate(dateStr);
  if (granularity === "weekly") {
    const end = addDays(d, 6);
    return `${("0" + d.getUTCDate()).slice(-2)}/${("0" + (d.getUTCMonth() + 1)).slice(-2)} – ${("0" + end.getUTCDate()).slice(-2)}/${("0" + (end.getUTCMonth() + 1)).slice(-2)}`;
  }
  return `${("0" + d.getUTCDate()).slice(-2)}/${("0" + (d.getUTCMonth() + 1)).slice(-2)}`;
}

// ---------- Chart axis helper ----------

function metricAxisType(key) {
  // Currency vs ratio vs count — assign to left or right axis to keep readable
  if (["spend", "cpm", "cpc", "cpa"].includes(key)) return "yDollar";
  if (["ctr", "linkCtr", "frequency"].includes(key)) return "yRatio";
  return "yCount";
}

// ---------- State ----------

const state = {
  data: { rows: [], hasAdset: false },
  windowDays: 30,
  overall: { activeMetrics: ["spend", "conversions", "linkCtr"], granularity: "weekly", chart: null },
  campaign: { activeMetrics: ["spend", "conversions"], granularity: "weekly", selectedCampaign: "__all__", selectedAdset: "__all__", chart: null },
};

// ---------- KPI rendering ----------

function renderKPIs() {
  const grid = document.getElementById("kpi-grid");
  const filtered = filterByWindow(state.data.rows, state.windowDays);
  const totalDays = state.windowDays === "all"
    ? Math.max(1, Math.round((dateRange(filtered).max - dateRange(filtered).min) / 86400000) + 1)
    : state.windowDays;

  // Previous window of equal length, immediately preceding
  const range = dateRange(state.data.rows);
  let prevRows = [];
  if (range && state.windowDays !== "all") {
    const cutoff = addDays(range.max, -(state.windowDays - 1));
    const prevEnd = addDays(cutoff, -1);
    const prevStart = addDays(prevEnd, -(state.windowDays - 1));
    prevRows = state.data.rows.filter(r => {
      const d = parseDate(r.date);
      return d >= prevStart && d <= prevEnd;
    });
  }
  const curr = aggregate(filtered);
  const prev = aggregate(prevRows);

  const tiles = [
    { key: "spend",       label: "Total Spend" },
    { key: "conversions", label: "Total Conversions" },
    { key: "cpa",         label: "Cost / Conversion" },
    { key: "linkCtr",     label: "Link CTR" },
    { key: "cpm",         label: "CPM" },
  ];
  grid.innerHTML = tiles.map(t => {
    const v = curr[t.key];
    const p = prev[t.key];
    const delta = state.windowDays === "all" ? { text: "", cls: "flat" } : formatDelta(v, p);
    return `<div class="kpi-tile">
      <span class="label">${t.label}</span>
      <span class="value">${formatMetric(v, t.key)}</span>
      <span class="delta ${delta.cls}">${delta.text}</span>
    </div>`;
  }).join("");

  // Window info
  if (state.windowDays === "all") {
    const r = dateRange(filtered);
    document.getElementById("window-info").textContent =
      r ? `${fmtDate(r.min)} → ${fmtDate(r.max)} (${totalDays} days)` : "";
  } else {
    document.getElementById("window-info").textContent = `Last ${state.windowDays} days`;
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
  const datasets = activeMetrics.map((k, i) => {
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

  const scales = { x: { grid: { color: "#f1f5f9" }, ticks: { color: "#64748b", maxRotation: 0, autoSkip: true } } };
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
            label: ctx => `${ctx.dataset.label}: ${formatMetric(ctx.parsed.y, METRICS.find(m => m.label === ctx.dataset.label).key)}`,
          },
        },
      },
      scales,
    },
  });
}

// ---------- Summary strip ----------

function renderSummary(stripId, total, items) {
  const el = document.getElementById(stripId);
  el.innerHTML = items.map(({ key, label }) =>
    `<div class="stat"><span class="label">${label}</span><span class="value">${formatMetric(total[key], key)}</span></div>`
  ).join("");
}

// ---------- Overall panel ----------

function renderOverall() {
  const filtered = filterByWindow(state.data.rows, state.windowDays);
  const buckets = groupByBucket(filtered, state.overall.granularity);
  if (state.overall.chart) state.overall.chart.destroy();
  state.overall.chart = buildChart("overall-chart", buckets, state.overall.activeMetrics, state.overall.granularity);

  const total = aggregate(filtered);
  renderSummary("overall-summary", total, [
    { key: "spend", label: "Spend" },
    { key: "impressions", label: "Impressions" },
    { key: "linkClicks", label: "Link Clicks" },
    { key: "linkCtr", label: "Link CTR" },
    { key: "conversions", label: "Conversions" },
    { key: "cpa", label: "Cost / Conv" },
  ]);
}

// ---------- Campaign panel ----------

function populateCampaignDropdown() {
  const sel = document.getElementById("campaign-select");
  const campaigns = [...new Set(state.data.rows.map(r => r.campaign).filter(Boolean))].sort();
  sel.innerHTML = `<option value="__all__">All Campaigns</option>` +
    campaigns.map(c => `<option value="${c.replace(/"/g, "&quot;")}">${c}</option>`).join("");
}
function populateAdsetDropdown() {
  const sel = document.getElementById("adset-select");
  if (!state.data.hasAdset) { sel.classList.add("hidden"); return; }
  const camp = state.campaign.selectedCampaign;
  let pool = state.data.rows;
  if (camp !== "__all__") pool = pool.filter(r => r.campaign === camp);
  const adsets = [...new Set(pool.map(r => r.adset).filter(Boolean))].sort();
  sel.innerHTML = `<option value="__all__">All Ad Sets</option>` +
    adsets.map(a => `<option value="${a.replace(/"/g, "&quot;")}">${a}</option>`).join("");
  sel.classList.remove("hidden");
}
function renderCampaign() {
  let rows = filterByWindow(state.data.rows, state.windowDays);
  if (state.campaign.selectedCampaign !== "__all__") rows = rows.filter(r => r.campaign === state.campaign.selectedCampaign);
  if (state.data.hasAdset && state.campaign.selectedAdset !== "__all__") rows = rows.filter(r => r.adset === state.campaign.selectedAdset);
  const buckets = groupByBucket(rows, state.campaign.granularity);
  if (state.campaign.chart) state.campaign.chart.destroy();
  state.campaign.chart = buildChart("campaign-chart", buckets, state.campaign.activeMetrics, state.campaign.granularity);

  const total = aggregate(rows);
  renderSummary("campaign-summary", total, [
    { key: "spend", label: "Spend" },
    { key: "impressions", label: "Impressions" },
    { key: "linkClicks", label: "Link Clicks" },
    { key: "linkCtr", label: "Link CTR" },
    { key: "conversions", label: "Conversions" },
    { key: "cpa", label: "Cost / Conv" },
  ]);
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
    state.data = loadRows(text);
    if (!state.data.rows.length) throw new Error("No rows in sheet");

    populateCampaignDropdown();
    populateAdsetDropdown();
    renderPills("overall-metrics", state.overall.activeMetrics, renderOverall);
    renderPills("campaign-metrics", state.campaign.activeMetrics, renderCampaign);
    rerenderAll();

    document.getElementById("last-refreshed").textContent =
      "Refreshed " + new Date().toLocaleString();
    document.getElementById("data-range").textContent =
      `${state.data.rows.length} rows`;

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
