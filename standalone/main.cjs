const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Renderer asks for remote pages (JRC update check) — main process fetches them.
ipcMain.handle('tacho:fetch', async (_event, url) => {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    throw new Error('Only https URLs are allowed');
  }
  const res = await net.fetch(url, {
    headers: { 'user-agent': 'TachographCardsInfoTool/1.0' },
  });
  if (!res.ok) throw new Error(`Request failed [${res.status}] ${res.statusText}`);
  return await res.text();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Tachograph Card Info Tool',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  // Inject data at load time. Written to a temp file (instead of a data: URL)
  // so the page keeps a real origin — required for localStorage + preload.
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const data = fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8');
  const injected = html.replace('__DATA__', data);
  const target = path.join(os.tmpdir(), 'tachograph-card-info-tool.html');
  fs.writeFileSync(target, injected, 'utf8');
  win.loadFile(target);
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
