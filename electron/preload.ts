import {contextBridge, ipcRenderer} from 'electron';

/**
 * Expose a minimal, context-isolated API to the renderer. The app itself is a
 * self-contained React build and needs no Node APIs — this just surfaces the
 * platform and a quit helper so the UI can behave consistently everywhere.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  quit: () => ipcRenderer.send('quit-app'),
});