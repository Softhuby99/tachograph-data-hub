const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Tachograph Card Info Tool',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Inject data at load time
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const data = fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8');
  const injected = html.replace('__DATA__', data);
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(injected));
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
