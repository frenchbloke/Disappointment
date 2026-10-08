const e = require('electron');
console.log('typeof require(electron):', typeof e);
console.log('keys:', Object.keys(e).slice(0, 8).join(', '));
console.log('app:', typeof e.app);
console.log('BrowserWindow:', typeof e.BrowserWindow);