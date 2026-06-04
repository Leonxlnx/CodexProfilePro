const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("profileRemake", {
  readUsageData: () => ipcRenderer.invoke("profile:read-usage-data"),
  refreshUsageData: () => ipcRenderer.invoke("profile:refresh-usage-data"),
  getProfileInfo: () => ipcRenderer.invoke("profile:get-profile-info"),
  getAppInfo: () => ipcRenderer.invoke("profile:get-app-info"),
  onUsageDataUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("profile:usage-data-updated", listener);
    return () => ipcRenderer.removeListener("profile:usage-data-updated", listener);
  }
});
