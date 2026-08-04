const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const realUserDataPath = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "codex-profile-pro");
app.setName("codex-profile-pro");
app.setPath("userData", path.join(os.tmpdir(), `codex-profile-pro-verify-${process.pid}`));

async function readUsageData() {
  const appDataPath = path.join(realUserDataPath, "slopmeter.json");
  const sourcePath = path.join(root, "CodexProfilePro", "slopmeter.json");
  const usagePath = fsSync.existsSync(appDataPath) ? appDataPath : sourcePath;
  return JSON.parse(await fs.readFile(usagePath, "utf8"));
}

async function readProfileInfo() {
  const profilePath = path.join(realUserDataPath, "profile.json");
  if (!fsSync.existsSync(profilePath)) {
    return { name: "Codex User", handle: "", plan: "", avatarPath: "", avatarUrl: "" };
  }

  const profile = JSON.parse(await fs.readFile(profilePath, "utf8"));
  const avatarPath = String(profile.avatarPath || "");
  return {
    name: profile.name || "Codex User",
    handle: profile.handle || "",
    plan: profile.plan || "",
    avatarPath,
    avatarUrl: avatarPath && fsSync.existsSync(avatarPath) ? pathToFileURL(avatarPath).href : "",
    tokenDisplay: profile.tokenDisplay === "uncached" ? "uncached" : "all",
  };
}

function registerIpcHandlers() {
  ipcMain.handle("profile:read-usage-data", readUsageData);
  ipcMain.handle("profile:refresh-usage-data", readUsageData);
  ipcMain.handle("profile:get-profile-info", readProfileInfo);
  ipcMain.handle("profile:save-profile-info", (_event, profile) => profile);
  ipcMain.handle("profile:select-profile-avatar", () => null);
  ipcMain.handle("profile:copy-share-image", () => ({ copied: true }));
  ipcMain.handle("profile:save-share-image", () => ({ saved: true }));
}

async function waitForLoad(window) {
  await new Promise((resolve, reject) => {
    window.webContents.once("did-finish-load", resolve);
    window.webContents.once("did-fail-load", (_event, errorCode, errorDescription) => {
      reject(new Error(`Renderer failed to load: ${errorCode} ${errorDescription}`));
    });
    window.loadFile(path.join(root, "CodexProfilePro", "index.html"));
  });
}

async function main() {
  await app.whenReady();
  registerIpcHandlers();
  const window = new BrowserWindow({
    width: 1040,
    height: 760,
    show: false,
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(root, "CodexProfilePro", "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await waitForLoad(window);
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let i = 0; i < 80; i += 1) {
        if (document.getElementById("lifetimeTokens")?.textContent !== "...") break;
        await wait(50);
      }
      document.getElementById("shareProfileButton").click();
      for (let i = 0; i < 100; i += 1) {
        const preview = document.getElementById("sharePreview");
        if (preview?.src?.startsWith("data:image/png;base64,") && preview.naturalWidth > 0) {
          return {
            src: preview.src,
            naturalWidth: preview.naturalWidth,
            naturalHeight: preview.naturalHeight,
            dialogHidden: document.getElementById("shareDialog").hidden,
            status: document.getElementById("shareStatus").textContent,
          };
        }
        await wait(50);
      }
      return {
        src: document.getElementById("sharePreview")?.src || "",
        naturalWidth: document.getElementById("sharePreview")?.naturalWidth || 0,
        naturalHeight: document.getElementById("sharePreview")?.naturalHeight || 0,
        dialogHidden: document.getElementById("shareDialog")?.hidden,
        status: document.getElementById("shareStatus")?.textContent || "",
      };
    })()
  `, true);

  if (!result.src.startsWith("data:image/png;base64,")) {
    throw new Error(`Share preview did not render a PNG: ${JSON.stringify(result)}`);
  }
  if (result.naturalWidth !== 996 || result.naturalHeight !== 614 || result.dialogHidden) {
    throw new Error(`Unexpected share preview state: ${JSON.stringify(result)}`);
  }

  const outputPath = path.join(os.tmpdir(), "codex-profile-pro-share-preview.png");
  await fs.writeFile(outputPath, Buffer.from(result.src.split(",")[1], "base64"));
  console.log(JSON.stringify({
    ok: true,
    naturalWidth: result.naturalWidth,
    naturalHeight: result.naturalHeight,
    outputPath,
  }, null, 2));

  window.destroy();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
