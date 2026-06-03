const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 20 * 60 * 1000;
const APP_NAME = "CodexProfilePro";
const APP_DIR = "CodexProfilePro";

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
    minWidth: 560,
    minHeight: 430,
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
  ipcMain.handle("profile:get-app-info", () => ({ version: app.getVersion(), dataPath: usageJsonPath() }));

  await ensureUsageJson();
  createTray();
  if (!startHidden) {
    createWindow();
  }
  if (!(await isUsageJsonFresh())) {
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
