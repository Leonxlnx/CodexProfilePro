const PROFILE = {
  name: "leon",
  handle: "@lexn8",
  longestTaskSeconds: 538143,
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;
const weekStartsOn = 1;
const AUTO_REFRESH_MS = 60 * 1000;
let refreshTimer = null;
let graphStart = dateFromISO("2025-07-01");
let graphEnd = dateFromISO("2026-06-02");

const MODEL_PRICES_PER_1M = {
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.3-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
};

const state = {
  provider: null,
  daily: [],
  byDate: new Map(),
  mode: "daily",
  isRefreshing: false,
};

const els = {
  lifetimeTokens: document.getElementById("lifetimeTokens"),
  peakTokens: document.getElementById("peakTokens"),
  longestTask: document.getElementById("longestTask"),
  currentStreak: document.getElementById("currentStreak"),
  longestStreak: document.getElementById("longestStreak"),
  heatmap: document.getElementById("heatmap"),
  heatmapWrap: document.querySelector(".heatmap-wrap"),
  monthLabels: document.getElementById("monthLabels"),
  costSummary: document.getElementById("costSummary"),
  totalCost: document.getElementById("totalCost"),
  monthCost: document.getElementById("monthCost"),
  peakCost: document.getElementById("peakCost"),
  peakCostLabel: document.getElementById("peakCostLabel"),
  averageCost: document.getElementById("averageCost"),
  refreshButton: document.getElementById("refreshButton"),
  tooltip: document.getElementById("tooltip"),
};

init();

async function init() {
  await loadData();
  renderTabs();
  renderHeatmap();
  els.refreshButton?.addEventListener("click", refreshNow);
  startAutoRefresh();
  window.profileRemake?.onUsageDataUpdated?.((data) => {
    applyData(data);
  });
  window.addEventListener("focus", () => {
    loadData();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadData();
    }
  });
  window.addEventListener("resize", () => {
    renderHeatmap();
  });
}

async function loadData() {
  const data = await getUsageData();
  if (!data) return;
  applyData(data);
}

async function refreshNow() {
  if (state.isRefreshing) return;
  setRefreshLoading(true);
  try {
    if (window.profileRemake?.refreshUsageData) {
      const data = await window.profileRemake.refreshUsageData();
      if (data) {
        applyData(data);
        return;
      }
    }
    await loadData();
  } catch (error) {
    console.error("Refresh failed", error);
    await loadData();
  } finally {
    setRefreshLoading(false);
  }
}

function setRefreshLoading(isLoading) {
  state.isRefreshing = isLoading;
  if (!els.refreshButton) return;
  els.refreshButton.classList.toggle("is-loading", isLoading);
  els.refreshButton.disabled = isLoading;
  els.refreshButton.setAttribute("aria-busy", String(isLoading));
  els.refreshButton.setAttribute("aria-label", isLoading ? "Refreshing data" : "Refresh data");
  els.refreshButton.title = isLoading ? "Refreshing data" : "Refresh data";
}

async function getUsageData() {
  if (window.profileRemake?.readUsageData) {
    return window.profileRemake.readUsageData();
  }

  try {
    const response = await fetch(`./slopmeter.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function applyData(data) {
  state.provider = data.providers.find((item) => item.provider === "codex") || data.providers[0];
  state.daily = state.provider.daily.map((item) => ({
    ...item,
    dateObj: dateFromISO(item.date),
  }));
  state.byDate = new Map(state.daily.map((item) => [item.date, item]));
  setGraphRange(data);

  renderStats();
  renderHeatmap();
}

function startAutoRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(async () => {
    await loadData();
  }, AUTO_REFRESH_MS);
}

function renderStats() {
  const total = state.provider.insights.totalTokens?.total
    ?? state.daily.reduce((sum, item) => sum + (item.total || 0), 0)
    ?? state.provider.insights.mostUsedModel.tokens.total;
  const peak = state.daily.reduce((best, item) => (item.total > best.total ? item : best), state.daily[0]);
  const streaks = state.provider.insights.streaks;

  els.lifetimeTokens.textContent = formatCompact(total);
  els.peakTokens.textContent = formatCompact(peak.total);
  els.longestTask.textContent = formatDuration(PROFILE.longestTaskSeconds);
  els.currentStreak.textContent = `${streaks.current} days`;
  els.longestStreak.textContent = `${streaks.longest} days`;
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.mode = tab.dataset.mode;
      document.querySelectorAll(".tab").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      renderHeatmap();
    });
  });
}

function renderHeatmap() {
  const first = startOfWeek(graphStart);
  const last = endOfWeek(graphEnd);
  const visibleEnd = getVisibleEndDate();
  const allDays = [];
  for (let time = first.getTime(); time <= last.getTime(); time += DAY_MS) {
    allDays.push(new Date(time));
  }

  const columns = Math.ceil(allDays.length / 7);
  els.heatmap.style.setProperty("--weeks", columns);
  fitHeatmap(columns);
  els.heatmap.innerHTML = "";

  const valueByDate = buildValueMap(allDays);
  allDays.forEach((date, index) => {
    const iso = isoDate(date);
    const isFuture = date > visibleEnd;
    const value = isFuture ? 0 : valueByDate.get(iso) || 0;
    const cell = document.createElement("button");
    cell.className = "day-cell";
    cell.type = "button";
    cell.dataset.date = iso;
    cell.dataset.value = String(value);
    cell.dataset.level = String(levelForValue(value));
    cell.style.setProperty("--i", String(index));
    cell.setAttribute("aria-label", tooltipText(iso, value));

    if (isFuture) {
      cell.classList.add("is-future");
    }

    if (date < graphStart) {
      cell.classList.add("is-outside");
    }

    cell.addEventListener("mouseenter", (event) => showTooltip(event, iso, value));
    cell.addEventListener("mousemove", (event) => moveTooltip(event));
    cell.addEventListener("mouseleave", hideTooltip);
    cell.addEventListener("focus", (event) => showTooltip(event, iso, value));
    cell.addEventListener("blur", hideTooltip);
    els.heatmap.appendChild(cell);
  });

  renderMonthLabels(first, columns);
  renderCostSummary();
}

function getVisibleEndDate() {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return graphEnd < todayStart ? graphEnd : todayStart;
}

function fitHeatmap(columns) {
  const availableWidth = els.heatmapWrap?.clientWidth || 914;
  const gap = availableWidth < 720 ? 3 : 4;
  const maxCell = availableWidth < 720 ? 12 : 14;
  const fittedCell = Math.floor((availableWidth - ((columns - 1) * gap)) / columns);
  const cell = Math.max(7, Math.min(maxCell, fittedCell));
  const usedWidth = (cell * columns) + (gap * (columns - 1));
  const offset = Math.max(0, Math.floor((availableWidth - usedWidth) / 2));
  els.heatmap.style.setProperty("--gap", `${gap}px`);
  els.heatmap.style.setProperty("--cell", `${cell}px`);
  els.heatmap.style.width = `${usedWidth}px`;
  els.heatmap.style.marginLeft = `${offset}px`;
  els.heatmap.dataset.cell = String(cell);
  els.heatmap.dataset.gap = String(gap);
  els.heatmap.dataset.offset = String(offset);
  els.heatmap.dataset.width = String(usedWidth);
  if (els.costSummary) {
    els.costSummary.style.width = `${usedWidth}px`;
    els.costSummary.style.marginLeft = `${offset}px`;
  }
}

function getAppZoom() {
  return 1;
}

function renderCostSummary() {
  if (!els.costSummary) return;
  els.costSummary.hidden = state.mode !== "cost";
  if (state.mode !== "cost") return;

  const costs = state.daily
    .map((day) => ({ date: day.date, cost: estimateDayCost(day) }))
    .filter((item) => item.cost > 0);

  const total = costs.reduce((sum, item) => sum + item.cost, 0);
  const monthStart = new Date(graphEnd.getFullYear(), graphEnd.getMonth(), 1);
  const monthTotal = costs
    .filter((item) => dateFromISO(item.date) >= monthStart)
    .reduce((sum, item) => sum + item.cost, 0);
  const peak = costs.reduce((best, item) => (item.cost > best.cost ? item : best), { date: "", cost: 0 });
  const average = costs.length ? total / costs.length : 0;

  els.totalCost.textContent = formatCost(total);
  els.monthCost.textContent = formatCost(monthTotal);
  els.peakCost.textContent = formatCost(peak.cost);
  els.peakCostLabel.textContent = peak.date ? `Peak day · ${formatDateLabel(dateFromISO(peak.date))}` : "Peak cost day";
  els.averageCost.textContent = formatCost(average);
}

function buildValueMap(allDays) {
  if (state.mode === "daily") {
    return new Map(allDays.map((date) => {
      const iso = isoDate(date);
      return [iso, state.byDate.get(iso)?.total || 0];
    }));
  }

  if (state.mode === "cost") {
    return new Map(allDays.map((date) => {
      const iso = isoDate(date);
      return [iso, estimateDayCost(state.byDate.get(iso))];
    }));
  }

  if (state.mode === "weekly") {
    const weekly = new Map();
    allDays.forEach((date) => {
      const iso = isoDate(date);
      const week = isoDate(startOfWeek(date));
      weekly.set(week, (weekly.get(week) || 0) + (state.byDate.get(iso)?.total || 0));
    });

    const maxWeekly = Math.max(...weekly.values(), 0);
    return new Map(allDays.map((date, index) => {
      const iso = isoDate(date);
      const week = isoDate(startOfWeek(date));
      const total = weekly.get(week) || 0;
      if (!total || !maxWeekly) return [iso, 0];
      const height = Math.min(7, Math.max(1, Math.ceil((total / maxWeekly) * 7)));

      const row = index % 7;
      return [iso, row >= 7 - height ? total : 0];
    }));
  }

  let running = 0;
  const cumulativeByWeek = new Map();
  const weeks = [];
  allDays.forEach((date) => {
    const iso = isoDate(date);
    const week = isoDate(startOfWeek(date));
    if (!weeks.includes(week)) {
      weeks.push(week);
    }
    running += state.byDate.get(iso)?.total || 0;
    cumulativeByWeek.set(week, running);
  });

  const firstActiveWeek = weeks.find((week) => (cumulativeByWeek.get(week) || 0) > 0);
  const activeWeeks = firstActiveWeek ? weeks.slice(weeks.indexOf(firstActiveWeek)) : [];

  return new Map(allDays.map((date, index) => {
    const week = isoDate(startOfWeek(date));
    const cumulative = cumulativeByWeek.get(week) || 0;
    if (!cumulative || !running || !firstActiveWeek) return [isoDate(date), 0];

    const row = index % 7;
    const weekIndex = activeWeeks.indexOf(week);
    const progress = activeWeeks.length <= 1 ? 1 : weekIndex / (activeWeeks.length - 1);
    let height = 1;
    if (progress >= 0.98) height = 7;
    else if (progress >= 0.9) height = 6;
    else if (progress >= 0.82) height = 5;
    else if (progress >= 0.74) height = 4;
    else if (progress >= 0.64) height = 3;
    else if (progress >= 0.48) height = 2;
    return [isoDate(date), row >= 7 - height ? cumulative : 0];
  }));
}

function renderMonthLabels(first, columns) {
  els.monthLabels.innerHTML = "";
  const labels = [];
  for (
    let date = new Date(graphStart.getFullYear(), graphStart.getMonth(), 1);
    date <= graphEnd;
    date = new Date(date.getFullYear(), date.getMonth() + 1, 1)
  ) {
    labels.push(isoDate(date));
  }

  labels.forEach((iso) => {
    const date = dateFromISO(iso);
    const col = Math.floor((startOfWeek(date).getTime() - first.getTime()) / (DAY_MS * 7));
    const label = document.createElement("span");
    label.className = "month-label";
    label.textContent = MONTHS[date.getMonth()];
    const cell = Number(els.heatmap.dataset.cell || 0);
    const gap = Number(els.heatmap.dataset.gap || 0);
    const offset = Number(els.heatmap.dataset.offset || 0);
    label.style.left = `${offset + (col * (cell + gap))}px`;
    els.monthLabels.appendChild(label);
  });

  const width = Number(els.heatmap.dataset.width || 0);
  els.monthLabels.style.width = width ? `${width}px` : "100%";
}

function setGraphRange(data) {
  const fallbackEnd = state.daily.length ? state.daily[state.daily.length - 1].date : isoDate(new Date());
  graphEnd = dateFromISO(data.end || fallbackEnd);
  graphStart = new Date(graphEnd.getFullYear(), graphEnd.getMonth() - 11, 1);
}

function showTooltip(event, iso, value) {
  els.tooltip.textContent = tooltipText(iso, value);
  els.tooltip.style.display = "block";
  moveTooltip(event);
}

function moveTooltip(event) {
  const x = "clientX" in event ? event.clientX : event.target.getBoundingClientRect().left;
  const y = "clientY" in event ? event.clientY : event.target.getBoundingClientRect().top;
  const zoom = getAppZoom();
  const pad = 14;
  const edge = 12;
  const rect = els.tooltip.getBoundingClientRect();
  const width = rect.width || (els.tooltip.offsetWidth * zoom) || 180;
  const height = rect.height || (els.tooltip.offsetHeight * zoom) || 42;
  let left = x + pad;
  if (left + width > window.innerWidth - edge) {
    left = x - width - pad;
  }
  let top = y - height - 10;
  if (top < edge) {
    top = y + pad;
  }
  left = Math.min(Math.max(edge, left), window.innerWidth - width - edge);
  top = Math.min(Math.max(edge, top), window.innerHeight - height - edge);
  els.tooltip.style.left = `${left / zoom}px`;
  els.tooltip.style.top = `${top / zoom}px`;
}

function hideTooltip() {
  els.tooltip.style.display = "none";
}

function tooltipText(iso, value) {
  const label = formatDateLabel(dateFromISO(iso));
  if (state.mode === "weekly") {
    return `${formatNumber(value)} tokens week of ${label}`;
  }
  if (state.mode === "cumulative") {
    return `${formatNumber(value)} cumulative tokens by ${label}`;
  }
  if (state.mode === "cost") {
    return `${formatCost(value)} estimated API cost on ${label}`;
  }
  return `${formatNumber(value)} tokens on ${label}`;
}

function levelForValue(value) {
  if (!value) return 0;
  if (state.mode === "cost") {
    if (value < 25) return 1;
    if (value < 250) return 2;
    if (value < 2500) return 3;
    return 4;
  }
  if (state.mode === "cumulative") {
    return 4;
  }
  if (state.mode === "weekly") {
    return 4;
  }
  if (value < 150_000_000) return 1;
  if (value < 1_000_000_000) return 2;
  if (value < 50_000_000_000) return 3;
  return 4;
}

function estimateDayCost(day) {
  if (!day) return 0;
  const breakdown = Array.isArray(day.breakdown) && day.breakdown.length
    ? day.breakdown
    : [{ name: "gpt-5.5", tokens: day }];

  return breakdown.reduce((total, item) => total + estimateTokenCost(item.name, item.tokens), 0);
}

function estimateTokenCost(modelName, tokens = {}) {
  const price = priceForModel(modelName);
  const input = tokens.input || 0;
  const cachedInput = tokens.cache?.input || 0;
  const billableInput = Math.max(input - cachedInput, 0);
  const output = tokens.output || 0;
  return (
    (billableInput * price.input) +
    (cachedInput * price.cachedInput) +
    (output * price.output)
  ) / 1_000_000;
}

function priceForModel(modelName) {
  const model = String(modelName || "").toLowerCase();
  if (model.includes("spark") || model.includes("5.3-codex") || model.includes("codex-auto-review")) return MODEL_PRICES_PER_1M["gpt-5.3-codex"];
  if (model.includes("5.5")) return MODEL_PRICES_PER_1M["gpt-5.5"];
  if (model.includes("5.4-mini")) return MODEL_PRICES_PER_1M["gpt-5.4-mini"];
  if (model.includes("5.4")) return MODEL_PRICES_PER_1M["gpt-5.4"];
  return MODEL_PRICES_PER_1M["gpt-5.5"];
}

function formatCompact(value) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatCost(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatDateLabel(date) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function dateFromISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (result.getDay() - weekStartsOn + 7) % 7;
  result.setDate(result.getDate() - offset);
  return result;
}

function endOfWeek(date) {
  const result = startOfWeek(date);
  result.setDate(result.getDate() + 6);
  return result;
}
