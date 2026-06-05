const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, dialog, clipboard } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 20 * 60 * 1000;
const APP_NAME = "CodexProfilePro";
const APP_DIR = "CodexProfilePro";
const PROFILE_FILE = "profile.json";

let mainWindow = null;
let tray = null;
let refreshTimer = null;
let isRefreshing = false;
const startHidden = process.argv.includes("--hidden") || process.argv.includes("--tray");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function appRoot() {
  return app.getAppPath();
}

function bundledPath(...segments) {
  return path.join(appRoot(), APP_DIR, ...segments);
}

function unpackedPath(...segments) {
  return path.join(process.resourcesPath, "app.asar.unpacked", APP_DIR, ...segments);
}

function userDataPath(...segments) {
  return path.join(app.getPath("userData"), ...segments);
}

function usageJsonPath() {
  return userDataPath("slopmeter.json");
}

function profileJsonPath() {
  return userDataPath(PROFILE_FILE);
}

function codexHomePath() {
  return process.env.CODEX_HOME?.trim() || path.join(app.getPath("home"), ".codex");
}

function fallbackUsageJsonPath() {
  return bundledPath("slopmeter.json");
}

function externalSeedUsageJsonPath() {
  if (!app.isPackaged) {
    return null;
  }
  return path.resolve(path.dirname(process.execPath), "..", "..", APP_DIR, "slopmeter.json");
}

function isUsageDataEmpty(data) {
  const provider = data?.providers?.[0];
  const daily = Array.isArray(provider?.daily) ? provider.daily : [];
  const total = provider?.insights?.totalTokens?.total ?? provider?.insights?.mostUsedModel?.tokens?.total ?? 0;
  return daily.length === 0 || Number(total) === 0;
}

function exporterPath() {
  if (app.isPackaged) {
    return unpackedPath("fast-codex-usage-export.mjs");
  }
  return bundledPath("fast-codex-usage-export.mjs");
}

function iconPath() {
  const ico = bundledPath("assets", "profile.ico");
  if (process.platform === "win32" && fsSync.existsSync(ico)) {
    return ico;
  }
  return bundledPath("assets", "profile-icon.png");
}

async function ensureUsageJson() {
  const target = usageJsonPath();
  if (fsSync.existsSync(target)) {
    try {
      const current = JSON.parse(await fs.readFile(target, "utf8"));
      if (isUsageDataEmpty(current)) {
        await copySeedUsageJson(target);
      }
    } catch {
      await copySeedUsageJson(target);
    }
    return target;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  if (await copySeedUsageJson(target)) {
    return target;
  } else {
    await fs.writeFile(target, JSON.stringify({
      version: "empty",
      start: new Date().toISOString().slice(0, 10),
      end: new Date().toISOString().slice(0, 10),
      providers: [{ provider: "codex", insights: { streaks: { current: 0, longest: 0 }, mostUsedModel: { name: "codex", tokens: { total: 0 } } }, daily: [] }]
    }, null, 2), "utf8");
  }
  return target;
}

async function copySeedUsageJson(target) {
  const candidates = [
    fallbackUsageJsonPath(),
    externalSeedUsageJsonPath()
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fsSync.existsSync(candidate)) {
      continue;
    }
    try {
      const payload = JSON.parse(await fs.readFile(candidate, "utf8"));
      if (!isUsageDataEmpty(payload)) {
        await fs.copyFile(candidate, target);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function readUsageData() {
  const target = await ensureUsageJson();
  return JSON.parse(await fs.readFile(target, "utf8"));
}

async function readProfileInfo() {
  const envProfile = {
    name: cleanProfileText(process.env.CODEX_PROFILE_NAME),
    handle: normalizeHandle(process.env.CODEX_PROFILE_HANDLE),
    plan: cleanProfileText(process.env.CODEX_PROFILE_PLAN, 32),
    avatarUrl: await resolveAvatarUrl(process.env.CODEX_PROFILE_AVATAR || process.env.CODEX_PROFILE_IMAGE),
  };
  const savedProfile = await readSavedProfile();
  const stateProfile = await readCodexStateProfile();
  const avatarUrl = envProfile.avatarUrl || savedProfile.avatarUrl || stateProfile.avatarUrl || "";

  return {
    name: envProfile.name || savedProfile.name || stateProfile.name || "Codex User",
    handle: envProfile.handle || savedProfile.handle || stateProfile.handle || "",
    plan: envProfile.plan || savedProfile.plan || stateProfile.plan || "",
    avatarPath: savedProfile.avatarPath || "",
    avatarUrl,
    hasAvatar: Boolean(avatarUrl),
  };
}

async function readSavedProfile() {
  const profilePath = profileJsonPath();
  if (!fsSync.existsSync(profilePath)) {
    return {};
  }

  try {
    const payload = JSON.parse(await fs.readFile(profilePath, "utf8"));
    const avatarPath = cleanProfileText(payload.avatarPath || payload.avatarUrl || payload.avatar, 2048);
    return {
      name: cleanProfileText(payload.name),
      handle: normalizeHandle(payload.handle),
      plan: cleanProfileText(payload.plan, 32),
      avatarPath,
      avatarUrl: await resolveAvatarUrl(avatarPath),
    };
  } catch {
    return {};
  }
}

async function saveProfileInfo(_event, payload = {}) {
  const avatarPath = cleanProfileText(payload.avatarPath || payload.avatarUrl || payload.avatar, 2048);
  const profile = {
    name: cleanProfileText(payload.name) || "Codex User",
    handle: normalizeHandle(payload.handle),
    plan: cleanProfileText(payload.plan, 32),
    avatarPath,
  };

  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(profileJsonPath(), JSON.stringify(profile, null, 2), "utf8");
  return readProfileInfo();
}

async function selectProfileAvatar() {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: "Choose profile image",
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["avif", "gif", "jpg", "jpeg", "jfif", "png", "webp"] },
    ],
  });
  const source = result.filePaths?.[0];
  if (result.canceled || !source) {
    return null;
  }

  const target = await copyProfileAvatar(source);
  return {
    avatarPath: target,
    avatarUrl: await resolveAvatarUrl(target),
  };
}

function shareImageBufferFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("Share image must be a PNG data URL");
  }
  return Buffer.from(match[1], "base64");
}

async function saveShareImage(_event, dataUrl) {
  const buffer = shareImageBufferFromDataUrl(dataUrl);
  const filename = `codex-profile-${new Date().toISOString().slice(0, 10)}.png`;
  const picturesPath = app.getPath("pictures") || app.getPath("home");
  const result = await dialog.showSaveDialog(mainWindow || undefined, {
    title: "Save share image",
    defaultPath: path.join(picturesPath, filename),
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (result.canceled || !result.filePath) {
    return { saved: false };
  }

  await fs.writeFile(result.filePath, buffer);
  return { saved: true, path: result.filePath };
}

function copyShareImage(_event, dataUrl) {
  shareImageBufferFromDataUrl(dataUrl);
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error("Generated share image is empty");
  }
  clipboard.writeImage(image);
  return { copied: true };
}

async function copyProfileAvatar(source) {
  const absoluteSource = pathFromProfileInput(source);
  if (!absoluteSource || !fsSync.existsSync(absoluteSource)) {
    throw new Error("Selected profile image does not exist");
  }

  const ext = path.extname(absoluteSource).toLowerCase();
  if (!/\.(avif|gif|jpe?g|jfif|png|webp)$/i.test(ext)) {
    throw new Error("Selected profile image must be an image file");
  }

  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const target = userDataPath(`profile-avatar${ext}`);
  await fs.copyFile(absoluteSource, target);
  return target;
}

async function readCodexStateProfile() {
  const statePath = path.join(codexHomePath(), ".codex-global-state.json");
  if (!fsSync.existsSync(statePath)) {
    return {};
  }

  try {
    const payload = JSON.parse(await fs.readFile(statePath, "utf8"));
    return await profileFromObject(payload);
  } catch {
    return {};
  }
}

async function profileFromObject(root) {
  const candidates = [];
  const visited = new Set();

  function walk(value, pathParts = []) {
    if (!value || typeof value !== "object" || visited.has(value) || pathParts.length > 7) {
      return;
    }
    visited.add(value);

    const profile = extractProfileFields(value);
    const pathText = pathParts.join(".").toLowerCase();
    const hasProfilePath = /(profile|account|user|viewer|me|identity)/.test(pathText);
    const score = Number(Boolean(profile.name)) + Number(Boolean(profile.handle)) + Number(Boolean(profile.avatarCandidate)) + Number(Boolean(profile.plan));
    if (score >= 1 && hasProfilePath) {
      candidates.push({ ...profile, score });
    }

    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase().includes("token") || key.toLowerCase().includes("secret")) {
        continue;
      }
      walk(child, [...pathParts, key]);
    }
  }

  walk(root);
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || {};
  return {
    name: cleanProfileText(best.name),
    handle: normalizeHandle(best.handle),
    plan: cleanProfileText(best.plan, 32),
    avatarUrl: await resolveAvatarUrl(best.avatarCandidate),
  };
}

function extractProfileFields(value) {
  return {
    name: firstString(value, ["displayName", "display_name", "fullName", "full_name", "name"]),
    handle: firstString(value, ["handle", "username", "userName", "user_name", "login"]),
    plan: firstString(value, ["plan", "subscription", "tier"]),
    avatarCandidate: firstString(value, ["avatarUrl", "avatar_url", "avatar", "imageUrl", "image_url", "picture", "photoUrl", "photo_url"]),
  };
}

function firstString(value, keys) {
  for (const key of keys) {
    if (typeof value?.[key] === "string" && value[key].trim()) {
      return value[key];
    }
  }
  return "";
}

function cleanProfileText(value, maxLength = 80) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeHandle(value) {
  const handle = cleanProfileText(value, 64).replace(/^@+/, "");
  if (!handle) return "";
  return `@${handle}`;
}

async function resolveAvatarUrl(value) {
  const candidate = cleanProfileText(value, 2048);
  if (!candidate) return "";
  if (/^https?:\/\//i.test(candidate) || /^data:image\//i.test(candidate)) {
    return candidate;
  }
  if (/^file:\/\//i.test(candidate)) {
    return candidate;
  }

  const absolutePath = pathFromProfileInput(candidate) || path.resolve(codexHomePath(), candidate);
  if (!/\.(avif|gif|jpe?g|jfif|png|webp)$/i.test(absolutePath)) {
    return "";
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return "";
    return pathToFileURL(absolutePath).href;
  } catch {
    return "";
  }
}

function pathFromProfileInput(candidate) {
  if (!candidate) return "";
  if (/^file:\/\//i.test(candidate)) {
    try {
      return fileURLToPath(candidate);
    } catch {
      return "";
    }
  }
  return path.isAbsolute(candidate) ? candidate : "";
}

async function isUsageJsonFresh(maxAgeMs = REFRESH_INTERVAL_MS) {
  try {
    const stats = await fs.stat(usageJsonPath());
    return Date.now() - stats.mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

function nodeRunner() {
  return process.execPath;
}

function nodeEnv() {
  return { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
}

async function refreshUsageData({ broadcast = true } = {}) {
  if (isRefreshing) {
    return readUsageData();
  }

  isRefreshing = true;
  try {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const target = usageJsonPath();
    const script = exporterPath();
    if (!fsSync.existsSync(script)) {
      throw new Error(`Fast exporter not found: ${script}`);
    }

    await new Promise((resolve, reject) => {
      const child = spawn(nodeRunner(), [script, target], {
        cwd: app.getPath("home"),
        env: nodeEnv(),
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"]
      });

      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Usage export timed out after ${Math.round(REFRESH_TIMEOUT_MS / 60000)} minutes`));
      }, REFRESH_TIMEOUT_MS);
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `Usage export failed with code ${code}`));
      });
    });

    const data = await readUsageData();
    if (broadcast) {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send("profile:usage-data-updated", data);
        }
      });
    }
    return data;
  } finally {
    isRefreshing = false;
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#111111",
    title: APP_NAME,
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: bundledPath("electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.setZoomFactor(1);
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isZoomShortcut = (input.control || input.meta) && ["+", "=", "-", "_", "0"].includes(input.key);
    if (isZoomShortcut) {
      event.preventDefault();
      mainWindow.webContents.setZoomFactor(1);
    }
  });

  mainWindow.loadFile(bundledPath("index.html"));
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open", click: () => createWindow() },
    { label: "Refresh now", click: () => refreshUsageData().then(() => createWindow()).catch((error) => console.error(error)) },
    { type: "separator" },
    { label: "Open data folder", click: () => shell.openPath(app.getPath("userData")) },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("click", () => createWindow());
}

function startBackgroundRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    refreshUsageData({ broadcast: true }).catch((error) => console.error(`[${APP_NAME}] refresh failed`, error));
  }, REFRESH_INTERVAL_MS);
}

app.on("second-instance", () => createWindow());

app.whenReady().then(async () => {
  ipcMain.handle("profile:read-usage-data", readUsageData);
  ipcMain.handle("profile:refresh-usage-data", () => refreshUsageData({ broadcast: false }));
  ipcMain.handle("profile:get-profile-info", readProfileInfo);
  ipcMain.handle("profile:save-profile-info", saveProfileInfo);
  ipcMain.handle("profile:select-profile-avatar", selectProfileAvatar);
  ipcMain.handle("profile:copy-share-image", copyShareImage);
  ipcMain.handle("profile:save-share-image", saveShareImage);
  ipcMain.handle("profile:get-app-info", () => ({ version: app.getVersion(), dataPath: usageJsonPath() }));

  await ensureUsageJson();
  createTray();
  if (!startHidden) {
    createWindow();
  }
  const usageData = await readUsageData();
  if (isUsageDataEmpty(usageData) || !(await isUsageJsonFresh())) {
    refreshUsageData({ broadcast: true }).catch((error) => console.error(`[${APP_NAME}] initial refresh failed`, error));
  }
  startBackgroundRefresh();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
