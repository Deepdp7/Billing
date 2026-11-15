// The renderer gets exactly one capability from the desktop shell: saving the current view as a PDF.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apnaDesktop', {
  isDesktop: true,
  saveAsPdf: (fileName) => ipcRenderer.invoke('apna:save-pdf', String(fileName || 'document.pdf')),
});
