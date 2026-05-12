const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gbDatabase", {
  load: () => ipcRenderer.invoke("database:load"),
  save: (data) => ipcRenderer.invoke("database:save", data),
  path: () => ipcRenderer.invoke("database:path")
});

contextBridge.exposeInMainWorld("designTarefasWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  quitApp: () => ipcRenderer.invoke("app:quit")
});

contextBridge.exposeInMainWorld("designTarefasNotifications", {
  show: (payload) => ipcRenderer.invoke("notifications:show", payload)
});
