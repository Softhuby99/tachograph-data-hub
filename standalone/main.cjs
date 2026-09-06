const { app, BrowserWindow, ipcMain, net } = require("electron");
const path = require("path");
const fs = require("fs");

// Allowlist for the fetch handler — same hosts as the web proxy.
const ALLOWED_FETCH_HOSTS = new Set([
  "dtc.jrc.ec.europa.eu",
  "ted.europa.eu",
  "api.ted.europa.eu",
  "www.commoncriteriaportal.org",
]);

// Renderer asks for remote pages (JRC update check) — main process fetches them.
ipcMain.handle("tacho:fetch", async (_event, url) => {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) {
    throw new Error("Only https URLs are allowed");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!ALLOWED_FETCH_HOSTS.has(parsed.hostname)) {
    throw new Error("Host not allowed");
  }
  const res = await net.fetch(url, {
    headers: { "user-agent": "TachographCardsInfoTool/1.0" },
  });
  if (!res.ok) throw new Error(`Request failed [${res.status}] ${res.statusText}`);
  return await res.text();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Tachograph Card Info Tool",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  // Inject data at load time. Written to a temp file under userData (instead
  // of a data: URL) so the page keeps a real origin — required for localStorage
  // + preload. Using userData instead of os.tmpdir() gives a stable,
  // app-owned path that survives restarts and isn't shared with other apps.
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const data = fs.readFileSync(path.join(__dirname, "data.json"), "utf8");
  const injected = html.replace("__DATA__", data);
  const tempDir = app.getPath("userData");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const target = path.join(tempDir, "tachograph-card-info-tool.html");
  fs.writeFileSync(target, injected, "utf8");
  win.loadFile(target);
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
