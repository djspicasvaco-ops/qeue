const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');

let win = null;
let tray = null;
let serverProcess = null;
let serverReady = false;

const SERVER_PORT = 7842;
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

// ── Python server path ──
function getPythonPath() {
  const bundled = path.join(process.resourcesPath, 'python-bundled');
  if (IS_WIN) {
    const exe = path.join(bundled, 'python', 'python.exe');
    if (fs.existsSync(exe)) return exe;
  } else {
    const bin = path.join(bundled, 'bin', 'python3');
    if (fs.existsSync(bin)) return bin;
  }
  return IS_WIN ? 'python' : 'python3';
}

function getServerScriptPath() {
  const bundled = path.join(process.resourcesPath, 'server.py');
  if (fs.existsSync(bundled)) return bundled;
  return path.join(__dirname, 'server.py');
}

// ── Start Python server ──
function startServer() {
  const py = getPythonPath();
  const script = getServerScriptPath();

  if (!fs.existsSync(script)) {
    console.log('[server] no server.py found, running without engine');
    return;
  }

  try {
    serverProcess = spawn(py, [script, '--port', SERVER_PORT], {
      cwd: path.dirname(script),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    serverProcess.on('error', (e) => {
      console.log('[server] could not start:', e.message);
      serverProcess = null;
    });
    serverProcess.stdout.on('data', d => console.log('[server]', d.toString().trim()));
    serverProcess.stderr.on('data', d => console.error('[server]', d.toString().trim()));
    serverProcess.on('exit', code => { serverReady = false; });
    pollServer();
  } catch(e) {
    console.log('[server] spawn failed:', e.message);
  }
}
  const py = getPythonPath();
  const script = getServerScriptPath();

  serverProcess = spawn(py, [script, '--port', SERVER_PORT], {
    cwd: path.dirname(script),
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProcess.stdout.on('data', d => console.log('[server]', d.toString().trim()));
  serverProcess.stderr.on('data', d => console.error('[server]', d.toString().trim()));
  serverProcess.on('exit', code => {
    console.log('[server] exited with code', code);
    serverReady = false;
  });

  pollServer();
}

function pollServer(attempts = 0) {
  if (attempts > 30) return;
  http.get(`http://127.0.0.1:${SERVER_PORT}/api/health`, res => {
    if (res.statusCode === 200) {
      serverReady = true;
      console.log('[server] ready on port', SERVER_PORT);
      if (win) win.webContents.send('server-ready');
    }
  }).on('error', () => {
    setTimeout(() => pollServer(attempts + 1), 2000);
  });
}

// ── Get local WiFi IP ──
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ── Create main window ──
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Qeue',
    backgroundColor: '#050509',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    frame: !IS_MAC,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  // Show loading screen first, then the app
  win.loadFile(path.join(__dirname, 'app', 'loading.html'));

  win.once('ready-to-show', () => {
    win.show();
    // After a short delay, load the main app
    setTimeout(() => {
      win.loadFile(path.join(__dirname, 'app', 'index.html'));
    }, IS_WIN ? 1800 : 1200);
  });

  win.on('closed', () => { win = null; });

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Tray icon ──
function createTray() {
  const iconPath = path.join(__dirname, 'assets', IS_MAC ? 'tray-mac.png' : 'tray-win.png');
  const img = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(img);
  tray.setToolTip('Qeue');

  const menu = Menu.buildFromTemplate([
    { label: 'Open Qeue', click: () => { if (win) win.show(); else createWindow(); } },
    { type: 'separator' },
    { label: `Guest link: http://${getLocalIP()}:${SERVER_PORT}/guest`, enabled: false },
    { label: 'Copy guest link', click: () => {
      require('electron').clipboard.writeText(`http://${getLocalIP()}:${SERVER_PORT}/guest`);
    }},
    { type: 'separator' },
    { label: 'Quit Qeue', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (win) win.show(); });
}

// ── IPC handlers ──
ipcMain.handle('get-local-ip', () => getLocalIP());
ipcMain.handle('get-server-port', () => SERVER_PORT);
ipcMain.handle('is-server-ready', () => serverReady);
ipcMain.handle('get-app-version', () => app.getVersion());

// ── App lifecycle ──
app.whenReady().then(() => {
  createWindow();
  createTray();
  startServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

// Prevent quitting on window close (mac style — minimize to tray)
app.on('window-all-closed', (e) => {
  if (!app.isQuitting) return;
  if (serverProcess) serverProcess.kill();
});
