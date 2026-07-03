// Clear Health — Meta Ads Performance Dashboard
// Fetches a published Google Sheet CSV and renders KPI tiles + two interactive charts.
//
// Sheet columns (standard campaign_report.py format):
//   Date, Campaign, Spend ($), Impressions, Reach, Frequency, CPM ($),
//   Clicks (All), Link Clicks, CTR (%), Link CTR (%), Cost / Link Click ($),
//   Result Type, Results, Cost / Result ($)

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRu22jxVc3EYoCCdVHloccctAI3-25GbD_GiL5xylPPfeMDLls6xWncWL2jbgJErCkh0hIu4Rn8LZXr/pub?gid=535783832&single=true&output=csv";

const METRICS = [
  { key: "spend",       label: "Amount Spent",        color: "#f59e0b", fmt: "currency", agg: "sum" },
  { key: "impressions", label: "Impressions",          color: "#94a3b8", fmt: "int",      agg: "sum" },
  { key: "reach",       label: "Reach",                color: "#7dd3fc", fmt: "int",      agg: "sum" },
  { key: "cpm",         label: "CPM",                  color: "#ef4444", fmt: "currency", agg: "ratio", num: "spend", den: "impressions", mul: 1000 },
  { key: "clicks",      label: "Clicks (All)",         color: "#a78bfa", fmt: "int",      agg: "sum" },
  { key: "linkClicks",  label: "Link Clicks",          color: "#06b6d4", fmt: "int",      agg: "sum" },
  { key: "ctr",         label: "CTR (%)",              color: "#34d399", fmt: "percent",  agg: "ratio", num: "clicks", den: "impressions", mul: 100 },
  { key: "cpc",         label: "Cost / Link Click",    color: "#f97316", fmt: "currency", agg: "ratio", num: "spend", den: "linkClicks" },
  { key: "results",     label: "Purchases (Results)",  color: "#4f46e5", fmt: "int",      agg: "sum" },
  { key: "cpr",         label: "Cost / Purchase",      color: "#ec4899", fmt: "currency", agg: "ratio", num: "spend", den: "results" },
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
      else if (c === "\r") {}
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
    date:       idx("Date"),
    campaign:   idx("Campaign"),
    spend:      idx("Spend ($)"),
    impressions:idx("Impressions"),
    reach:      idx("Reach"),
    frequency:  idx("Frequency"),
    cpm:        idx("CPM ($)"),
    clicks:     idx("Clicks (All)"),
    linkClicks: idx("Link Clicks"),
    ctr:        idx("CTR (%)"),
    linkCtr:    idx("Link CTR (%)"),
    cpc:        idx("Cost / Link Click ($)"),
    resultType: idx("Result Type"),
    results:    idx("Results"),
    cpr:        idx("Cost / Result ($)"),
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[col.date]) continue;
    const impressions = num(r[col.impressions]);
    const reach = num(r[col.reach]);
    out.push({
      date:       r[col.date].trim(),
      campaign:   (r[col.campaign] || "").trim(),
      spend:      num(r[col.spend]),
      impressions,
      reach,
      frequency:  reach > 0 ? impressions / reach : num(r[col.frequency]),
      cpm:        num(r[col.cpm]),
      clicks:     num(r[col.clicks]),
      linkClicks: num(r[col.linkClicks]),
      ctr:        num(r[col.ctr]),
      linkCtr:    num(r[col.linkCtr]),
      cpc:        num(r[col.cpc]),
      resultType: (r[col.resultType] || "").trim(),
      results:    num(r[col.results]),
      cpr:        num(r[col.cpr]),
    });
  }
  return out;
}

// ---------- Date helpers ----------

function parseDate(s) { return new Date(s + "T00:00:00Z"); }
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function startOfWeek(d) {
  const x = new Date(d.getTime());
  const offset = (x.getUTCDay() + 6) % 7;
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
  return { date, spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, results: 0 };
}

function deriveBucket(g) {
  g.frequency = g.reach > 0 ? g.impressions / g.reach : 0;
  g.cpm       = g.impressions > 0 ? g.spend / g.impressions * 1000 : 0;
  g.cpc       = g.linkClicks > 0 ? g.spend / g.linkClicks : 0;
  g.ctr       = g.impressions > 0 ? g.clicks / g.impressions * 100 : 0;
  g.linkCtr   = g.impressions > 0 ? g.linkClicks / g.impressions * 100 : 0;
  g.cpr       = g.results > 0 ? g.spend / g.results : 0;
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
    g.spend      += r.spend;
    g.impressions+= r.impressions;
    g.reach      += r.reach;
    g.clicks     += r.clicks;
    g.linkClicks += r.linkClicks;
    g.results    += r.results;
  }
  const sorted = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const g of sorted) deriveBucket(g);
  return sorted;
}

function aggregate(rows) {
  const total = emptyBucket("");
  for (const r of rows) {
    total.spend      += r.spend;
    total.impressions+= r.impressions;
    total.reach      += r.reach;
    total.clicks     += r.clicks;
    total.linkClicks += r.linkClicks;
    total.results    += r.results;
  }
  return deriveBucket(total);
}

// ---------- Formatters ----------

const fmt = {
  currency: v => "$" + (v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  int:      v => Math.round(v || 0).toLocaleString(),
  decimal:  v => (v || 0).toFixed(2),
  percent:  v => (v || 0).toFixed(2) + "%",
};
function formatMetric(value, metricKey) {
  const m = METRIC_BY_KEY[metricKey];
  return fmt[m.fmt](value);
}
function formatDelta(curr, prev, metricKey) {
  if (!isFinite(curr) || !isFinite(prev) || prev === 0) return { text: "—", cls: "flat" };
  const diff = (curr - prev) / prev * 100;
  const costMetric = ["cpm", "cpc", "cpr"].includes(metricKey);
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
  if (["spend", "cpm", "cpc", "cpr"].includes(key)) return "yDollar";
  if (["ctr", "linkCtr"].includes(key)) return "yRatio";
  return "yCount";
}

// ---------- State ----------

const state = {
  rows: [],
  windowDays: 14,
  overall: {
    activeMetrics: ["spend", "results", "linkClicks"],
    granularity: "daily",
    chart: null,
  },
  campaign: {
    activeMetrics: ["spend", "results", "cpr"],
    granularity: "daily",
    selectedCampaign: "__all__",
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
    { key: "spend",   label: "Amount Spent" },
    { key: "results", label: "Purchases" },
    { key: "cpr",     label: "Cost / Purchase" },
    { key: "linkClicks", label: "Link Clicks" },
    { key: "cpc",     label: "Cost / Click" },
  ];
  grid.innerHTML = tiles.map(t => {
    const v = curr[t.key];
    const p = prev[t.key];
    const delta = state.windowDays === "all" ? { text: "", cls: "flat" } : formatDelta(v, p, t.key);
    const prevText = state.windowDays === "all" || !isFinite(p) || p === 0
      ? "" : `prev ${formatMetric(p, t.key)}`;
    return `<div class="kpi-tile">
      <span class="label">${t.label}</span>
      <span class="value">${formatMetric(v, t.key)}</span>
      <span class="delta ${delta.cls}">${delta.text}</span>
      <span class="prev">${prevText}</span>
    </div>`;
  }).join("");

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
    const style = active ? `background:${m.color};border-color:${m.color};color:#fff;` : "";
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
    const delta = (prevTotal && state.windowDays !== "all") ? formatDelta(total[key], prevTotal[key], key) : null;
    return `<div class="stat">
      <span class="label">${label}</span>
      <span class="value">${formatMetric(total[key], key)}</span>
      ${delta ? `<span class="delta ${delta.cls}">${delta.text}</span>` : ""}
    </div>`;
  }).join("");
}

const SUMMARY_ITEMS = [
  { key: "spend",      label: "Spend" },
  { key: "impressions",label: "Impressions" },
  { key: "reach",      label: "Reach" },
  { key: "linkClicks", label: "Link Clicks" },
  { key: "cpc",        label: "Cost / Click" },
  { key: "results",    label: "Purchases" },
  { key: "cpr",        label: "Cost / Purchase" },
  { key: "cpm",        label: "CPM" },
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

function renderCampaign() {
  let rows = filterByWindow(state.rows, state.windowDays);
  if (state.campaign.selectedCampaign !== "__all__") {
    rows = rows.filter(r => r.campaign === state.campaign.selectedCampaign);
  }
  const buckets = groupByBucket(rows, state.campaign.granularity);
  if (state.campaign.chart) state.campaign.chart.destroy();
  state.campaign.chart = buildChart("campaign-chart", buckets, state.campaign.activeMetrics, state.campaign.granularity);
  let prevRows = previousWindowRows(state.rows, state.windowDays);
  if (state.campaign.selectedCampaign !== "__all__") {
    prevRows = prevRows.filter(r => r.campaign === state.campaign.selectedCampaign);
  }
  renderSummary("campaign-summary", aggregate(rows), aggregate(prevRows), SUMMARY_ITEMS);
}

// ---------- Wiring ----------

function rerenderAll() {
  renderKPIs(); renderOverall(); renderCampaign();
  const adsEl = document.getElementById("tab-ads");
  if (adsEl && !adsEl.classList.contains("hidden")) renderAdsTable();
}

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
    renderPills("overall-metrics", state.overall.activeMetrics, renderOverall);
    renderPills("campaign-metrics", state.campaign.activeMetrics, renderCampaign);
    rerenderAll();

    document.getElementById("last-refreshed").textContent =
      "Refreshed " + new Date().toLocaleString();
    document.getElementById("data-range").textContent =
      `${state.rows.length} rows`;

    document.getElementById("loading").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");

    loadAdsData();
  } catch (err) {
    console.error(err);
    document.getElementById("loading").innerHTML =
      `<p style="color:#dc2626">Error loading data: ${err.message}</p>`;
  }
}

// ─────────────────────────────────────────────
// ADS / CREATIVE AUDIT TAB
// ─────────────────────────────────────────────

const ADS_JSON_URL = "./data/ads.json";

const adsState = {
  rows: [],       // raw daily rows from ads.json
  sortCol: "spend",
  sortDir: -1,    // -1 = desc
  minSpend: 50,
  campaignFilter: "__all__",
  adsetFilter: "__all__",
};

// Ad-level feed has no Campaign column, so map ad set → campaign.
// IDs are authoritative (from Meta); the name fallback auto-categorises NEW
// ad sets (PROSP testing churns new ones constantly) so they don't fall out.
const CAMPAIGN_BY_ADSET = {
  "120234702035320171": "👑 SCALING",
  "120241556363980171": "👑 SCALING",
  "120245868841650171": "Best Performers - CBO | Cost Cap",
  "120244694395740171": "May Promo Campaign",
  "120245133370690171": "00 - PROSP | Creative Testing",
  "120233043435220171": "00 - PROSP | Creative Testing",
  "120245570690500171": "00 - PROSP | Creative Testing",
  "120243873478770171": "00 - PROSP | Creative Testing",
  "120244258479840171": "00 - PROSP | Creative Testing",
  "120234700995960171": "00 - PROSP | Creative Testing",
  "120234701806420171": "00 - PROSP | Creative Testing",
  "120246108533290171": "00 - PROSP | Creative Testing",
  "120246662460910171": "00 - PROSP | Creative Testing",
  "120246662852540171": "00 - PROSP | Creative Testing",
  "120246804639770171": "00 - PROSP | Creative Testing",
};

function campaignOf(adSetId, adSetName) {
  if (CAMPAIGN_BY_ADSET[adSetId]) return CAMPAIGN_BY_ADSET[adSetId];
  const n = adSetName || "";
  if (/cost[\s-]?cap|best\s*perform/i.test(n)) return "Best Performers - CBO | Cost Cap";
  if (/promo/i.test(n)) return "May Promo Campaign";
  if (/scaling/i.test(n)) return "👑 SCALING";
  return "00 - PROSP | Creative Testing"; // default: new test ad sets land here
}

// ── Framework decision gates ──────────────────────────────
// Source: Clients/Clear health/clear-health-creative-testing-scaling-framework.md
// Kills are PIXEL + REGISTRATION based ONLY. Event124 is offline-imported and
// lags — it is NEVER used to kill (it would pause ads before their true purchases
// land, the worst automation mistake on a long-consideration product). Event124 /
// CPE124 are shown for reporting and manual validation only.
// Decision matrix — Cost per Event124 (true offline purchase) × Cost per Registration.
// The ONLY kill is when BOTH are bad: cheap registrations redeem a high purchase cost
// (those buyers convert later). This is a MANUAL review aid — Event124 is offline and
// lags, so do NOT replicate this in Meta automated rules (it would pause ads before
// their true purchases land).
const DEC = {
  CPE124_MAX: 250,   // cost / Event124 — above this is "bad"
  CPR_MAX: 100,      // cost / registration — above this is "bad"
  // Pixel/registration fallback for ads with no Event124 yet:
  REG_GATE: 150,     // $ spent with 0 leads ⇒ nothing to show
  MATRIX_GATE: 450,  // $ spent to apply the CPReg×CPP matrix kill
  CPR_WEAK: 150,     // CPReg above this is "weak" (≤$100 = cheap-lead feeder, protected)
  CPP_WEAK: 350,     // pixel cost/purchase above this is "weak"
};

function adsStatus(ad) {
  const { cpe124, cpr, cpp, spend, registrations, purchases } = ad;
  const d = n => (n == null ? "—" : "$" + Math.round(n));

  // ── Primary: Event124 (true offline purchase) available ──────────────
  if (cpe124 !== null) {
    if (cpe124 > DEC.CPE124_MAX) {
      // High purchase cost, but cheap registrations redeem it ⇒ keep (watch).
      if (cpr !== null && cpr < DEC.CPR_MAX)
        return { code: "keep-warn", reason: `CPE124 ${d(cpe124)} >$${DEC.CPE124_MAX} but cheap regs (CPR ${d(cpr)} <$${DEC.CPR_MAX}) — keep` };
      // High purchase cost AND no cheap-lead signal ⇒ kill.
      return { code: "kill", reason: `CPE124 ${d(cpe124)} >$${DEC.CPE124_MAX} & CPR ${d(cpr)} (>$${DEC.CPR_MAX}) — kill` };
    }
    return { code: "keep", reason: `CPE124 ${d(cpe124)} ≤$${DEC.CPE124_MAX} — keep` };
  }

  // ── Fallback: no Event124 yet — judge on pixel + registration so active
  //    spend can't hide in REVIEW. (Gates read the selected window — use
  //    30d / All for lifetime waste.) ───────────────────────────────────
  if (spend >= DEC.REG_GATE && registrations === 0 && purchases === 0)
    return { code: "kill", reason: `Reg gate: $${Math.round(spend)} spent, 0 regs & 0 purchases — nothing to show` };
  if (spend >= DEC.MATRIX_GATE && cpr !== null && cpr > DEC.CPR_WEAK &&
      (purchases === 0 || (cpp !== null && cpp > DEC.CPP_WEAK)))
    return { code: "kill", reason: `Matrix kill: $${Math.round(spend)}, CPReg ${d(cpr)} (>$${DEC.CPR_WEAK}) & ${purchases === 0 ? "0 purchases" : "CPP " + d(cpp) + " (>$" + DEC.CPP_WEAK + ")"} — not a feeder` };

  return { code: "review", reason: "No Event124 yet — pixel/reg signals not yet conclusive" };
}

function statusOrder(s) {
  return { kill: 0, "keep-warn": 1, review: 2, keep: 3 }[s] ?? 4;
}

function filterAdsRows(allRows, days) {
  if (!allRows.length) return [];
  const range = dateRange(state.rows);  // use campaign rows for the window anchor
  if (!range) return allRows;
  if (days === "all") return allRows;
  const cutoff = fmtDate(addDays(range.max, -(days - 1)));
  return allRows.filter(r => r.Date >= cutoff);
}

function aggregateAds(rows) {
  const byAd = new Map();
  for (const r of rows) {
    const key = r["Ad ID"];
    if (!byAd.has(key)) {
      byAd.set(key, {
        adId: key,
        adName: r["Ad Name"],
        adSetName: r["Ad Set Name"],
        adSetId: r["Ad Set ID"],
        campaign: campaignOf(r["Ad Set ID"], r["Ad Set Name"]),
        spend: 0, event124: 0, registrations: 0, purchases: 0,
      });
    }
    const g = byAd.get(key);
    g.spend        += r["Spend"] || 0;
    g.event124     += r["Event124"] || 0;
    g.registrations+= r["Registrations"] || 0;
    g.purchases    += r["Purchases"] || 0;
  }
  const out = [];
  for (const g of byAd.values()) {
    g.spend        = Math.round(g.spend * 100) / 100;
    g.cpe124       = g.event124 > 0 ? Math.round(g.spend / g.event124 * 100) / 100 : null;
    g.cpr          = g.registrations > 0 ? Math.round(g.spend / g.registrations * 100) / 100 : null;
    g.cpp          = g.purchases > 0 ? Math.round(g.spend / g.purchases * 100) / 100 : null;
    const v        = adsStatus(g);
    g.status       = v.code;
    g.statusReason = v.reason;
    out.push(g);
  }
  return out;
}

function renderAdsKPIs(ads) {
  const grid = document.getElementById("ads-kpi-grid");
  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
  const totalEv = ads.reduce((s, a) => s + a.event124, 0);
  const totalRegs = ads.reduce((s, a) => s + a.registrations, 0);
  const totalPurch = ads.reduce((s, a) => s + a.purchases, 0);
  const blendedCPE = totalEv > 0 ? totalSpend / totalEv : null;
  const blendedCPR = totalRegs > 0 ? totalSpend / totalRegs : null;
  const blendedCPP = totalPurch > 0 ? totalSpend / totalPurch : null;
  const killCount = ads.filter(a => a.status === "kill").length;
  const keepCount = ads.filter(a => a.status === "keep" || a.status === "keep-warn").length;
  const reviewCount = ads.filter(a => a.status === "review").length;

  const tiles = [
    { label: "Total Spend",   value: "$" + totalSpend.toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2}), color: "#f59e0b" },
    { label: "Event124",      value: totalEv.toLocaleString(), sub: blendedCPE ? "CPE $" + blendedCPE.toFixed(2) : "—", color: "#6366f1" },
    { label: "Registrations", value: totalRegs.toLocaleString(), sub: blendedCPR ? "CPR $" + blendedCPR.toFixed(2) : "—", color: "#06b6d4" },
    { label: "Purchases",     value: totalPurch.toLocaleString(), sub: blendedCPP ? "CPP $" + blendedCPP.toFixed(2) : "—", color: "#10b981" },
    { label: "Kill Signals",  value: killCount, sub: `${keepCount} keep · ${reviewCount} review`, color: "#ef4444" },
  ];
  grid.innerHTML = tiles.map(t => `<div class="kpi-tile">
    <span class="label">${t.label}</span>
    <span class="value" style="color:${t.color}">${t.value}</span>
    ${t.sub ? `<span class="prev">${t.sub}</span>` : ""}
  </div>`).join("");
}

function renderAdsTable() {
  const windowRows = filterAdsRows(adsState.rows, state.windowDays);
  let ads = aggregateAds(windowRows);

  // Filters
  ads = ads.filter(a => a.spend >= adsState.minSpend);
  if (adsState.campaignFilter !== "__all__") {
    ads = ads.filter(a => a.campaign === adsState.campaignFilter);
  }
  if (adsState.adsetFilter !== "__all__") {
    ads = ads.filter(a => a.adSetId === adsState.adsetFilter);
  }

  // Sort
  const col = adsState.sortCol;
  const dir = adsState.sortDir;
  ads.sort((a, b) => {
    let va = a[col], vb = b[col];
    if (col === "status") { va = statusOrder(va); vb = statusOrder(vb); }
    if (va === null || va === undefined) va = dir > 0 ? -Infinity : Infinity;
    if (vb === null || vb === undefined) vb = dir > 0 ? -Infinity : Infinity;
    if (typeof va === "string") return dir * va.localeCompare(vb);
    return dir * (va - vb);
  });

  renderAdsKPIs(ads);

  const $c = v => v != null ? "$" + v.toFixed(2) : "—";
  const $n = v => v ? v.toLocaleString() : "—";

  const BADGE = {
    kill: `<span class="badge kill">KILL</span>`,
    "keep-warn": `<span class="badge keep-warn">KEEP ⚠</span>`,
    keep: `<span class="badge keep">KEEP</span>`,
    review: `<span class="badge review">REVIEW</span>`,
  };

  const tbody = document.getElementById("ads-tbody");
  tbody.innerHTML = ads.map(a => {
    const name = a.adName.length > 55 ? a.adName.slice(0, 55) + "…" : a.adName;
    return `<tr class="row-${a.status}">
      <td title="${a.adName.replace(/"/g,'&quot;')}">${name}</td>
      <td>${a.adSetName}</td>
      <td class="num">$${a.spend.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td class="num">${$n(a.event124)}</td>
      <td class="num">${$c(a.cpe124)}</td>
      <td class="num">${$n(a.registrations)}</td>
      <td class="num">${$c(a.cpr)}</td>
      <td class="num">${$n(a.purchases)}</td>
      <td class="num">${$c(a.cpp)}</td>
      <td title="${(a.statusReason || '').replace(/"/g,'&quot;')}">${BADGE[a.status] || ""}</td>
    </tr>`;
  }).join("");

  document.getElementById("ads-footer").textContent =
    `${ads.length} creatives · window: ${state.windowDays === "all" ? "all time" : state.windowDays + "d"} · min spend $${adsState.minSpend}`;

  // Mark sort column
  document.querySelectorAll("#ads-table th").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.col === col) th.classList.add(dir > 0 ? "sort-asc" : "sort-desc");
  });
}

function populateCampaignFilter(rows) {
  const sel = document.getElementById("ads-campaign-filter");
  if (!sel) return;
  const campaigns = [...new Set(rows.map(r => campaignOf(r["Ad Set ID"], r["Ad Set Name"])))].sort();
  sel.innerHTML = `<option value="__all__">All Campaigns</option>` +
    campaigns.map(c => `<option value="${c.replace(/"/g,"&quot;")}">${c}</option>`).join("");
}

function populateAdsetFilter(rows) {
  const sel = document.getElementById("ads-adset-filter");
  // Narrow the ad-set list to the selected campaign.
  const scoped = adsState.campaignFilter === "__all__"
    ? rows
    : rows.filter(r => campaignOf(r["Ad Set ID"], r["Ad Set Name"]) === adsState.campaignFilter);
  const adsets = [...new Map(scoped.map(r => [r["Ad Set ID"], r["Ad Set Name"]])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  sel.innerHTML = `<option value="__all__">All Ad Sets</option>` +
    adsets.map(([id, name]) => `<option value="${id}">${name}</option>`).join("");
}

function wireAdsEvents() {
  document.querySelectorAll("#ads-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (adsState.sortCol === col) adsState.sortDir *= -1;
      else { adsState.sortCol = col; adsState.sortDir = col === "adName" || col === "adSetName" || col === "status" ? 1 : -1; }
      renderAdsTable();
    });
  });
  const minSpend = document.getElementById("ads-min-spend");
  if (minSpend) minSpend.addEventListener("change", e => {
    adsState.minSpend = parseFloat(e.target.value) || 0;
    renderAdsTable();
  });
  const campaignFilter = document.getElementById("ads-campaign-filter");
  if (campaignFilter) campaignFilter.addEventListener("change", e => {
    adsState.campaignFilter = e.target.value;
    adsState.adsetFilter = "__all__";          // reset ad set when campaign changes
    populateAdsetFilter(adsState.rows);        // narrow ad-set list to this campaign
    renderAdsTable();
  });
  const adsetFilter = document.getElementById("ads-adset-filter");
  if (adsetFilter) adsetFilter.addEventListener("change", e => {
    adsState.adsetFilter = e.target.value;
    renderAdsTable();
  });
}

async function loadAdsData() {
  try {
    const res = await fetch(ADS_JSON_URL + "?_=" + Date.now());
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    adsState.rows = json.rows || [];
    populateCampaignFilter(adsState.rows);
    populateAdsetFilter(adsState.rows);
    const updated = json.updated || "";
    document.getElementById("ads-updated").textContent = updated ? "Updated " + updated : "";
  } catch (err) {
    console.warn("Could not load ads.json:", err.message);
    adsState.rows = [];
  }
}

// ─────────────────────────────────────────────
// TAB SWITCHING
// ─────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const campaignsEl = document.getElementById("tab-campaigns");
  const adsEl = document.getElementById("tab-ads");
  if (campaignsEl && adsEl) {
    if (tab === "ads") {
      campaignsEl.classList.add("hidden");
      adsEl.classList.remove("hidden");
    } else {
      campaignsEl.classList.remove("hidden");
      adsEl.classList.add("hidden");
    }
  }
  if (tab === "ads") renderAdsTable();
}

document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  wireAdsEvents();
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });
  init();
});
