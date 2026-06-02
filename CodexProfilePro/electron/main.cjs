const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const APP_NAME = "CodexProfilePro";
const APP_DIR = "CodexProfilePro";

let mainWindow = null;
let tray = null;
let refreshTimer = null;
let isRefreshing = false;

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
    return target;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  const fallback = fallbackUsageJsonPath();
  if (fsSync.existsSync(fallback)) {
    await fs.copyFile(fallback, target);
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

async function readUsageData() {
  const target = await ensureUsageJson();
  return JSON.parse(await fs.readFile(target, "utf8"));
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
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
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
    width: 1220,
    height: 860,
    minWidth: 940,
    minHeight: 700,
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

  createTray();
  createWindow();
  await ensureUsageJson();
  refreshUsageData({ broadcast: true }).catch((error) => console.error(`[${APP_NAME}] initial refresh failed`, error));
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
