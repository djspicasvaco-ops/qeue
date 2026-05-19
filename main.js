const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, dialog, clipboard } = require('electron');
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

Menu.setApplicationMenu(null);

function getResourcesDir() {
  return app.isPackaged ? process.resourcesPath : __dirname;
}

function getPythonPath() {
  const base = getResourcesDir();
  const candidates = IS_WIN ? [
    path.join(base, 'python-bundled', 'python.exe'),
    path.join(base, 'python-bundled', 'Scripts', 'python.exe'),
    'python',
  ] : [
    path.join(base, 'python-bundled', 'bin', 'python3'),
    path.join(base, 'python-bundled', 'bin', 'python'),
    'python3',
  ];
  for (const c of candidates) {
    if (!c.includes('python-bundled') || fs.existsSync(c)) return c;
  }
  return IS_WIN ? 'python' : 'python3';
}

function getServerScript() {
  const candidates = [
    path.join(getResourcesDir(), 'server.py'),
    path.join(__dirname, 'server.py'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getAppPage() {
  const candidates = [
    path.join(__dirname, 'app', 'index.html'),
    path.join(__dirname, 'qeue.html'),
    path.join(__dirname, 'index.html'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(__dirname, 'app', 'index.html');
}

function getLoadingPage() {
  const candidates = [
    path.join(__dirname, 'app', 'loading.html'),
    path.join(__dirname, 'loading.html'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getAppIcon() {
  const names = IS_WIN ? ['icon.ico', 'icon.png'] : IS_MAC ? ['icon.icns', 'icon.png'] : ['icon.png'];
  for (const n of names) {
    const p = path.join(__dirname, 'assets', n);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function startServer() {
  const script = getServerScript();
  if (!script) {
    console.log('[qeue] no server.py — running without AI engine');
    return;
  }
  const py = getPythonPath();
  try {
    serverProcess = spawn(py, [script, '--port', String(SERVER_PORT)], {
      cwd: path.dirname(script),
      env: Object.assign({}, process.env, { PYTHONUNBUFFERED: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    serverProcess.on('error', (e) => { console.log('[server] error:', e.message); serverProcess = null; });
    serverProcess.stdout.on('data', (d) => console.log('[server]', d.toString().trim()));
    serverProcess.stderr.on('data', (d) => console.warn('[server]', d.toString().trim()));
    serverProcess.on('exit', () => { serverReady = false; serverProcess = null; });
    pollServer(0);
  } catch (e) {
    console.log('[server] could not start:', e.message);
  }
}

function pollServer(attempts) {
  if (attempts > 30) return;
  const req = http.get('http://127.0.0.1:' + SERVER_PORT + '/api/health', (res) => {
    if (res.statusCode === 200) {
      serverReady = true;
      if (win && !win.isDestroyed()) win.webContents.send('server-ready');
    }
  });
  req.on('error', () => setTimeout(() => pollServer(attempts + 1), 2000));
  req.setTimeout(1500, () => req.destroy());
}

function createWindow() {
  const iconPath = getAppIcon();
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Qeue',
    backgroundColor: '#050509',
    frame: true,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
    show: false,
  });

  win.setMenuBarVisibility(false);

  const appPage = getAppPage();
  const loadingPage = getLoadingPage();

  if (loadingPage) {
    win.loadFile(loadingPage);
    win.once('ready-to-show', () => {
      win.show();
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        win.loadFile(appPage);
      }, 1400);
    });
  } else {
    win.loadFile(appPage);
    win.once('ready-to-show', () => win.show());
  }

  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') win.webContents.toggleDevTools();
    if (input.key === 'F5' && input.type === 'keyDown') win.reload();
  });
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', IS_MAC ? 'tray-mac.png' : 'tray-win.png');
    const img = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
      : nativeImage.createEmpty();
    tray = new Tray(img);
    tray.setToolTip('Qeue');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Qeue', click: () => { if (win) win.show(); else createWindow(); } },
      { type: 'separator' },
      { label: 'Copy guest link', click: () => clipboard.writeText('http://' + getLocalIP() + ':' + SERVER_PORT + '/guest') },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
    tray.on('double-click', () => { if (win) win.show(); });
    tray.on('click', () => { if (IS_WIN && win) win.show(); });
  } catch (e) {
    console.log('[tray] skipped:', e.message);
  }
}

ipcMain.handle('get-local-ip', () => getLocalIP());
ipcMain.handle('get-server-port', () => SERVER_PORT);
ipcMain.handle('is-server-ready', () => serverReady);
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('show-open-dialog', async (e, opts) => dialog.showOpenDialog(win, opts));

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
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
});
