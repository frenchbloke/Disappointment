"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
// Diagnostics: confirm we are running inside Electron's main process, not Node
if (typeof require !== 'undefined' && typeof require('electron') === 'string') {
    console.error('[main] ERROR: main.js is running under Node, not Electron. process.versions.electron =', process.versions.electron);
}
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: 'Disappointment',
        backgroundColor: '#f0ede5',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 14, y: 12 },
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    const loadApp = async () => {
        if (!electron_1.app.isPackaged) {
            // Development: load the Vite dev server
            await win.loadURL('http://localhost:3000');
            win.webContents.openDevTools();
        }
        else {
            // Packaged: load the built renderer
            await win.loadFile(path_1.default.join(__dirname, '..', 'dist', 'index.html'));
        }
    };
    win.once('ready-to-show', loadApp);
    win.on('unresponsive', () => {
        // Reload if the renderer hangs (e.g. during the long Schaffel DSP)
        win.reload();
    });
    return win;
}
function buildMenu() {
    return electron_1.Menu.buildFromTemplate([
        {
            label: 'Disappointment',
            submenu: [
                { label: 'About Disappointment', role: 'about' },
                { type: 'separator' },
                { label: 'Quit', role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { label: 'Undo', role: 'undo' },
                { label: 'Redo', role: 'redo' },
                { type: 'separator' },
                { label: 'Cut', role: 'cut' },
                { label: 'Copy', role: 'copy' },
                { label: 'Paste', role: 'paste' },
                { label: 'Select All', role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { label: 'Reload', role: 'reload' },
                { label: 'Toggle Fullscreen', role: 'togglefullscreen' },
            ],
        },
    ]);
}
electron_1.ipcMain.on('quit-app', () => electron_1.app.quit());
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.Menu.setApplicationMenu(buildMenu());
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
