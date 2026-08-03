const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('assetApi', {
  chooseRoot: () => ipcRenderer.invoke('choose-root'),
  getSavedRoot: () => ipcRenderer.invoke('get-saved-root'),
  scan: (root) => ipcRenderer.invoke('scan', root),
  boothSearch: (name, options) => ipcRenderer.invoke('booth-search', name, options),
  getLlmSettings: () => ipcRenderer.invoke('get-llm-settings'),
  saveLlmSettings: (settings) => ipcRenderer.invoke('save-llm-settings', settings),
  testLlm: () => ipcRenderer.invoke('test-llm'),
  chooseCustomPreview: (assetPath) => ipcRenderer.invoke('choose-custom-preview', assetPath),
  openLocalPath: (localPath) => ipcRenderer.invoke('open-local-path', localPath),
  saveClassifications: (root, assets) => ipcRenderer.invoke('save-classifications', root, assets),
  moveAsset: (asset, category) => ipcRenderer.invoke('move-asset', asset, category),
  importAssets: (paths, root, mode, destination) => ipcRenderer.invoke('import-assets', paths, root, mode, destination),
  getDroppedPath: (file) => webUtils.getPathForFile(file),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
  ,showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath)
});
