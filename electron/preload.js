"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
/**
 * Expose a minimal, context-isolated API to the renderer. The app itself is a
 * self-contained React build and needs no Node APIs — this just surfaces the
 * platform and a quit helper so the UI can behave consistently everywhere.
 */
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    quit: () => electron_1.ipcRenderer.send('quit-app'),
});
