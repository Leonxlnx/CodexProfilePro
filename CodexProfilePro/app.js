const DEFAULT_PROFILE = {
  name: "Codex User",
  handle: "",
  plan: "",
  avatarUrl: "",
  avatarPath: "",
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

const SHARE_CARD = {
  width: 996,
  height: 614,
  weeks: 24,
  rows: 7,
  cell: 28,
  gap: 8,
  padding: 64,
  radius: 34,
};

const SHARE_COLORS = {
  background: "#111111",
  border: "#19191A",
  empty: "#28282F",
  text: "#E6E6FF",
  muted: "#9998AA",
  divider: "#1F1F25",
  level1: "#3D2424",
  level2: "#663636",
  level3: "#8A4545",
  level4: "#AF5656",
};

const state = {
  provider: null,
  daily: [],
  byDate: new Map(),
  mode: "daily",
  isRefreshing: false,
  refreshStartedAt: 0,
  refreshElapsedTimer: null,
  refreshResultTimer: null,
  profile: { ...DEFAULT_PROFILE },
  shareDataUrl: "",
};

const els = {
  brandMark: document.getElementById("brandMark"),
  profileAvatar: document.getElementById("profileAvatar"),
  avatarFallback: document.getElementById("avatarFallback"),
  profileName: document.getElementById("profileName"),
  handleRow: document.getElementById("handleRow"),
  profileHandle: document.getElementById("profileHandle"),
  profileDot: document.getElementById("profileDot"),
  profilePlan: document.getElementById("profilePlan"),
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
  refreshLabel: document.getElementById("refreshLabel"),
  shareProfileButton: document.getElementById("shareProfileButton"),
  editProfileButton: document.getElementById("editProfileButton"),
  profileDialog: document.getElementById("profileDialog"),
  closeProfileDialog: document.getElementById("closeProfileDialog"),
  profileForm: document.getElementById("profileForm"),
  profileNameInput: document.getElementById("profileNameInput"),
  profileHandleInput: document.getElementById("profileHandleInput"),
  profilePlanInput: document.getElementById("profilePlanInput"),
  profileAvatarInput: document.getElementById("profileAvatarInput"),
  chooseAvatarButton: document.getElementById("chooseAvatarButton"),
  clearAvatarButton: document.getElementById("clearAvatarButton"),
  shareDialog: document.getElementById("shareDialog"),
  closeShareDialog: document.getElementById("closeShareDialog"),
  sharePreview: document.getElementById("sharePreview"),
  shareStatus: document.getElementById("shareStatus"),
  copyShareButton: document.getElementById("copyShareButton"),
  saveShareButton: document.getElementById("saveShareButton"),
  tooltip: document.getElementById("tooltip"),
};

init();

async function init() {
  renderProfile(DEFAULT_PROFILE);
  await Promise.all([loadProfileInfo(), loadData()]);
  renderTabs();
  renderHeatmap();
  els.refreshButton?.addEventListener("click", refreshNow);
  els.shareProfileButton?.addEventListener("click", openShareDialog);
  els.editProfileButton?.addEventListener("click", openProfileDialog);
  els.closeProfileDialog?.addEventListener("click", closeProfileDialog);
  els.profileDialog?.addEventListener("click", (event) => {
    if (event.target === els.profileDialog) {
      closeProfileDialog();
    }
  });
  els.closeShareDialog?.addEventListener("click", closeShareDialog);
  els.shareDialog?.addEventListener("click", (event) => {
    if (event.target === els.shareDialog) {
      closeShareDialog();
    }
  });
  els.profileForm?.addEventListener("submit", saveProfileFromDialog);
  els.chooseAvatarButton?.addEventListener("click", chooseProfileAvatar);
  els.clearAvatarButton?.addEventListener("click", () => {
    if (els.profileAvatarInput) {
      els.profileAvatarInput.value = "";
    }
  });
  els.copyShareButton?.addEventListener("click", copyShareImage);
  els.saveShareButton?.addEventListener("click", saveShareImage);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.shareDialog?.hidden) {
      closeShareDialog();
    } else if (!els.profileDialog?.hidden) {
      closeProfileDialog();
    }
  });
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
  const startedAt = Date.now();
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
    setRefreshLoading(false, Date.now() - startedAt);
  }
}

function setRefreshLoading(isLoading, durationMs = 0) {
  state.isRefreshing = isLoading;
  if (!els.refreshButton) return;
  els.refreshButton.classList.toggle("is-loading", isLoading);
  els.refreshButton.disabled = isLoading;
  els.refreshButton.setAttribute("aria-busy", String(isLoading));

  if (state.refreshElapsedTimer) {
    clearInterval(state.refreshElapsedTimer);
    state.refreshElapsedTimer = null;
  }
  if (state.refreshResultTimer) {
    clearTimeout(state.refreshResultTimer);
    state.refreshResultTimer = null;
  }

  if (isLoading) {
    state.refreshStartedAt = Date.now();
    updateRefreshLabel();
    state.refreshElapsedTimer = setInterval(updateRefreshLabel, 1000);
    return;
  }

  state.refreshStartedAt = 0;
  const label = durationMs > 0 ? `Updated in ${formatElapsed(durationMs)}` : "";
  setRefreshLabel(label);
  state.refreshResultTimer = setTimeout(() => setRefreshLabel(""), 4200);
}

function updateRefreshLabel() {
  const elapsed = state.refreshStartedAt ? Date.now() - state.refreshStartedAt : 0;
  setRefreshLabel(`Refreshing ${formatElapsed(elapsed)}`);
}

function setRefreshLabel(label) {
  if (!els.refreshButton || !els.refreshLabel) return;
  const hasLabel = Boolean(label);
  els.refreshLabel.textContent = label;
  els.refreshButton.classList.toggle("has-refresh-label", hasLabel);
  const aria = label || "Refresh data";
  els.refreshButton.setAttribute("aria-label", aria);
  els.refreshButton.title = aria;
}

async function loadProfileInfo() {
  try {
    let profile = null;
    if (window.profileRemake?.getProfileInfo) {
      profile = await window.profileRemake.getProfileInfo();
    }
    state.profile = { ...DEFAULT_PROFILE, ...(profile || {}) };
    renderProfile(state.profile);
  } catch (error) {
    console.error("Profile info failed", error);
    state.profile = { ...DEFAULT_PROFILE };
    renderProfile(state.profile);
  }
}

function renderProfile(profile) {
  const name = cleanDisplayText(profile.name) || DEFAULT_PROFILE.name;
  const handle = cleanDisplayText(profile.handle);
  const plan = cleanDisplayText(profile.plan);
  const avatarUrl = cleanDisplayText(profile.avatarUrl, 2048);

  els.profileName.textContent = name;
  setOptionalText(els.profileHandle, handle);
  setOptionalText(els.profilePlan, plan);
  if (els.handleRow) {
    els.handleRow.hidden = !(handle || plan);
  }
  if (els.profileDot) {
    els.profileDot.hidden = !(handle && plan);
  }

  if (els.avatarFallback) {
    els.avatarFallback.textContent = initialForName(name);
  }

  if (avatarUrl && els.profileAvatar) {
    if (els.brandMark) {
      els.brandMark.hidden = false;
    }
    els.profileAvatar.src = avatarUrl;
    els.profileAvatar.hidden = false;
    els.profileAvatar.onerror = () => {
      els.profileAvatar.hidden = true;
      els.profileAvatar.removeAttribute("src");
      if (els.brandMark) {
        els.brandMark.hidden = true;
      }
      els.brandMark?.classList.add("is-empty");
    };
    els.brandMark?.classList.remove("is-empty");
  } else {
    els.profileAvatar?.removeAttribute("src");
    if (els.profileAvatar) {
      els.profileAvatar.hidden = true;
    }
    if (els.brandMark) {
      els.brandMark.hidden = true;
    }
    els.brandMark?.classList.add("is-empty");
  }
}

function openProfileDialog() {
  if (!els.profileDialog) return;
  els.profileNameInput.value = cleanDisplayText(state.profile.name);
  els.profileHandleInput.value = cleanDisplayText(state.profile.handle);
  els.profilePlanInput.value = cleanDisplayText(state.profile.plan);
  els.profileAvatarInput.value = cleanDisplayText(state.profile.avatarPath || state.profile.avatarUrl, 2048);
  els.profileDialog.hidden = false;
  els.profileNameInput?.focus();
}

function closeProfileDialog() {
  if (els.profileDialog) {
    els.profileDialog.hidden = true;
  }
}

async function chooseProfileAvatar() {
  if (!window.profileRemake?.selectProfileAvatar) return;
  try {
    const selected = await window.profileRemake.selectProfileAvatar();
    if (selected?.avatarPath && els.profileAvatarInput) {
      els.profileAvatarInput.value = selected.avatarPath;
    }
  } catch (error) {
    console.error("Profile image selection failed", error);
  }
}

async function saveProfileFromDialog(event) {
  event.preventDefault();
  const profile = {
    name: els.profileNameInput?.value || "",
    handle: els.profileHandleInput?.value || "",
    plan: els.profilePlanInput?.value || "",
    avatarPath: els.profileAvatarInput?.value || "",
  };

  try {
    const saved = window.profileRemake?.saveProfileInfo
      ? await window.profileRemake.saveProfileInfo(profile)
      : profile;
    state.profile = { ...DEFAULT_PROFILE, ...(saved || profile) };
    renderProfile(state.profile);
    closeProfileDialog();
  } catch (error) {
    console.error("Profile save failed", error);
  }
}

async function openShareDialog() {
  if (!els.shareDialog) return;
  els.shareDialog.hidden = false;
  setShareStatus("Rendering image...");
  try {
    await renderSharePreview();
    setShareStatus("");
  } catch (error) {
    console.error("Share image render failed", error);
    setShareStatus("Could not render share image.");
  }
}

function closeShareDialog() {
  if (els.shareDialog) {
    els.shareDialog.hidden = true;
  }
}

async function renderSharePreview() {
  if (!state.provider) {
    await loadData();
  }
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  state.shareDataUrl = await createShareImageDataUrl();
  if (els.sharePreview) {
    els.sharePreview.src = state.shareDataUrl;
  }
}

async function copyShareImage() {
  try {
    if (!state.shareDataUrl) {
      await renderSharePreview();
    }
    setShareStatus("Copying image...");
    if (window.profileRemake?.copyShareImage) {
      await window.profileRemake.copyShareImage(state.shareDataUrl);
      setShareStatus("Copied image.");
      return;
    }
    setShareStatus("Copy is available in the desktop app.");
  } catch (error) {
    console.error("Share copy failed", error);
    setShareStatus("Could not copy image.");
  }
}

async function saveShareImage() {
  try {
    if (!state.shareDataUrl) {
      await renderSharePreview();
    }
    setShareStatus("Saving image...");
    if (window.profileRemake?.saveShareImage) {
      const result = await window.profileRemake.saveShareImage(state.shareDataUrl);
      setShareStatus(result?.saved ? "Saved image." : "Save cancelled.");
      return;
    }

    const link = document.createElement("a");
    link.href = state.shareDataUrl;
    link.download = `codex-profile-${isoDate(new Date())}.png`;
    link.click();
    setShareStatus("Downloaded image.");
  } catch (error) {
    console.error("Share save failed", error);
    setShareStatus("Could not save image.");
  }
}

function setShareStatus(label) {
  if (els.shareStatus) {
    els.shareStatus.textContent = label || "";
  }
}

async function createShareImageDataUrl() {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_CARD.width;
  canvas.height = SHARE_CARD.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not available");
  }

  drawShareBackground(ctx);
  await drawShareHeader(ctx);
  drawShareHeatmap(ctx);
  drawShareMetrics(ctx);

  return canvas.toDataURL("image/png");
}

function drawShareBackground(ctx) {
  ctx.clearRect(0, 0, SHARE_CARD.width, SHARE_CARD.height);
  ctx.fillStyle = SHARE_COLORS.background;
  roundedRect(ctx, 0, 0, SHARE_CARD.width, SHARE_CARD.height, SHARE_CARD.radius);
  ctx.fill();
  ctx.strokeStyle = SHARE_COLORS.border;
  ctx.lineWidth = 2;
  roundedRect(ctx, 1, 1, SHARE_CARD.width - 2, SHARE_CARD.height - 2, SHARE_CARD.radius);
  ctx.stroke();
}

async function drawShareHeader(ctx) {
  const name = cleanDisplayText(state.profile.name) || DEFAULT_PROFILE.name;
  const handle = cleanDisplayText(state.profile.handle) || "";
  const avatarUrl = cleanDisplayText(state.profile.avatarUrl, 2048);
  const avatar = await loadCanvasImage(avatarUrl, { localOnly: true });
  const codexIcon = await loadCanvasImage("./assets/codex-lobehub.svg");
  const codexWordmark = await loadCanvasImage("./assets/codex-wordmark-lobehub.svg");

  drawAvatar(ctx, avatar, name, 64, 66, 104);

  ctx.fillStyle = SHARE_COLORS.text;
  drawFittedText(ctx, name, 192, 100, 34, 500, SHARE_COLORS.text, 420, "left");
  ctx.fillStyle = SHARE_COLORS.muted;
  drawFittedText(ctx, handle, 192, 146, 24, 500, SHARE_COLORS.muted, 360, "left");

  ctx.save();
  ctx.globalAlpha = 0.86;
  if (codexIcon) {
    ctx.drawImage(codexIcon, 740, 91, 44, 44);
  }
  if (codexWordmark) {
    ctx.drawImage(codexWordmark, 810, 100, 128, 34);
  } else {
    drawFittedText(ctx, "Codex", 810, 127, 32, 700, "#AAA8C0", 128, "left");
  }
  ctx.restore();
}

function drawShareHeatmap(ctx) {
  const cells = buildShareCells();
  const x0 = 64;
  const y0 = 194;

  cells.forEach((cell) => {
    const x = x0 + (cell.col * (SHARE_CARD.cell + SHARE_CARD.gap));
    const y = y0 + (cell.row * (SHARE_CARD.cell + SHARE_CARD.gap));
    ctx.fillStyle = shareLevelColor(cell.level);
    roundedRect(ctx, x, y, SHARE_CARD.cell, SHARE_CARD.cell, 6);
    ctx.fill();
  });
}

function drawShareMetrics(ctx) {
  const stats = getProfileStats();
  const items = [
    [formatCompact(stats.total), "lifetime tokens"],
    [formatCompact(stats.peak.total), "peak day"],
    [`${stats.streaks.current || 0} days`, "current streak"],
    [`${stats.streaks.longest || 0} days`, "longest streak"],
  ];
  const left = 64;
  const width = SHARE_CARD.width - (left * 2);
  const column = width / items.length;
  const top = 490;

  ctx.strokeStyle = SHARE_COLORS.divider;
  ctx.lineWidth = 2;
  for (let index = 1; index < items.length; index += 1) {
    const x = left + (column * index);
    ctx.beginPath();
    ctx.moveTo(x, top + 4);
    ctx.lineTo(x, top + 74);
    ctx.stroke();
  }

  items.forEach(([value, label], index) => {
    const center = left + (column * index) + (column / 2);
    drawFittedText(ctx, value, center, top + 28, 34, 700, SHARE_COLORS.text, column - 24, "center");
    drawFittedText(ctx, label, center, top + 74, 24, 500, SHARE_COLORS.muted, column - 24, "center");
  });
}

function drawAvatar(ctx, image, name, x, y, size) {
  ctx.save();
  roundedRect(ctx, x, y, size, size, size / 2);
  ctx.clip();
  ctx.fillStyle = "#17171A";
  ctx.fillRect(x, y, size, size);
  if (image) {
    drawCoverImage(ctx, image, x, y, size, size);
  }
  ctx.restore();

  if (!image) {
    ctx.strokeStyle = "#24242A";
    ctx.lineWidth = 2;
    roundedRect(ctx, x + 1, y + 1, size - 2, size - 2, size / 2);
    ctx.stroke();
    drawFittedText(ctx, initialForName(name), x + (size / 2), y + 67, 40, 500, "#B8B7C7", size - 24, "center");
  }
}

function drawCoverImage(ctx, image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, x + ((width - drawWidth) / 2), y + ((height - drawHeight) / 2), drawWidth, drawHeight);
}

function buildShareCells() {
  const cells = [];
  const lastWeek = startOfWeek(graphEnd);
  const first = new Date(lastWeek.getFullYear(), lastWeek.getMonth(), lastWeek.getDate());
  first.setDate(first.getDate() - ((SHARE_CARD.weeks - 1) * 7));
  const visibleEnd = getVisibleEndDate();

  for (let col = 0; col < SHARE_CARD.weeks; col += 1) {
    for (let row = 0; row < SHARE_CARD.rows; row += 1) {
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + (col * 7) + row);
      const iso = isoDate(date);
      const value = date > visibleEnd ? 0 : state.byDate.get(iso)?.total || 0;
      cells.push({ col, row, level: dailyLevelForValue(value) });
    }
  }

  return cells;
}

function dailyLevelForValue(value) {
  if (!value) return 0;
  if (value < 150_000_000) return 1;
  if (value < 1_000_000_000) return 2;
  if (value < 50_000_000_000) return 3;
  return 4;
}

function shareLevelColor(level) {
  if (level === 1) return SHARE_COLORS.level1;
  if (level === 2) return SHARE_COLORS.level2;
  if (level === 3) return SHARE_COLORS.level3;
  if (level === 4) return SHARE_COLORS.level4;
  return SHARE_COLORS.empty;
}

function drawFittedText(ctx, text, x, y, size, weight, color, maxWidth, align = "left") {
  const value = String(text || "");
  let fontSize = size;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = align;
  ctx.fillStyle = color;
  do {
    ctx.font = `${weight} ${fontSize}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    if (ctx.measureText(value).width <= maxWidth || fontSize <= 14) break;
    fontSize -= 1;
  } while (fontSize > 14);
  ctx.fillText(value, x, y);
}

async function loadCanvasImage(src, options = {}) {
  const url = cleanDisplayText(src, 2048);
  if (!url) return null;
  if (options.localOnly && !isCanvasSafeImageUrl(url)) return null;

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    if (/^https?:\/\//i.test(url)) {
      image.crossOrigin = "anonymous";
    }
    image.src = url;
  });
}

function isCanvasSafeImageUrl(url) {
  return /^data:image\//i.test(url)
    || /^file:\/\//i.test(url)
    || /^blob:/i.test(url)
    || url.startsWith("./")
    || url.startsWith("/");
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function setOptionalText(element, value) {
  if (!element) return;
  element.textContent = value || "";
  element.hidden = !value;
}

function cleanDisplayText(value, maxLength = 80) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function initialForName(name) {
  const first = cleanDisplayText(name).match(/[A-Za-z0-9]/)?.[0];
  return (first || "C").toUpperCase();
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
  const stats = getProfileStats();

  els.lifetimeTokens.textContent = formatCompact(stats.total);
  els.peakTokens.textContent = formatCompact(stats.peak.total);
  els.longestTask.textContent = formatDuration(DEFAULT_PROFILE.longestTaskSeconds);
  els.currentStreak.textContent = `${stats.streaks.current} days`;
  els.longestStreak.textContent = `${stats.streaks.longest} days`;
}

function getProfileStats() {
  const insights = state.provider?.insights || {};
  const total = insights.totalTokens?.total
    ?? state.daily.reduce((sum, item) => sum + (item.total || 0), 0)
    ?? insights.mostUsedModel?.tokens?.total
    ?? 0;
  const peak = state.daily.reduce(
    (best, item) => ((item.total || 0) > (best.total || 0) ? item : best),
    { date: "", total: 0 }
  );
  const streaks = {
    current: insights.streaks?.current || 0,
    longest: insights.streaks?.longest || 0,
  };

  return { total, peak, streaks };
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
    const fillsWholeWeek = state.mode === "weekly" || state.mode === "cumulative";
    const hideFutureCell = isFuture && !fillsWholeWeek;
    const value = hideFutureCell ? 0 : valueByDate.get(iso) || 0;
    const cell = document.createElement("button");
    cell.className = "day-cell";
    cell.type = "button";
    cell.dataset.date = iso;
    cell.dataset.value = String(value);
    cell.dataset.level = String(levelForValue(value));
    cell.style.setProperty("--i", String(index));
    cell.setAttribute("aria-label", tooltipText(iso, value));

    if (hideFutureCell) {
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

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
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
