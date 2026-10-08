import {app, BrowserWindow, ipcMain, Menu} from 'electron';
import path from 'path';

// Diagnostics: confirm we are running inside Electron's main process, not Node
if (typeof require !== 'undefined' && typeof require('electron') === 'string') {
  console.error('[main] ERROR: main.js is running under Node, not Electron. process.versions.electron =', process.versions.electron);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Disappointment',
    backgroundColor: '#f0ede5',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: {x: 14, y: 12},
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const loadApp = async () => {
    if (!app.isPackaged) {
      // Development: load the Vite dev server
      await win.loadURL('http://localhost:3000');
      win.webContents.openDevTools();
    } else {
      // Packaged: load the built renderer
      await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
  };

  win.once('ready-to-show', loadApp);

  win.on('unresponsive', () => {
    // Reload if the renderer hangs (e.g. during the long Schaffel DSP)
    win.reload();
  });

  return win;
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Disappointment',
      submenu: [
        {label: 'About Disappointment', role: 'about'},
        {type: 'separator'},
        {label: 'Quit', role: 'quit'},
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {label: 'Undo', role: 'undo'},
        {label: 'Redo', role: 'redo'},
        {type: 'separator'},
        {label: 'Cut', role: 'cut'},
        {label: 'Copy', role: 'copy'},
        {label: 'Paste', role: 'paste'},
        {label: 'Select All', role: 'selectAll'},
      ],
    },
    {
      label: 'View',
      submenu: [
        {label: 'Reload', role: 'reload'},
        {label: 'Toggle Fullscreen', role: 'togglefullscreen'},
      ],
    },
  ]);
}

ipcMain.on('quit-app', () => app.quit());

app.whenReady().then(() => {
  createWindow();
  Menu.setApplicationMenu(buildMenu());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});